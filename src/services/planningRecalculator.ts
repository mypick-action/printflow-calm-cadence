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
} from './storage';
import { generatePlan } from './planningEngine';
import { addPlanningLogEntry } from './planningLogger';

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
  
  if (!settings || printers.length === 0) {
    const result: RecalculateResult = { 
      success: false, 
      cyclesModified: 0, 
      summary: 'No settings or printers available',
      summaryHe: 'חסרות הגדרות או מדפסות',
      blockingIssuesCount: 1,
      warningsCount: 0,
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

  // Determine which cycles to keep (completed, failed, or in-progress if locked)
  const cyclesToKeep: PlannedCycle[] = cycles.filter(cycle => {
    const cycleDate = new Date(cycle.startTime);
    const isStarted = cycle.status === 'in_progress';
    const isCompleted = cycle.status === 'completed' || cycle.status === 'failed';

    // Always keep completed/failed cycles
    if (isCompleted) return true;

    // Keep in-progress if locked
    if (lockStarted && isStarted) return true;

    // Keep cycles before start date
    if (cycleDate < startDate) return true;

    return false;
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

  // Log before saving for debugging
  console.log(`[planningRecalculator] Saving ${newCycles.length} cycles to origin: ${window.location.origin}`);

  // Save the updated cycles
  setItem(KEYS.PLANNED_CYCLES, newCycles);

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
  };
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
