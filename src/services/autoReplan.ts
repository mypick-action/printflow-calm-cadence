// ============= AUTO-REPLANNING SERVICE =============
// Handles automatic replanning with debounce when data changes
// NO AI, NO Cloud - Pure local logic

import { toast } from 'sonner';
import { saveSnapshotAfterPlan } from './planningSnapshot';
import { addPlanningLogEntry } from './planningLogger';
import { updateLastEventWithPostReplan } from './endCycleEventLog';
import { getPlannedCycles } from './storage';

// Debounce configuration
const DEBOUNCE_MS = 1500; // 1.5 seconds debounce

// State
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingReason: string = '';
let isReplanning = false;

// Store the last replan timestamp
const LAST_REPLAN_KEY = 'printflow_last_auto_replan';

export const getLastAutoReplanTime = (): string | null => {
  return localStorage.getItem(LAST_REPLAN_KEY);
};

const setLastAutoReplanTime = (): void => {
  localStorage.setItem(LAST_REPLAN_KEY, new Date().toISOString());
};

/**
 * Schedule an automatic replan with debounce.
 * Multiple calls within the debounce window will be merged into one replan.
 * @param reason - The reason for replanning (for logging/tracking)
 */
export const scheduleAutoReplan = (reason: string): void => {
  // Don't schedule if already replanning
  if (isReplanning) {
    console.log('[AutoReplan] Skipping - replan already in progress');
    return;
  }

  // Track the reason (use the most recent one)
  pendingReason = reason;

  // Clear existing timer if any
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  // Schedule new replan
  debounceTimer = setTimeout(() => {
    executeAutoReplan();
  }, DEBOUNCE_MS);

  console.log(`[AutoReplan] Scheduled replan in ${DEBOUNCE_MS}ms, reason: ${reason}`);
};

/**
 * Execute the actual replanning.
 * This is called after the debounce period.
 */
const executeAutoReplan = async (): Promise<void> => {
  if (isReplanning) {
    console.log('[AutoReplan] Skipping execution - already running');
    return;
  }

  isReplanning = true;
  debounceTimer = null;
  const startTime = performance.now();

  try {
    console.log(`[AutoReplan] Executing replan, reason: ${pendingReason}`);

    // Dynamic import to avoid circular dependencies - import directly from recalculator
    const { recalculatePlan } = await import('./planningRecalculator');
    
    const result = recalculatePlan('from_now', true);
    const replanDurationMs = Math.round(performance.now() - startTime);
    
    // Log the replan result
    addPlanningLogEntry({
      reason: pendingReason as any,
      success: result.success,
      cyclesCreated: result.cyclesModified,
      unitsPlanned: 0, // Will be extracted from summary if needed
      warnings: [],
      errors: result.success ? [] : [result.summary],
    });
    
    // Phase B: Update end cycle event log with post-replan data
    const cyclesAfterReplan = getPlannedCycles().length;
    updateLastEventWithPostReplan({
      plannedCyclesAfterReplan: cyclesAfterReplan,
      replanDurationMs,
      replanSuccess: result.success,
      replanSummary: result.summary,
    });
    
    // Save snapshot after successful plan
    saveSnapshotAfterPlan();
    setLastAutoReplanTime();

    if (result.success) {
      // Show non-intrusive success toast
      toast.success('התכנון עודכן אוטומטית', {
        description: 'Plan updated automatically',
        duration: 3000,
      });
      console.log(`[AutoReplan] Success: ${result.summary}`);
    } else {
      // Show warning toast with blocking info
      toast.warning('התכנון נעצר – יש חסם', {
        description: 'Planning blocked – constraints found',
        duration: 5000,
        action: {
          label: 'פרטים',
          onClick: () => {
            // Navigate to planning page - will show the blocking issues
            window.location.hash = '#planning-conflicts';
          },
        },
      });
      console.log(`[AutoReplan] Blocked: ${result.summary}`);
    }
  } catch (error) {
    console.error('[AutoReplan] Error during replan:', error);
    toast.error('שגיאה בעדכון התכנון', {
      description: 'Error updating plan',
      duration: 4000,
    });
  } finally {
    isReplanning = false;
    pendingReason = '';
  }
};

/**
 * Cancel any pending auto-replan.
 * Useful when user manually triggers recalculation.
 */
export const cancelPendingAutoReplan = (): void => {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
    pendingReason = '';
    console.log('[AutoReplan] Pending replan cancelled');
  }
};

/**
 * Check if auto-replan is currently scheduled or running.
 */
export const isAutoReplanPending = (): boolean => {
  return debounceTimer !== null || isReplanning;
};
