/**
 * End Cycle Event Log Service
 * Logs every End Cycle decision for debugging and auditing
 * 
 * TWO-PHASE LOGGING:
 * Phase A (Immediate) - Right after decision, before replan
 * Phase B (PostReplan) - After autoReplan completes
 */

export interface EndCycleEventLogEntry {
  ts: string;
  cycleId: string;
  printerId: string;
  projectId: string;
  decision: 'complete_now' | 'defer_to_later' | 'merge_with_future' | 'ignore' | 'completed_successfully';
  inputs: {
    result: 'completed' | 'completed_with_scrap' | 'failed';
    unitsCompleted: number;
    unitsScrap: number;
    unitsToRecover: number;
    gramsWasted: number;
    cycleStatusBefore: string;
    plannedCyclesBefore: number;
    projectProgressBefore: {
      quantityGood: number;
      quantityScrap: number;
      quantityTarget: number;
    };
  };
  // Phase A: Immediate outputs (before replan)
  outputs: {
    cycleStatusAfter: string;
    plannedCyclesAfterImmediate: number; // Count right after decision, before replan
    projectProgressAfter: {
      quantityGood: number;
      quantityScrap: number;
      quantityTarget: number;
    };
    remakeProjectCreated?: string;
    mergeCycleId?: string;
    // IGNORE-specific: track unrecovered units
    unrecoveredUnits?: number;
    ignoredAtRisk?: boolean; // true if project will be short
  };
  // Phase B: Post-replan data (filled after autoReplan completes)
  postReplan?: {
    ts: string;
    plannedCyclesAfterReplan: number;
    replanDurationMs: number;
    cyclesChanged: number; // +N or -N from before decision
    replanSuccess: boolean;
    replanSummary?: string;
  };
  computedImpact?: {
    dominoEffect?: Array<{
      cycleId: string;
      projectId: string;
      projectName: string;
      printerId: string;
      printerName: string;
      originalStart: string;
      originalEnd: string;
      newStart: string;
      newEnd: string;
      delayHours: number;
      crossesDeadline: boolean;
    }>;
    deferAnalysis?: {
      latestStart: string;
      estimatedStart: string;
      riskLevel: string;
    };
    extensionImpact?: {
      additionalTimeNeeded: number;
      newEndTime: string;
      wouldCrossDeadline: boolean;
      wouldRequireOvernight: boolean;
      affectedCycles: Array<{
        cycleId: string;
        projectId: string;
        projectName: string;
        printerId: string;
        printerName: string;
        originalStart: string;
        originalEnd: string;
        newStart: string;
        newEnd: string;
        delayHours: number;
        crossesDeadline: boolean;
      }>;
    };
  };
  replanTriggered: boolean;
}

const STORAGE_KEY = 'end_cycle_event_log';

export function getEventLog(): EndCycleEventLogEntry[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export function logEndCycleEvent(entry: EndCycleEventLogEntry): void {
  const log = getEventLog();
  log.push(entry);
  // Keep last 100 entries
  if (log.length > 100) {
    log.splice(0, log.length - 100);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
  console.log('[EndCycleEventLog] Phase A (Immediate):', entry);
}

export function clearEventLog(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([]));
}

export function getLastEvent(): EndCycleEventLogEntry | null {
  const log = getEventLog();
  return log.length > 0 ? log[log.length - 1] : null;
}

/**
 * Update the last event with post-replan data (Phase B)
 * Called by autoReplan after replan completes
 */
export function updateLastEventWithPostReplan(postReplanData: {
  plannedCyclesAfterReplan: number;
  replanDurationMs: number;
  replanSuccess: boolean;
  replanSummary?: string;
}): void {
  const log = getEventLog();
  if (log.length === 0) return;
  
  const lastEvent = log[log.length - 1];
  
  // Only update if replanTriggered was true and no postReplan exists yet
  if (!lastEvent.replanTriggered || lastEvent.postReplan) {
    return;
  }
  
  const cyclesBefore = lastEvent.inputs.plannedCyclesBefore;
  const cyclesAfter = postReplanData.plannedCyclesAfterReplan;
  
  lastEvent.postReplan = {
    ts: new Date().toISOString(),
    plannedCyclesAfterReplan: cyclesAfter,
    replanDurationMs: postReplanData.replanDurationMs,
    cyclesChanged: cyclesAfter - cyclesBefore,
    replanSuccess: postReplanData.replanSuccess,
    replanSummary: postReplanData.replanSummary,
  };
  
  localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
  console.log('[EndCycleEventLog] Phase B (PostReplan):', lastEvent.postReplan);
}
