// Plan Version Service
// Manages plan versioning for Cloud ↔ Local sync stability

import { supabase } from '@/integrations/supabase/client';
import { KEYS, PlannedCycle } from './storage';
import { formatDateStringLocal } from './dateUtils';

// localStorage key for local plan version tracking
const LOCAL_PLAN_VERSION_KEY = 'printflow_local_plan_version';

// ============= LOCAL PLAN VERSION MANAGEMENT =============

/**
 * Get the local plan version (stored in localStorage)
 */
export function getLocalPlanVersion(): string | null {
  return localStorage.getItem(LOCAL_PLAN_VERSION_KEY);
}

/**
 * Set the local plan version
 */
export function setLocalPlanVersion(version: string): void {
  localStorage.setItem(LOCAL_PLAN_VERSION_KEY, version);
  console.log('[PlanVersion] Local plan version set to:', version);
}

/**
 * Clear the local plan version (e.g., on logout)
 */
export function clearLocalPlanVersion(): void {
  localStorage.removeItem(LOCAL_PLAN_VERSION_KEY);
}

// ============= CLOUD PLAN VERSION QUERIES =============

/**
 * Get the active plan version from cloud (factory_settings)
 */
export async function getCloudPlanVersion(workspaceId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('factory_settings')
    .select('active_plan_version')
    .eq('workspace_id', workspaceId)
    .single();
  
  if (error) {
    console.error('[PlanVersion] Error fetching cloud plan version:', error);
    return null;
  }
  
  return (data as any)?.active_plan_version || null;
}

/**
 * Check if local plan version matches cloud
 * Returns true if they match, false if cloud has a newer version
 */
export async function isPlanVersionCurrent(workspaceId: string): Promise<boolean> {
  const localVersion = getLocalPlanVersion();
  const cloudVersion = await getCloudPlanVersion(workspaceId);
  
  console.log('[PlanVersion] Version check:', { local: localVersion, cloud: cloudVersion });
  
  // If cloud has no version yet, local is considered current
  if (!cloudVersion) return true;
  
  // If local has no version, need to fetch from cloud
  if (!localVersion) return false;
  
  return localVersion === cloudVersion;
}

// ============= PUBLISH PLAN (ATOMIC) =============

export interface PublishPlanInput {
  workspaceId: string;
  cycles: PlannedCycle[];
  reason?: string;
  scope?: string;
  keepCycleIds?: string[]; // IDs of cycles to preserve (completed, in_progress, locked)
}

export interface PublishPlanResult {
  success: boolean;
  planVersion: string | null;
  cyclesCreated: number;
  cyclesDeleted: number;
  error?: string;
}

/**
 * Atomically publish a new plan to cloud.
 * This replaces the old delete-then-insert pattern with a single atomic operation.
 * 
 * The edge function:
 * 1. Generates a new plan_version UUID
 * 2. Deletes old planned/scheduled cycles (except kept ones)
 * 3. Inserts new cycles with the plan_version
 * 4. Updates factory_settings.active_plan_version
 * 5. Records in plan_history
 * 
 * All in a single request - no window where cloud is empty!
 */
export async function publishPlanToCloud(input: PublishPlanInput): Promise<PublishPlanResult> {
  const { workspaceId, cycles, reason = 'manual_replan', scope = 'from_now', keepCycleIds = [] } = input;
  
  console.log('[PlanVersion] Publishing plan to cloud:', {
    workspaceId,
    cyclesCount: cycles.length,
    keepCount: keepCycleIds.length,
    reason,
    scope,
  });
  
  // Get projects to map projectId → UUID
  const projectsRaw = localStorage.getItem(KEYS.PROJECTS);
  const projects = projectsRaw ? JSON.parse(projectsRaw) : [];
  const projectIdToUuid = new Map<string, string>();
  
  for (const p of projects) {
    if (p.cloudUuid) {
      projectIdToUuid.set(p.id, p.cloudUuid);
    } else if (p.id && p.id.length === 36 && /^[0-9a-f-]+$/i.test(p.id)) {
      projectIdToUuid.set(p.id, p.id);
    }
  }
  
  // Filter syncable cycles and map to cloud format
  const syncableCycles = cycles.filter(c => 
    c.status === 'planned' || 
    c.status === 'in_progress' || 
    (c.locked && c.source === 'manual')
  );
  
  // Check for orphaned projects
  const orphanedProjectIds: string[] = [];
  for (const cycle of syncableCycles) {
    const projectUuid = (cycle as any).projectUuid || projectIdToUuid.get(cycle.projectId) || cycle.projectId;
    if (!projectUuid || projectUuid.length < 36) {
      if (!orphanedProjectIds.includes(cycle.projectId)) {
        orphanedProjectIds.push(cycle.projectId);
      }
    }
  }
  
  if (orphanedProjectIds.length > 0) {
    console.warn('[PlanVersion] Detected orphaned projects - deferring publish:', orphanedProjectIds);
    return {
      success: false,
      planVersion: null,
      cyclesCreated: 0,
      cyclesDeleted: 0,
      error: 'Deferred: projects not yet hydrated (race condition)',
    };
  }
  
  // Map cycles to cloud format
  const cloudCycles = syncableCycles.map(c => {
    const projectUuid = (c as any).projectUuid || projectIdToUuid.get(c.projectId) || c.projectId;
    
    return {
      project_id: projectUuid,
      printer_id: c.printerId,
      scheduled_date: c.startTime 
        ? formatDateStringLocal(new Date(c.startTime)) 
        : formatDateStringLocal(new Date()),
      start_time: c.startTime || null,
      end_time: c.endTime || null,
      units_planned: c.unitsPlanned,
      status: c.status === 'planned' ? 'scheduled' : c.status,
      preset_id: c.presetId || null,
      legacy_id: c.id,
    };
  });
  
  // Call edge function
  const { data, error } = await supabase.functions.invoke('publish-plan', {
    body: {
      workspace_id: workspaceId,
      cycles: cloudCycles,
      reason,
      scope,
      keep_cycle_ids: keepCycleIds,
    },
  });
  
  if (error) {
    console.error('[PlanVersion] Edge function error:', error);
    return {
      success: false,
      planVersion: null,
      cyclesCreated: 0,
      cyclesDeleted: 0,
      error: error.message,
    };
  }
  
  const result = data as {
    success: boolean;
    plan_version: string | null;
    cycles_created: number;
    cycles_deleted: number;
    error?: string;
  };
  
  if (result.success && result.plan_version) {
    // Update local plan version to match cloud
    setLocalPlanVersion(result.plan_version);
    console.log('[PlanVersion] ✓ Plan published successfully:', result.plan_version);
  }
  
  return {
    success: result.success,
    planVersion: result.plan_version,
    cyclesCreated: result.cycles_created,
    cyclesDeleted: result.cycles_deleted,
    error: result.error,
  };
}

