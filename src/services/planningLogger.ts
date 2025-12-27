// Planning Logger - stores last 50 planning executions for debugging
// All data stored in localStorage

const PLANNING_LOG_KEY = 'printflow_planning_log';
const MAX_LOG_ENTRIES = 50;

export interface PlanningLogEntry {
  timestamp: string;
  reason: 'project_created' | 'project_updated' | 'product_updated' | 'printer_changed' | 'manual_replan' | 'settings_changed' | 'unknown';
  inputSnapshot: {
    projectsTotal: number;
    projectsActive: number;
    printersTotal: number;
    printersActive: number;
    productsTotal: number;
    spoolsTotal: number;
  };
  output: {
    success: boolean;
    cyclesCreated: number;
    unitsPlanned: number;
  };
  warnings: string[];
  errors: string[];
  durationMs?: number;
}

export interface PlanningLogResult {
  entries: PlanningLogEntry[];
  lastEntry: PlanningLogEntry | null;
}

// Get all log entries
export const getPlanningLog = (): PlanningLogEntry[] => {
  try {
    const data = localStorage.getItem(PLANNING_LOG_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
};

// Add a new log entry
export const addPlanningLogEntry = (entry: {
  reason: PlanningLogEntry['reason'];
  success: boolean;
  cyclesCreated: number;
  unitsPlanned: number;
  warnings: string[];
  errors: string[];
  durationMs?: number;
}): void => {
  try {
    // Dynamically import to avoid circular deps
    const getInputSnapshot = (): PlanningLogEntry['inputSnapshot'] => {
      try {
        const projects = JSON.parse(localStorage.getItem('printflow_projects') || '[]');
        const printers = JSON.parse(localStorage.getItem('printflow_printers') || '[]');
        const products = JSON.parse(localStorage.getItem('printflow_products') || '[]');
        const spools = JSON.parse(localStorage.getItem('printflow_spools') || '[]');
        
        return {
          projectsTotal: projects.length,
          projectsActive: projects.filter((p: any) => p.status === 'in_progress' || p.status === 'pending').length,
          printersTotal: printers.length,
          printersActive: printers.filter((p: any) => p.status === 'active').length,
          productsTotal: products.length,
          spoolsTotal: spools.length,
        };
      } catch {
        return {
          projectsTotal: 0,
          projectsActive: 0,
          printersTotal: 0,
          printersActive: 0,
          productsTotal: 0,
          spoolsTotal: 0,
        };
      }
    };

    const logEntry: PlanningLogEntry = {
      timestamp: new Date().toISOString(),
      reason: entry.reason || 'unknown',
      inputSnapshot: getInputSnapshot(),
      output: {
        success: entry.success,
        cyclesCreated: entry.cyclesCreated,
        unitsPlanned: entry.unitsPlanned,
      },
      warnings: entry.warnings,
      errors: entry.errors,
      durationMs: entry.durationMs,
    };

    const entries = getPlanningLog();
    entries.unshift(logEntry); // Add to beginning

    // Keep only last 50 entries
    const trimmedEntries = entries.slice(0, MAX_LOG_ENTRIES);
    
    localStorage.setItem(PLANNING_LOG_KEY, JSON.stringify(trimmedEntries));
    
    console.log('[PlanningLogger] Entry added:', logEntry);
  } catch (error) {
    console.error('[PlanningLogger] Failed to add entry:', error);
  }
};

// Clear all log entries
export const clearPlanningLog = (): void => {
  localStorage.removeItem(PLANNING_LOG_KEY);
};

// Get last replan info for display
export const getLastReplanInfo = (): {
  lastReplanAt: string | null;
  lastReplanReason: string | null;
  lastReplanResult: {
    cyclesCreated: number;
    unitsPlanned: number;
    warningsCount: number;
    errorsCount: number;
  } | null;
} => {
  const entries = getPlanningLog();
  if (entries.length === 0) {
    return {
      lastReplanAt: null,
      lastReplanReason: null,
      lastReplanResult: null,
    };
  }

  const last = entries[0];
  return {
    lastReplanAt: last.timestamp,
    lastReplanReason: last.reason,
    lastReplanResult: {
      cyclesCreated: last.output.cyclesCreated,
      unitsPlanned: last.output.unitsPlanned,
      warningsCount: last.warnings.length,
      errorsCount: last.errors.length,
    },
  };
};
