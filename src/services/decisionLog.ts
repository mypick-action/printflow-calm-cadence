// ============= DECISION LOG SERVICE =============
// Logs all end-cycle decisions with computed impact data
// Supports 30-second undo functionality

import { DecisionOption, ScheduleImpact, MergeCandidate } from './impactAnalysis';

export interface DecisionLogEntry {
  id: string;
  timestamp: string;
  // Decision context
  printerId: string;
  printerName: string;
  projectId: string;
  projectName: string;
  cycleId: string;
  cycleResult: 'completed_with_scrap' | 'failed';
  
  // Units and material
  unitsToRecover: number;
  gramsWasted: number;
  
  // User-provided estimation
  estimatedPrintHours: number;
  needsSpoolChange: boolean;
  
  // Decision made
  decision: DecisionOption;
  mergeCycleId?: string;
  
  // Computed impact at decision time
  computedImpact: {
    cyclesPushed: number;
    projectsAffected: string[];
    hoursAdded: number;
    requiresOvernightPrinting: boolean;
    requiresWeekendWork: boolean;
    deadlineRisksCount: number;
    deadlineRiskProjects: string[];
  };
  
  // For undo
  undoExpiry: string; // ISO timestamp when undo expires
  undoData: {
    // Data needed to reverse the decision
    originalCycleState?: any;
    createdProjectId?: string;
    mergedCycleId?: string;
    previousMergedUnits?: number;
  };
  isUndone: boolean;
}

const STORAGE_KEY = 'decision_log';
const UNDO_WINDOW_SECONDS = 30;

// Get all decision logs
export const getDecisionLog = (): DecisionLogEntry[] => {
  const data = localStorage.getItem(STORAGE_KEY);
  return data ? JSON.parse(data) : [];
};

// Add a new decision log entry
export const logDecision = (
  entry: Omit<DecisionLogEntry, 'id' | 'timestamp' | 'undoExpiry' | 'isUndone'>
): DecisionLogEntry => {
  const log = getDecisionLog();
  const now = new Date();
  const undoExpiry = new Date(now.getTime() + UNDO_WINDOW_SECONDS * 1000);
  
  const newEntry: DecisionLogEntry = {
    ...entry,
    id: `decision_${now.getTime()}_${Math.random().toString(36).substr(2, 9)}`,
    timestamp: now.toISOString(),
    undoExpiry: undoExpiry.toISOString(),
    isUndone: false,
  };
  
  // Keep last 100 decisions
  const updatedLog = [newEntry, ...log].slice(0, 100);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedLog));
  
  return newEntry;
};

// Check if decision can still be undone
export const canUndoDecision = (entryId: string): boolean => {
  const log = getDecisionLog();
  const entry = log.find(e => e.id === entryId);
  
  if (!entry || entry.isUndone) return false;
  
  const now = new Date();
  const expiry = new Date(entry.undoExpiry);
  
  return now < expiry;
};

// Get remaining undo time in seconds
export const getUndoTimeRemaining = (entryId: string): number => {
  const log = getDecisionLog();
  const entry = log.find(e => e.id === entryId);
  
  if (!entry || entry.isUndone) return 0;
  
  const now = new Date();
  const expiry = new Date(entry.undoExpiry);
  const remaining = Math.max(0, (expiry.getTime() - now.getTime()) / 1000);
  
  return Math.ceil(remaining);
};

// Mark decision as undone
export const markDecisionUndone = (entryId: string): DecisionLogEntry | null => {
  const log = getDecisionLog();
  const entryIndex = log.findIndex(e => e.id === entryId);
  
  if (entryIndex === -1) return null;
  
  log[entryIndex].isUndone = true;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
  
  return log[entryIndex];
};

// Get last decision for potential undo
export const getLastUndoableDecision = (): DecisionLogEntry | null => {
  const log = getDecisionLog();
  
  for (const entry of log) {
    if (!entry.isUndone && canUndoDecision(entry.id)) {
      return entry;
    }
  }
  
  return null;
};

// Create computed impact summary from analysis
export const createComputedImpact = (
  impact: ScheduleImpact | null
): DecisionLogEntry['computedImpact'] => {
  if (!impact) {
    return {
      cyclesPushed: 0,
      projectsAffected: [],
      hoursAdded: 0,
      requiresOvernightPrinting: false,
      requiresWeekendWork: false,
      deadlineRisksCount: 0,
      deadlineRiskProjects: [],
    };
  }
  
  return {
    cyclesPushed: impact.cyclesPushed,
    projectsAffected: impact.projectsAffected,
    hoursAdded: impact.hoursAdded,
    requiresOvernightPrinting: impact.requiresOvernightPrinting,
    requiresWeekendWork: impact.requiresWeekendWork,
    deadlineRisksCount: impact.deadlineRisks.length,
    deadlineRiskProjects: impact.deadlineRisks.map(r => r.projectName),
  };
};

// Get recent decisions for debugging/display
export const getRecentDecisions = (count: number = 10): DecisionLogEntry[] => {
  return getDecisionLog().slice(0, count);
};
