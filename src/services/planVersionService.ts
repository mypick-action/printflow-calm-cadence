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
}

export interface PublishPlanResult {
  success: boolean;
  planVersion: string | null;
  cyclesCreated: number;
  cyclesDeleted: number;
  error?: string;
}

/**
 * Atomically publish a new plan to cloud via Postgres RPC.
 * 
 * IMPORTANT: This only publishes cycles with status='planned'.
 * in_progress/completed/failed are EXECUTION OVERLAYS - they stay in cloud
 * and are NOT affected by new plan_version.
 * 
 * The RPC function runs in a SINGLE TRANSACTION:
 * 1. Generates new plan_version UUID
 * 2. Deletes old planned/scheduled cycles (NOT in_progress/completed)
 * 3. Inserts new cycles with plan_version
 * 4. Updates factory_settings.active_plan_version
 * 5. Records in plan_history
 * 
 * NO INTERMEDIATE STATE - atomic or nothing!
 */
export async function publishPlanToCloud(input: PublishPlanInput): Promise<PublishPlanResult> {
  const { workspaceId, cycles, reason = 'manual_replan', scope = 'from_now' } = input;
  const startTime = Date.now();
  
  console.log('[PlanVersion] ========== PUBLISH START ==========');
  console.log('[PlanVersion] Input:', {
    workspaceId,
    totalCycles: cycles.length,
    plannedCycles: cycles.filter(c => c.status === 'planned').length,
    inProgressCycles: cycles.filter(c => c.status === 'in_progress').length,
    reason,
    scope,
    timestamp: new Date().toISOString(),
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
  
  // ONLY sync cycles with status='planned' - in_progress/completed are execution overlays
  const plannedCycles = cycles.filter(c => c.status === 'planned');
  
  // Check for orphaned projects
  const orphanedProjectIds: string[] = [];
  for (const cycle of plannedCycles) {
    const projectUuid = (cycle as any).projectUuid || projectIdToUuid.get(cycle.projectId) || cycle.projectId;
    if (!projectUuid || projectUuid.length < 36) {
      if (!orphanedProjectIds.includes(cycle.projectId)) {
        orphanedProjectIds.push(cycle.projectId);
      }
    }
  }
  
  if (orphanedProjectIds.length > 0) {
    console.warn('[PlanVersion] ❌ PUBLISH FAILED - Orphaned projects:', orphanedProjectIds);
    console.log('[PlanVersion] Duration:', Date.now() - startTime, 'ms');
    
    // Dispatch event for UI
    window.dispatchEvent(new CustomEvent('printflow:publish-status', {
      detail: { success: false, error: 'orphaned_projects', orphanedProjectIds }
    }));
    
    return {
      success: false,
      planVersion: null,
      cyclesCreated: 0,
      cyclesDeleted: 0,
      error: 'Deferred: projects not yet hydrated (race condition)',
    };
  }
  
  // Map cycles to cloud format (ONLY planned cycles)
  const cloudCycles = plannedCycles.map(c => {
    const projectUuid = (c as any).projectUuid || projectIdToUuid.get(c.projectId) || c.projectId;
    
    return {
      project_id: projectUuid,
      printer_id: c.printerId,
      // Use pre-calculated business day if available (night cycles → next workday)
      scheduled_date: c.scheduledDate 
        || (c.startTime 
          ? formatDateStringLocal(new Date(c.startTime)) 
          : formatDateStringLocal(new Date())),
      start_time: c.startTime || null,
      end_time: c.endTime || null,
      units_planned: c.unitsPlanned,
      status: 'scheduled', // Always 'scheduled' for planned cycles
      preset_id: c.presetId || null,
      legacy_id: c.id,
    };
  });
  
  console.log('[PlanVersion] Calling edge function with', cloudCycles.length, 'cycles...');
  
  // Call edge function (which uses atomic RPC)
  const { data, error } = await supabase.functions.invoke('publish-plan', {
    body: {
      workspace_id: workspaceId,
      cycles: cloudCycles,
      reason,
      scope,
    },
  });
  
  if (error) {
    console.error('[PlanVersion] ❌ PUBLISH FAILED - Edge function error:', {
      error: error.message,
      name: error.name,
      duration: Date.now() - startTime,
    });
    
    // Dispatch event for UI
    window.dispatchEvent(new CustomEvent('printflow:publish-status', {
      detail: { success: false, error: error.message }
    }));
    
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
    
    console.log('[PlanVersion] ✅ PUBLISH SUCCESS:', {
      planVersion: result.plan_version,
      cyclesCreated: result.cycles_created,
      cyclesDeleted: result.cycles_deleted,
      duration: Date.now() - startTime,
    });
    
    // Dispatch event for UI
    window.dispatchEvent(new CustomEvent('printflow:publish-status', {
      detail: { 
        success: true, 
        planVersion: result.plan_version,
        cyclesCreated: result.cycles_created,
        cyclesDeleted: result.cycles_deleted,
      }
    }));
  } else {
    console.error('[PlanVersion] ❌ PUBLISH FAILED - RPC error:', {
      error: result.error,
      duration: Date.now() - startTime,
    });
    
    // Dispatch event for UI
    window.dispatchEvent(new CustomEvent('printflow:publish-status', {
      detail: { success: false, error: result.error || 'Unknown RPC error' }
    }));
  }
  
  console.log('[PlanVersion] ========== PUBLISH END ==========');
  
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
 * IMPORTANT: Also fetches execution overlays (in_progress/completed/failed)
 * which are NOT part of the plan but should be preserved in local state.
 * 
 * After loading, dispatches event for UI to trigger gramsPlanned recalculation.
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
  
  // Fetch ALL cycles for this workspace:
  // 1. Cycles with the new plan_version (the new plan)
  // 2. Cycles with status in_progress/completed/failed (execution overlays)
  const { data: cloudCycles, error } = await supabase
    .from('planned_cycles')
    .select('*')
    .eq('workspace_id', workspaceId)
    .or(`plan_version.eq.${cloudVersion},status.in.(in_progress,completed,failed)`);
  
  if (error) {
    console.error('[PlanVersion] Error fetching cycles:', error);
    return { updated: false, version: null, cyclesLoaded: 0, error: error.message };
  }
  
  // Get project mapping for legacy_id conversion
  const { data: cloudProjects } = await supabase
    .from('projects')
    .select('id, legacy_id, product_id')
    .eq('workspace_id', workspaceId);
  
  const projectUuidToLegacyId = new Map<string, string>();
  const projectUuidToProductId = new Map<string, string>();
  for (const p of cloudProjects || []) {
    const localId = p.legacy_id || p.id;
    projectUuidToLegacyId.set(p.id, localId);
    if (p.product_id) {
      projectUuidToProductId.set(p.id, p.product_id);
    }
  }
  
  // Get products and presets for gramsPlanned calculation
  const productsRaw = localStorage.getItem(KEYS.PRODUCTS);
  const products = productsRaw ? JSON.parse(productsRaw) : [];
  
  // Fetch presets for units-per-plate lookup
  const { data: cloudPresets } = await supabase
    .from('plate_presets')
    .select('id, product_id, units_per_plate, grams_per_unit')
    .eq('workspace_id', workspaceId);
  
  // Helper to calculate gramsPlanned
  // gramsPlanned = gramsPerUnit * unitsPlanned
  // NOTE: unitsPlanned is already the number of units in the cycle (from units_per_plate)
  // So gramsPlanned = gramsPerUnit * unitsPlanned is correct
  const calculateGramsPlanned = (projectId: string, unitsPlanned: number, presetId?: string): number => {
    // Try preset first (most accurate)
    if (presetId) {
      const preset = cloudPresets?.find(p => p.id === presetId);
      if (preset?.grams_per_unit) {
        return preset.grams_per_unit * unitsPlanned;
      }
    }
    
    // Fallback to product gramsPerUnit
    const project = cloudProjects?.find(p => p.id === projectId || p.legacy_id === projectId);
    if (!project?.product_id) return 0;
    
    const product = products.find((p: any) => p.id === project.product_id || p.cloudUuid === project.product_id);
    if (!product?.gramsPerUnit) return 0;
    
    return product.gramsPerUnit * unitsPlanned;
  };
  
  // Map cloud cycles to localStorage format with gramsPlanned calculation
  const mappedCycles: PlannedCycle[] = (cloudCycles || []).map((c: any) => {
    const projectLegacyId = projectUuidToLegacyId.get(c.project_id) || c.project_id;
    const gramsPlanned = calculateGramsPlanned(c.project_id, c.units_planned ?? 1, c.preset_id);
    
    return {
      id: c.legacy_id || c.id,
      projectId: projectLegacyId,
      printerId: c.printer_id,
      unitsPlanned: c.units_planned ?? 1,
      gramsPlanned, // Calculated from product
      plateType: 'full' as const,
      startTime: c.start_time ?? '',
      endTime: c.end_time ?? '',
      shift: 'day' as const,
      status: (c.status === 'scheduled' ? 'planned' : c.status) as PlannedCycle['status'],
      readinessState: 'ready' as const, // Will be recalculated by dashboard
      source: 'auto' as const,
      locked: false,
      projectUuid: c.project_id,
      cycleUuid: c.id,
      pendingCloudSync: false,
    };
  });
  
  // Deduplicate - prefer cycles with higher status (in_progress > planned)
  const cycleMap = new Map<string, PlannedCycle>();
  const statusPriority: Record<string, number> = {
    'completed': 4,
    'failed': 3,
    'in_progress': 2,
    'planned': 1,
    'cancelled': 0,
  };
  
  for (const cycle of mappedCycles) {
    const existing = cycleMap.get(cycle.id);
    if (!existing || (statusPriority[cycle.status] || 0) > (statusPriority[existing.status] || 0)) {
      cycleMap.set(cycle.id, cycle);
    }
  }
  
  const finalCycles = Array.from(cycleMap.values());
  
  // Replace local cycles completely
  localStorage.setItem(KEYS.PLANNED_CYCLES, JSON.stringify(finalCycles));
  
  // Update local version
  setLocalPlanVersion(cloudVersion);
  
  console.log('[PlanVersion] ✓ Loaded', finalCycles.length, 'cycles with version', cloudVersion);
  
  // Dispatch event for UI refresh and readiness recalculation
  window.dispatchEvent(new CustomEvent('printflow:plan-updated', {
    detail: { 
      version: cloudVersion, 
      cyclesCount: finalCycles.length,
      needsReadinessRecalc: true, // Signal to recalculate readinessState
    }
  }));
  
  return {
    updated: true,
    version: cloudVersion,
    cyclesLoaded: finalCycles.length,
  };
}