// ============= CHECK FOR PLAN UPDATES =============

export interface PlanUpdateResult {
  updated: boolean;
  version: string | null;
  cyclesLoaded: number;
  error?: string;
}

/**
 * Check if there's a new plan version and load it if needed.
 * This is the VERSION-BASED hydration - only fetches if version changed.
 * 
 * Returns:
 * - updated: true if a new plan was loaded
 * - version: the new plan version (if updated)
 * - cyclesLoaded: number of cycles loaded
 */
export async function checkForPlanUpdate(workspaceId: string): Promise<PlanUpdateResult> {
  const localVersion = getLocalPlanVersion();
  const cloudVersion = await getCloudPlanVersion(workspaceId);
  
  console.log('[PlanVersion] Checking for updates:', { localVersion, cloudVersion });
  
  // If cloud has no version, nothing to update
  if (!cloudVersion) {
    return { updated: false, version: null, cyclesLoaded: 0 };
  }
  
  // If versions match, no update needed
  if (localVersion === cloudVersion) {
    console.log('[PlanVersion] Plan is up to date');
    return { updated: false, version: localVersion, cyclesLoaded: 0 };
  }
  
  console.log('[PlanVersion] New plan detected, loading cycles...');
  
  // Fetch all cycles with the new plan_version
  const { data: cloudCycles, error } = await supabase
    .from('planned_cycles')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('plan_version', cloudVersion);
  
  if (error) {
    console.error('[PlanVersion] Error fetching cycles:', error);
    return { updated: false, version: null, cyclesLoaded: 0, error: error.message };
  }
  
  // Get project mapping for legacy_id conversion
  const { data: cloudProjects } = await supabase
    .from('projects')
    .select('id, legacy_id')
    .eq('workspace_id', workspaceId);
  
  const projectUuidToLegacyId = new Map<string, string>();
  for (const p of cloudProjects || []) {
    const localId = p.legacy_id || p.id;
    projectUuidToLegacyId.set(p.id, localId);
  }
  
  // Map cloud cycles to localStorage format
  const mappedCycles: PlannedCycle[] = (cloudCycles || []).map((c: any) => {
    const projectLegacyId = projectUuidToLegacyId.get(c.project_id) || c.project_id;
    
    return {
      id: c.legacy_id || c.id,
      projectId: projectLegacyId,
      printerId: c.printer_id,
      unitsPlanned: c.units_planned ?? 1,
      gramsPlanned: 0, // Will be recalculated
      plateType: 'full',
      startTime: c.start_time ?? '',
      endTime: c.end_time ?? '',
      shift: 'day',
      status: (c.status === 'scheduled' ? 'planned' : c.status) as PlannedCycle['status'],
      readinessState: 'ready' as const,
      source: 'auto',
      locked: false,
      projectUuid: c.project_id,
      cycleUuid: c.id,
      pendingCloudSync: false,
    };
  });
  
  // Replace local cycles completely
  localStorage.setItem(KEYS.PLANNED_CYCLES, JSON.stringify(mappedCycles));
  
  // Update local version
  setLocalPlanVersion(cloudVersion);
  
  console.log('[PlanVersion] ✓ Loaded', mappedCycles.length, 'cycles with version', cloudVersion);
  
  // Dispatch event for UI refresh
  window.dispatchEvent(new CustomEvent('printflow:plan-updated', {
    detail: { version: cloudVersion, cyclesCount: mappedCycles.length }
  }));
  
  return {
    updated: true,
    version: cloudVersion,
    cyclesLoaded: mappedCycles.length,
  };
}
