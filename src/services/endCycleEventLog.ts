/**
 * End Cycle Event Log Service
 * Logs every End Cycle decision for debugging and auditing
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
  outputs: {
    cycleStatusAfter: string;
    plannedCyclesAfter: number;
    projectProgressAfter: {
      quantityGood: number;
      quantityScrap: number;
      quantityTarget: number;
    };
    remakeProjectCreated?: string;
    mergeCycleId?: string;
  };
  computedImpact?: {
    dominoEffect?: Array<{
      cycleId: string;
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
      affectedCycles: number;
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
  console.log('[EndCycleEventLog]', entry);
}

export function clearEventLog(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([]));
}

export function getLastEvent(): EndCycleEventLogEntry | null {
  const log = getEventLog();
  return log.length > 0 ? log[log.length - 1] : null;
}
