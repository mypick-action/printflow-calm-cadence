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
let pendingReasons = new Set<string>(); // Accumulate multiple reasons for dedupe
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

  // Accumulate reasons (dedupe multiple triggers during debounce window)
  pendingReasons.add(reason);

  // ✅ CRITICAL: If timer already exists, just accumulate reasons - DON'T reset timer
  // This prevents continuous timer resets when multiple triggers arrive
  if (debounceTimer) {
    console.log(`[AutoReplan] Reason added: ${reason}, pending: ${Array.from(pendingReasons).join(', ')}`);
    return;
  }

  // Schedule new replan (only if no timer exists)
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
  
  // Capture and clear accumulated reasons
  const reasons = Array.from(pendingReasons);
  pendingReasons.clear();
  const combinedReason = reasons.join(',');
  
  const startTime = performance.now();

  try {
    console.log(`[AutoReplan] Executing replan, reasons: ${combinedReason}`);

    // Dynamic import to avoid circular dependencies - import directly from recalculator
    const { recalculatePlan } = await import('./planningRecalculator');
    
    const result = recalculatePlan('from_now', true);
    const replanDurationMs = Math.round(performance.now() - startTime);
    
    // Log the replan result
    addPlanningLogEntry({
      reason: combinedReason as any,
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

    // Determine toast based on actual data, not string matching
    const isBlocked = result.cyclesModified === 0 && result.blockingIssuesCount > 0;
    
    if (result.cyclesModified > 0) {
      // Cycles were created - this is success, even with warnings
      toast.success('התכנון עודכן אוטומטית', {
        description: 'Plan updated automatically',
        duration: 3000,
      });
      console.log(`[AutoReplan] Success: ${result.summary}`);
    } else if (isBlocked) {
      // True blocking - no cycles created AND there are blocking issues
      toast.warning('התכנון נעצר – יש חסם', {
        description: 'Planning blocked – constraints found',
        duration: 5000,
        action: {
          label: 'פרטים',
          onClick: () => {
            window.location.hash = '#planning-conflicts';
          },
        },
      });
      console.log(`[AutoReplan] Blocked: ${result.summary}`);
    } else {
      // No cycles but also no blocking issues (e.g., no active projects)
      console.log(`[AutoReplan] No changes: ${result.summary}`);
    }
  } catch (error) {
    console.error('[AutoReplan] Error during replan:', error);
    toast.error('שגיאה בעדכון התכנון', {
      description: 'Error updating plan',
      duration: 4000,
    });
  } finally {
    isReplanning = false;
    // pendingReasons already cleared at start of execution
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
    pendingReasons.clear();
    console.log('[AutoReplan] Pending replan cancelled');
  }
};

/**
 * Check if auto-replan is currently scheduled or running.
 */
export const isAutoReplanPending = (): boolean => {
  return debounceTimer !== null || isReplanning;
};

/**
 * Reset state for testing purposes only.
 * @internal
 */
export const __resetAutoReplanForTests = (): void => {
  pendingReasons.clear();
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
  isReplanning = false;
};
