// ============= IMPACT ANALYSIS SERVICE =============
// Calculates the impact of cycle completion decisions on the schedule
// Used for decision support when cycles complete with defects or fail

import {
  Project,
  PlannedCycle,
  getProjects,
  getPlannedCycles,
  getFactorySettings,
  getActivePrinters,
  getDayScheduleForDate,
} from './storage';

// ============= TYPES =============

export type DecisionOption = 
  | 'complete_now'      // Create remake and schedule immediately
  | 'defer_to_later'    // Create remake but schedule for later
  | 'merge_with_future' // Add to an existing future cycle
  | 'ignore';           // Don't create remake (just record scrap)

export interface ScheduleImpact {
  cyclesPushed: number;
  projectsAffected: string[];
  affectedProjectNames: string[];
  requiresOvernightPrinting: boolean;
  requiresWeekendWork: boolean;
  deadlineRisks: DeadlineRisk[];
  estimatedCompletionDate: string;
  hoursAdded: number;
}

export interface DeadlineRisk {
  projectId: string;
  projectName: string;
  dueDate: string;
  originalCompletionDate: string;
  newCompletionDate: string;
  daysDelay: number;
  willMissDeadline: boolean;
}

export interface MergeCandidate {
  cycleId: string;
  projectId: string;
  projectName: string;
  printerId: string;
  printerName: string;
  scheduledDate: string;
  scheduledTime: string;
  currentUnits: number;
  maxUnits: number;
  canAddUnits: number;
  color: string;
}

export interface DecisionAnalysis {
  unitsToRecover: number;
  gramsWasted: number;
  options: DecisionOptionAnalysis[];
  mergeCandidates: MergeCandidate[];
  originalProject: {
    id: string;
    name: string;
    dueDate: string;
    remainingUnits: number;
    color: string;
  };
}

export interface DecisionOptionAnalysis {
  option: DecisionOption;
  available: boolean;
  impact: ScheduleImpact | null;
  description: string;
  descriptionHe: string;
  recommendation: 'recommended' | 'neutral' | 'not_recommended';
  warnings: string[];
  warningsHe: string[];
}

// ============= HELPER FUNCTIONS =============

const formatDateString = (date: Date): string => {
  return date.toISOString().split('T')[0];
};

const parseTime = (timeStr: string): { hours: number; minutes: number } => {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return { hours, minutes };
};

const getWorkingHoursForDay = (schedule: { enabled: boolean; startTime: string; endTime: string } | null): number => {
  if (!schedule || !schedule.enabled) return 0;
  
  const start = parseTime(schedule.startTime);
  const end = parseTime(schedule.endTime);
  
  const startMinutes = start.hours * 60 + start.minutes;
  let endMinutes = end.hours * 60 + end.minutes;
  
  if (endMinutes < startMinutes) {
    endMinutes += 24 * 60;
  }
  
  return Math.max(0, (endMinutes - startMinutes) / 60);
};

// ============= ANALYSIS FUNCTIONS =============

/**
 * Calculates the impact on schedule if we add units immediately
 */
