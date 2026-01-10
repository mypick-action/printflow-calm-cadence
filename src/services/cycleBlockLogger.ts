// Cycle Block Logger
// Logs why cycles are blocked during planning
// Used for debugging and understanding planning decisions

const BLOCK_LOG_KEY = 'printflow_cycle_blocks';
const MAX_LOG_ENTRIES = 100;

// Block reason types
export type CycleBlockReason =
  | 'plates_limit'              // Physical plate count exceeded for autonomous cycles
  | 'material_insufficient'     // Not enough material (grams)
  | 'spool_parallel_limit'      // Too many printers need same color
  | 'after_hours_policy'        // After-hours policy prevents cycle
  | 'no_night_preset'           // Preset not allowed for night cycles
  | 'printer_inactive'          // Printer is not active
  | 'no_matching_preset'        // No preset fits constraints
  | 'deadline_passed'           // Project deadline already passed
  | 'project_complete'          // Project already completed
  | 'color_lock_night'          // Non-AMS printer locked to different color during night
  | 'no_physical_color_night'   // No physical color known - cannot schedule at night
  | 'cycle_too_long_night';     // Cycle duration exceeds night window

export interface CycleBlockEntry {
  timestamp: string;
  reason: CycleBlockReason;
  projectId?: string;
  projectName?: string;
  printerId?: string;
  printerName?: string;
  presetId?: string;
  presetName?: string;
  details: string;
  scheduledDate?: string;
  cycleHours?: number;
  gramsRequired?: number;
  gramsAvailable?: number;
}

export interface BlockSummary {
  total: number;
  byReason: Record<CycleBlockReason, number>;
  recentBlocks: CycleBlockEntry[];
}

// Get all block log entries
export const getBlockLog = (): CycleBlockEntry[] => {
  try {
    const data = localStorage.getItem(BLOCK_LOG_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
};

// Log a cycle block
export const logCycleBlock = (entry: Omit<CycleBlockEntry, 'timestamp'>): void => {
  const fullEntry: CycleBlockEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
  };

  try {
    const entries = getBlockLog();
    entries.unshift(fullEntry);
    
    // Keep only last 100 entries
    const trimmed = entries.slice(0, MAX_LOG_ENTRIES);
    localStorage.setItem(BLOCK_LOG_KEY, JSON.stringify(trimmed));
    
    // Also log to console with clear formatting
    console.log(
      `[CycleBlock] ❌ ${entry.reason}`,
      {
        project: entry.projectName || entry.projectId,
        printer: entry.printerName || entry.printerId,
        preset: entry.presetName || entry.presetId,
        details: entry.details,
        date: entry.scheduledDate,
      }
    );
  } catch (error) {
    console.error('[CycleBlockLogger] Failed to log entry:', error);
  }
};

// Get summary of blocked cycles
export const getBlockSummary = (): BlockSummary => {
  const entries = getBlockLog();
  
  const byReason: Record<CycleBlockReason, number> = {
    plates_limit: 0,
    material_insufficient: 0,
    spool_parallel_limit: 0,
    after_hours_policy: 0,
    no_night_preset: 0,
    printer_inactive: 0,
    no_matching_preset: 0,
    deadline_passed: 0,
    project_complete: 0,
    color_lock_night: 0,
    no_physical_color_night: 0,
    cycle_too_long_night: 0,
  };
  
  for (const entry of entries) {
    if (byReason[entry.reason] !== undefined) {
      byReason[entry.reason]++;
    }
  }
  
  return {
    total: entries.length,
    byReason,
    recentBlocks: entries.slice(0, 10),
  };
};

// Clear block log
export const clearBlockLog = (): void => {
  localStorage.removeItem(BLOCK_LOG_KEY);
  console.log('[CycleBlockLogger] Log cleared');
};

// Get blocks for current planning session (since last replan)
export const getSessionBlocks = (sinceTimestamp: string): CycleBlockEntry[] => {
  const entries = getBlockLog();
  return entries.filter(e => e.timestamp >= sinceTimestamp);
};

// Format block summary for display
export const formatBlockSummary = (summary: BlockSummary): string => {
  const lines: string[] = [];
  
  lines.push(`סה"כ חסימות: ${summary.total}`);
  lines.push('---');
  
  const reasonLabels: Record<CycleBlockReason, string> = {
    plates_limit: 'הגבלת פלטות',
    material_insufficient: 'חוסר חומר גלם',
    spool_parallel_limit: 'הגבלת מקביליות גלילים',
    after_hours_policy: 'מדיניות שעות לילה',
    no_night_preset: 'פריסט לא מותר ללילה',
    printer_inactive: 'מדפסת לא פעילה',
    no_matching_preset: 'אין פריסט מתאים',
    deadline_passed: 'דדליין עבר',
    project_complete: 'פרויקט הושלם',
    color_lock_night: 'נעילת צבע בלילה (ללא AMS)',
    no_physical_color_night: 'אין צבע פיזי ידוע (ללא AMS)',
    cycle_too_long_night: 'מחזור ארוך מחלון הלילה',
  };
  
  for (const [reason, count] of Object.entries(summary.byReason)) {
    if (count > 0) {
      const label = reasonLabels[reason as CycleBlockReason] || reason;
      lines.push(`${label}: ${count}`);
    }
  }
  
  return lines.join('\n');
};

// Debug: Print summary to console
export const logBlockSummary = (): void => {
  const summary = getBlockSummary();
  console.group('[CycleBlockLogger] Block Summary');
  console.log(`Total blocks logged: ${summary.total}`);
  console.table(summary.byReason);
  if (summary.recentBlocks.length > 0) {
    console.log('Recent blocks:');
    console.table(summary.recentBlocks.map(b => ({
      reason: b.reason,
      project: b.projectName || b.projectId,
      printer: b.printerName || b.printerId,
      details: b.details,
      time: b.timestamp,
    })));
  }
  console.groupEnd();
};

// Expose to window for debugging
if (typeof window !== 'undefined') {
  (window as any).BlockLog = {
    get: getBlockLog,
    summary: getBlockSummary,
    log: logBlockSummary,
    clear: clearBlockLog,
    format: formatBlockSummary,
  };
}
