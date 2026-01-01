// Planning recalculator - separated to avoid circular dependencies
// between storage.ts and planningEngine.ts

import {
  PlannedCycle,
  getPlannedCycles,
  getFactorySettings,
  getActivePrinters,
  getPlanningMeta,
  savePlanningMeta,
  KEYS,
  getProjects,
} from './storage';
import { generatePlan, BlockingIssue, PlanningWarning } from './planningEngine';
import { addPlanningLogEntry } from './planningLogger';
import { pdebug } from './planningDebug';
import { upsertPlannedCycleByLegacyId, deleteCloudCyclesByDateRange } from './cloudStorage';
import { supabase } from '@/integrations/supabase/client';
import { formatDateStringLocal } from './dateUtils';

// Re-export the KEYS constant for internal use
const setItem = <T>(key: string, value: T): void => {
  localStorage.setItem(key, JSON.stringify(value));
};

export type RecalculateScope = 'from_now' | 'from_tomorrow' | 'whole_week';

export interface RecalculateResult {
  success: boolean;
  cyclesModified: number;
  summary: string;
  summaryHe: string;
  blockingIssuesCount: number;
  warningsCount: number;
  // Full issues for UI display
  blockingIssues: BlockingIssue[];
  warnings: PlanningWarning[];
}

export const recalculatePlan = (
  scope: RecalculateScope,
  lockStarted: boolean = true,
  reason: string = 'manual_replan'
): RecalculateResult => {
  const startTime = Date.now();
  const cycles = getPlannedCycles();
  const settings = getFactorySettings();
  const printers = getActivePrinters();
  
  pdebug('Replan start', { scope, lockStarted, reason, cyclesCount: cycles.length, printersCount: printers.length });
  
  if (!settings || printers.length === 0) {
    const result: RecalculateResult = { 
      success: false, 
      cyclesModified: 0, 
      summary: 'No settings or printers available',
      summaryHe: 'חסרות הגדרות או מדפסות',
      blockingIssuesCount: 1,
      warningsCount: 0,
      blockingIssues: [{
        type: 'no_printers',
        message: 'חסרות הגדרות או מדפסות',
        messageEn: 'No settings or printers available',
      }],
      warnings: [],
    };
    
    // Log this attempt
    addPlanningLogEntry({
      reason: reason as any,
      success: false,
      cyclesCreated: 0,
      unitsPlanned: 0,
      warnings: [],
      errors: [result.summary],
      durationMs: Date.now() - startTime,
    });
    
    return result;
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // Determine start date based on scope
  let startDate: Date;
  switch (scope) {
    case 'from_now':
      startDate = now;
      break;
    case 'from_tomorrow':
      startDate = tomorrow;
      break;
    case 'whole_week':
      startDate = today;
      break;
    default:
      startDate = now;
  }

  // Determine which cycles to keep (completed, failed, locked, or in-progress if lockStarted)
  // CRITICAL: Never keep 'planned' cycles in from_now scope - they will be regenerated
  // This prevents duplication when generatePlan creates new cycles
  // ALSO: Always keep manually created cycles with locked=true
  const cyclesToKeep: PlannedCycle[] = cycles.filter((cycle) => {
    const isCompleted = cycle.status === 'completed' || cycle.status === 'failed';
    if (isCompleted) return true;

    // Always keep locked manual cycles (even if planned status)
    if (cycle.locked && cycle.source === 'manual') return true;

    const isInProgress = cycle.status === 'in_progress';
    if (lockStarted && isInProgress) return true;

    // ✅ CRITICAL: Never keep planned cycles in from_now - they will be regenerated
    if (scope === 'from_now') return false;

    // For whole_week scope, also don't keep planned (full regeneration)
    return false;
  });

  pdebug('Cycles kept', {
    total: cyclesToKeep.length,
    completed: cyclesToKeep.filter(c => c.status === 'completed' || c.status === 'failed').length,
    inProgress: cyclesToKeep.filter(c => c.status === 'in_progress').length,
  });

  // Generate new plan using the planning engine
  const planResult = generatePlan({
    startDate,
    daysToPlane: 7,
    scope,
    lockInProgress: lockStarted,
  });

  // Merge kept cycles with new plan cycles
  const newCycles = [...cyclesToKeep, ...planResult.cycles];

  pdebug('Replan result', {
    keptCycles: cyclesToKeep.length,
    newCycles: planResult.cycles.length,
    totalCycles: newCycles.length,
    success: planResult.success,
  });

  // Log before saving for debugging
  console.log(`[planningRecalculator] Saving ${newCycles.length} cycles to origin: ${window.location.origin}`);

  // Save the updated cycles to localStorage
  setItem(KEYS.PLANNED_CYCLES, newCycles);

  // Sync cycles to cloud (async, non-blocking) - pass startDate for REPLACE behavior
  syncCyclesToCloud(newCycles, startDate).catch(err => {
    console.error('[planningRecalculator] Failed to sync cycles to cloud:', err);
  });

  // Update planning meta
  savePlanningMeta({
    lastRecalculatedAt: new Date().toISOString(),
    capacityChangedSinceLastRecalculation: false,
    lastCapacityChangeReason: undefined,
  });

  const cyclesModified = planResult.cycles.length;
  
  // Build summary
  let summary = '';
  let summaryHe = '';
  
  if (planResult.success) {
    summary = `Generated ${cyclesModified} cycles for ${planResult.totalUnitsPlanned} units`;
    summaryHe = `נוצרו ${cyclesModified} מחזורים עבור ${planResult.totalUnitsPlanned} יחידות`;
    
    if (planResult.warnings.length > 0) {
      summary += ` with ${planResult.warnings.length} warning(s)`;
      summaryHe += ` עם ${planResult.warnings.length} אזהרות`;
    }
  } else {
    summary = `Planning failed: ${planResult.blockingIssues.map(i => i.messageEn).join(', ')}`;
    summaryHe = `התכנון נכשל: ${planResult.blockingIssues.map(i => i.message).join(', ')}`;
  }

  // Log the result
  addPlanningLogEntry({
    reason: reason as any,
    success: planResult.success,
    cyclesCreated: cyclesModified,
    unitsPlanned: planResult.totalUnitsPlanned,
    warnings: planResult.warnings.map(w => w.messageEn),
    errors: planResult.blockingIssues.map(i => i.messageEn),
    durationMs: Date.now() - startTime,
  });

  return {
    success: planResult.success,
    cyclesModified,
    summary,
    summaryHe,
    blockingIssuesCount: planResult.blockingIssues.length,
    warningsCount: planResult.warnings.length,
    blockingIssues: planResult.blockingIssues,
    warnings: planResult.warnings,
  };
};

/**
 * Run replan immediately and return the result with full issues.
 * Unlike scheduleAutoReplan, this doesn't use debounce - for UI checks after project creation.
 * @param reason - The reason for replanning (for logging)
 */
export const runReplanNow = (reason: string): RecalculateResult => {
  return recalculatePlan('from_now', true, reason);
};

// Trigger planning recalculation
export const triggerPlanningRecalculation = (reason: string): void => {
  // Mark capacity as changed, then recalculate
  const meta = getPlanningMeta();
  savePlanningMeta({
    ...meta,
    capacityChangedSinceLastRecalculation: true,
    lastCapacityChangeReason: reason,
  });
  recalculatePlan('from_now', true, reason);
};

/**
 * Sync planned cycles to cloud storage with REPLACE behavior.
 * 1. Deletes existing planned/scheduled cycles for the date range
 * 2. Upserts the new cycles
 * This ensures Replan = Replace, not Append.
 */
async function syncCyclesToCloud(cycles: PlannedCycle[], startDate?: Date): Promise<void> {
  // Get workspace ID from Supabase profile
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    console.log('[planningRecalculator] No user, skipping cloud sync');
    return;
  }
  
  const { data: profile } = await supabase
    .from('profiles')
    .select('current_workspace_id')
    .eq('user_id', user.id)
    .single();
  
  const workspaceId = profile?.current_workspace_id;
  if (!workspaceId) {
    console.log('[planningRecalculator] No workspace, skipping cloud sync');
    return;
  }
  
  // STEP 1: DELETE old planned/scheduled cycles from the planning range
  // This prevents Append behavior - ensures Replace
  const fromDate = startDate 
    ? formatDateStringLocal(startDate)
    : formatDateStringLocal(new Date());
  
  const deletedCount = await deleteCloudCyclesByDateRange(workspaceId, fromDate);
  console.log(`[planningRecalculator] Deleted ${deletedCount} old cloud cycles from ${fromDate}`);
  
  // Get projects from localStorage to map projectId → UUID
  // Support multiple mapping scenarios:
  // 1. Legacy projects with cloudId: id → cloudId
  // 2. Cloud-first projects with cloudUuid: id → cloudUuid  
  // 3. Projects where id IS already a UUID: id → id
  const projectsRaw = localStorage.getItem(KEYS.PROJECTS);
  const projects = projectsRaw ? JSON.parse(projectsRaw) : [];
  const projectIdToUuid = new Map<string, string>();
  const validProjectIds = new Set<string>();
  
  for (const p of projects) {
    validProjectIds.add(p.id);
    // Priority: cloudId > cloudUuid > (id if already UUID)
    if (p.cloudId) {
      projectIdToUuid.set(p.id, p.cloudId);
    } else if (p.cloudUuid) {
      projectIdToUuid.set(p.id, p.cloudUuid);
    } else if (p.id && p.id.length === 36 && /^[0-9a-f-]+$/i.test(p.id)) {
      // id is already a UUID (cloud-first project)
      projectIdToUuid.set(p.id, p.id);
    }
  }
  
  // STEP 2: Sync cycles - include planned, in_progress, and locked manual cycles
  const syncableCycles = cycles.filter(c => 
    c.status === 'planned' || 
    c.status === 'in_progress' || 
    (c.locked && c.source === 'manual')
  );
  console.log(`[planningRecalculator] Syncing ${syncableCycles.length} cycles to cloud`);
  
  let synced = 0;
  let errors = 0;
  let skipped = 0;
  const skippedProjects: string[] = [];
  
  for (const cycle of syncableCycles) {
    // First check if projectId refers to a valid project
    if (!validProjectIds.has(cycle.projectId)) {
      console.warn('[planningRecalculator] Skipping cycle with orphaned project:', cycle.projectId);
      skipped++;
      if (!skippedProjects.includes(cycle.projectId)) {
        skippedProjects.push(cycle.projectId);
      }
      continue;
    }
    
    // Map local projectId to cloud UUID
    const projectUuid = (cycle as any).projectUuid || projectIdToUuid.get(cycle.projectId) || cycle.projectId;
    
    // Skip if we don't have a valid UUID for the project
    if (!projectUuid || projectUuid.length < 36) {
      console.warn('[planningRecalculator] Skipping cycle with invalid project UUID:', cycle.projectId, '→', projectUuid);
      skipped++;
      if (!skippedProjects.includes(cycle.projectId)) {
        skippedProjects.push(cycle.projectId);
      }
      continue;
    }
    
    const cycleData = {
      project_id: projectUuid,
      printer_id: cycle.printerId,
      scheduled_date: cycle.startTime 
        ? formatDateStringLocal(new Date(cycle.startTime)) 
        : formatDateStringLocal(new Date()),
      start_time: cycle.startTime || null,
      end_time: cycle.endTime || null,
      units_planned: cycle.unitsPlanned,
      status: 'scheduled' as const,
      preset_id: null,
      cycle_index: 0,
    };
    
    const result = await upsertPlannedCycleByLegacyId(workspaceId, cycle.id, cycleData);
    if (result.data) {
      synced++;
    } else {
      errors++;
    }
  }
  
  console.log(`[planningRecalculator] Cloud sync complete: ${synced} synced, ${errors} errors, ${skipped} skipped (deleted ${deletedCount} old)`);
  
  // Show warning toast if cycles were skipped
  if (skipped > 0) {
    console.error(`[planningRecalculator] SYNC WARNING: ${skipped} cycles skipped due to invalid/orphaned projects:`, skippedProjects);
    // Dispatch custom event for UI to catch
    window.dispatchEvent(new CustomEvent('sync-cycles-skipped', {
      detail: { skipped, projects: skippedProjects }
    }));
  }
}