const calculateImmediateImpact = (
  unitsToAdd: number,
  color: string,
  cycleHours: number,
  existingCycles: PlannedCycle[],
  projects: Project[]
): ScheduleImpact => {
  const settings = getFactorySettings();
  const printers = getActivePrinters();
  
  // Calculate how many cycles needed for the units
  const cyclesNeeded = Math.ceil(unitsToAdd / 8); // Assume ~8 units per cycle
  const hoursNeeded = cyclesNeeded * cycleHours;
  
  // Find cycles that would be pushed
  const today = new Date();
  const futureCycles = existingCycles.filter(c => 
    c.status === 'planned' && new Date(c.startTime) > today
  ).sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  
  const cyclesPushed = Math.min(futureCycles.length, cyclesNeeded);
  const affectedProjectIds = new Set<string>();
  
  // Find which projects are affected
  for (let i = 0; i < cyclesPushed && i < futureCycles.length; i++) {
    affectedProjectIds.add(futureCycles[i].projectId);
  }
  
  const affectedProjects = projects.filter(p => affectedProjectIds.has(p.id));
  
  // Check for overnight/weekend work
  let requiresOvernightPrinting = false;
  let requiresWeekendWork = false;
  
  // Simple heuristic: if we're adding more than 4 hours, likely needs extended work
  if (hoursNeeded > 4) {
    const daySchedule = getDayScheduleForDate(today, settings, []);
    if (daySchedule) {
      const workHours = getWorkingHoursForDay(daySchedule);
      requiresOvernightPrinting = hoursNeeded > workHours;
    }
  }
  
  // Check deadline risks
  const deadlineRisks: DeadlineRisk[] = [];
  const estimatedDelay = Math.ceil(hoursNeeded / (printers.length * 8)); // Days of delay
  
  for (const project of affectedProjects) {
    const dueDate = new Date(project.dueDate);
    const originalCompletion = new Date(today);
    const newCompletion = new Date(today);
    newCompletion.setDate(newCompletion.getDate() + estimatedDelay);
    
    if (newCompletion > dueDate) {
      deadlineRisks.push({
        projectId: project.id,
        projectName: project.name,
        dueDate: project.dueDate,
        originalCompletionDate: formatDateString(originalCompletion),
        newCompletionDate: formatDateString(newCompletion),
        daysDelay: estimatedDelay,
        willMissDeadline: true,
      });
    }
  }
  
  const completionDate = new Date(today);
  completionDate.setDate(completionDate.getDate() + estimatedDelay);
  
  return {
    cyclesPushed,
    projectsAffected: Array.from(affectedProjectIds),
    affectedProjectNames: affectedProjects.map(p => p.name),
    requiresOvernightPrinting,
    requiresWeekendWork,
    deadlineRisks,
    estimatedCompletionDate: formatDateString(completionDate),
    hoursAdded: hoursNeeded,
  };
};

/**
 * Finds future cycles that could potentially merge with remake units
 */
const findMergeCandidates = (
  projectId: string,
  color: string,
  unitsNeeded: number,
  cycles: PlannedCycle[],
  projects: Project[]
): MergeCandidate[] => {
  const candidates: MergeCandidate[] = [];
  const printers = getActivePrinters();
  const today = new Date();
  
  // Find same-project cycles that aren't at full capacity
  const sameProjectCycles = cycles.filter(c => 
    c.projectId === projectId &&
    c.status === 'planned' &&
    new Date(c.startTime) > today &&
    c.plateType !== 'closeout'
  );
  
  const project = projects.find(p => p.id === projectId);
  if (!project) return candidates;
  
  for (const cycle of sameProjectCycles.slice(0, 3)) { // Limit to 3 options
    const printer = printers.find(p => p.id === cycle.printerId);
    const maxUnits = 10; // Assume max ~10 units per plate
    const canAdd = Math.min(maxUnits - cycle.unitsPlanned, unitsNeeded);
    
    if (canAdd > 0) {
      const startTime = new Date(cycle.startTime);
      candidates.push({
        cycleId: cycle.id,
        projectId: cycle.projectId,
        projectName: project.name,
        printerId: cycle.printerId,
        printerName: printer?.name || 'Unknown',
        scheduledDate: formatDateString(startTime),
        scheduledTime: startTime.toTimeString().slice(0, 5),
        currentUnits: cycle.unitsPlanned,
        maxUnits,
        canAddUnits: canAdd,
        color,
      });
    }
  }
  
  return candidates;
};

/**
 * Main analysis function - calculates all options and their impacts
 */
export const analyzeDecisionOptions = (
  projectId: string,
  unitsScrap: number,
  gramsWasted: number,
  cycleHours: number = 2.5
): DecisionAnalysis => {
  const projects = getProjects();
  const cycles = getPlannedCycles();
  const project = projects.find(p => p.id === projectId);
  
  if (!project) {
    throw new Error('Project not found');
  }
  
  const remainingUnits = project.quantityTarget - project.quantityGood;
  
  // Calculate impact for immediate completion
  const immediateImpact = calculateImmediateImpact(
    unitsScrap,
    project.color,
    cycleHours,
    cycles,
    projects
  );
  
  // Find merge candidates
  const mergeCandidates = findMergeCandidates(
    projectId,
    project.color,
    unitsScrap,
    cycles,
    projects
  );
  
  // Build options analysis
  const options: DecisionOptionAnalysis[] = [];
  
  // Option 1: Complete Now
  const immediateWarnings: string[] = [];
  const immediateWarningsHe: string[] = [];
  
  if (immediateImpact.cyclesPushed > 0) {
    immediateWarnings.push(`${immediateImpact.cyclesPushed} cycles will be pushed back`);
    immediateWarningsHe.push(`${immediateImpact.cyclesPushed} מחזורים יידחו`);
  }
  if (immediateImpact.requiresOvernightPrinting) {
    immediateWarnings.push('May require overnight printing');
    immediateWarningsHe.push('עלול לדרוש הדפסת לילה');
  }
  if (immediateImpact.deadlineRisks.length > 0) {
    immediateWarnings.push(`${immediateImpact.deadlineRisks.length} project(s) at risk of missing deadline`);
    immediateWarningsHe.push(`${immediateImpact.deadlineRisks.length} פרויקטים בסיכון לפספס דדליין`);
  }
  
  options.push({
    option: 'complete_now',
    available: true,
    impact: immediateImpact,
    description: `Schedule ${unitsScrap} units for immediate production. Other jobs may be delayed.`,
    descriptionHe: `תזמן ${unitsScrap} יחידות לייצור מיידי. עבודות אחרות עלולות להידחות.`,
    recommendation: immediateImpact.deadlineRisks.length === 0 ? 'recommended' : 'neutral',
    warnings: immediateWarnings,
    warningsHe: immediateWarningsHe,
  });
  
  // Option 2: Defer to Later
  options.push({
    option: 'defer_to_later',
    available: true,
    impact: null, // No immediate impact
    description: `Create remake project for ${unitsScrap} units, scheduled after current priorities.`,
    descriptionHe: `צור פרויקט השלמה ל-${unitsScrap} יחידות, מתוזמן אחרי עדיפויות נוכחיות.`,
    recommendation: 'neutral',
    warnings: ['Original deadline may be at risk'],
    warningsHe: ['הדדליין המקורי עלול להיות בסיכון'],
  });
  
  // Option 3: Merge with Future Cycle
  const canMerge = mergeCandidates.length > 0 && 
    mergeCandidates.some(c => c.canAddUnits >= unitsScrap);
  
  options.push({
    option: 'merge_with_future',
    available: canMerge,
    impact: null,
    description: canMerge 
      ? `Add ${unitsScrap} units to an existing future cycle of the same project.`
      : 'No suitable future cycles available for merging.',
    descriptionHe: canMerge
      ? `הוסף ${unitsScrap} יחידות למחזור עתידי קיים של אותו פרויקט.`
      : 'אין מחזורים עתידיים מתאימים למיזוג.',
    recommendation: canMerge ? 'recommended' : 'not_recommended',
    warnings: [],
    warningsHe: [],
  });
  
  // Option 4: Ignore (just record scrap)
  options.push({
    option: 'ignore',
    available: true,
    impact: null,
    description: `Record ${unitsScrap} units as scrap. No remake project will be created.`,
    descriptionHe: `רשום ${unitsScrap} יחידות כנפלים. לא ייווצר פרויקט השלמה.`,
    recommendation: 'not_recommended',
    warnings: ['Project will remain incomplete', 'Customer order may be short'],
    warningsHe: ['הפרויקט יישאר לא מושלם', 'ההזמנה עלולה להיות חסרה'],
  });
  
  return {
    unitsToRecover: unitsScrap,
    gramsWasted,
    options,
    mergeCandidates,
    originalProject: {
      id: project.id,
      name: project.name,
      dueDate: project.dueDate,
      remainingUnits,
      color: project.color,
    },
  };
};

/**
 * Quick impact summary for UI display
 */
export const getQuickImpactSummary = (
  unitsScrap: number,
  gramsWasted: number,
  cycleHours: number = 2.5
): {
  hoursToRecover: number;
  cyclesNeeded: number;
  materialCost: number;
} => {
  const cyclesNeeded = Math.ceil(unitsScrap / 8);
  const hoursToRecover = cyclesNeeded * cycleHours;
  const materialCost = unitsScrap * 45; // Rough estimate 45g per unit
  
  return {
    hoursToRecover,
    cyclesNeeded,
    materialCost: gramsWasted + materialCost,
  };
};
