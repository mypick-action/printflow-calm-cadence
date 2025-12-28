// ============= IMPACT ANALYSIS SERVICE =============
// Calculates the impact of cycle completion decisions on the schedule
// Used for decision support when cycles complete with defects or fail
// v2: Uses real schedule data instead of hardcoded values

import {
  Project,
  PlannedCycle,
  Product,
  getProjects,
  getPlannedCycles,
  getFactorySettings,
  getActivePrinters,
  getDayScheduleForDate,
  getProduct,
  getTemporaryOverrides,
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
  cycleDurationHours: number; // Actual cycle duration for capacity check
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
  // NEW: Include user input for display
  userEstimates: {
    estimatedPrintHours: number;
    needsSpoolChange: boolean;
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
  return { hours: hours || 0, minutes: minutes || 0 };
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

// Get cycle duration from startTime/endTime
const getCycleDurationHours = (cycle: PlannedCycle): number => {
  const start = new Date(cycle.startTime);
  const end = new Date(cycle.endTime);
  const durationMs = end.getTime() - start.getTime();
  return Math.max(0.5, durationMs / (1000 * 60 * 60)); // Minimum 0.5 hours
};

// Calculate remaining work hours today from current time
const getRemainingWorkHoursToday = (): number => {
  const settings = getFactorySettings();
  const overrides = getTemporaryOverrides();
  const now = new Date();
  const daySchedule = getDayScheduleForDate(now, settings, overrides);
  
  if (!daySchedule || !daySchedule.enabled) return 0;
  
  const end = parseTime(daySchedule.endTime);
  const endMinutes = end.hours * 60 + end.minutes;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  
  return Math.max(0, (endMinutes - nowMinutes) / 60);
};

// Calculate total available work hours until a date
const getWorkHoursUntilDate = (targetDate: Date): number => {
  const settings = getFactorySettings();
  const overrides = getTemporaryOverrides();
  const now = new Date();
  let totalHours = 0;
  let currentDate = new Date(now);
  
  // Add remaining hours today
  totalHours += getRemainingWorkHoursToday();
  currentDate.setDate(currentDate.getDate() + 1);
  currentDate.setHours(0, 0, 0, 0);
  
  // Add hours for each day until target
  while (currentDate <= targetDate) {
    const daySchedule = getDayScheduleForDate(currentDate, settings, overrides);
    if (daySchedule && daySchedule.enabled) {
      totalHours += getWorkingHoursForDay(daySchedule);
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  return totalHours;
};

// ============= ANALYSIS FUNCTIONS =============

/**
 * Calculates the impact on schedule if we add units immediately
 * Uses user-provided estimated hours for real calculation
 */
const calculateImmediateImpact = (
  unitsToAdd: number,
  color: string,
  estimatedHours: number,
  existingCycles: PlannedCycle[],
  projects: Project[],
  needsSpoolChange: boolean = false
): ScheduleImpact => {
  const settings = getFactorySettings();
  const overrides = getTemporaryOverrides();
  const printers = getActivePrinters();
  
  // Use user-provided estimated hours directly
  const hoursNeeded = estimatedHours;
  
  // Add time for spool change if needed (15 minutes)
  const totalHoursNeeded = needsSpoolChange ? hoursNeeded + 0.25 : hoursNeeded;
  
  // Find cycles that would be pushed - REAL calculation
  const today = new Date();
  const futureCycles = existingCycles.filter(c => 
    c.status === 'planned' && new Date(c.startTime) > today
  ).sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  
  // Calculate how many cycles will actually be pushed based on their real durations
  let hoursAccountedFor = 0;
  let cyclesPushed = 0;
  const affectedProjectIds = new Set<string>();
  
  for (const cycle of futureCycles) {
    if (hoursAccountedFor >= totalHoursNeeded) break;
    
    const cycleDuration = getCycleDurationHours(cycle);
    hoursAccountedFor += cycleDuration;
    cyclesPushed++;
    affectedProjectIds.add(cycle.projectId);
  }
  
  const affectedProjects = projects.filter(p => affectedProjectIds.has(p.id));
  
  // Check for overnight/weekend work based on remaining hours today
  const remainingToday = getRemainingWorkHoursToday();
  const requiresOvernightPrinting = totalHoursNeeded > remainingToday;
  
  // Check if today is Friday and work extends past normal hours
  const dayOfWeek = today.getDay();
  const requiresWeekendWork = (dayOfWeek === 5 && requiresOvernightPrinting) || dayOfWeek === 6;
  
  // Check deadline risks - REAL calculation
  const deadlineRisks: DeadlineRisk[] = [];
  
  for (const project of affectedProjects) {
    const dueDate = new Date(project.dueDate);
    
    // Find the last cycle for this project to get its completion time
    const projectCycles = futureCycles.filter(c => c.projectId === project.id);
    const lastCycle = projectCycles[projectCycles.length - 1];
    
    if (lastCycle) {
      const originalCompletion = new Date(lastCycle.endTime);
      const newCompletion = new Date(originalCompletion.getTime() + totalHoursNeeded * 60 * 60 * 1000);
      
      // Check if new completion is after due date
      if (newCompletion > dueDate) {
        const daysDelay = Math.ceil((newCompletion.getTime() - originalCompletion.getTime()) / (1000 * 60 * 60 * 24));
        deadlineRisks.push({
          projectId: project.id,
          projectName: project.name,
          dueDate: project.dueDate,
          originalCompletionDate: formatDateString(originalCompletion),
          newCompletionDate: formatDateString(newCompletion),
          daysDelay,
          willMissDeadline: true,
        });
      }
    }
  }
  
  const completionDate = new Date(today.getTime() + totalHoursNeeded * 60 * 60 * 1000);
  
  return {
    cyclesPushed,
    projectsAffected: Array.from(affectedProjectIds),
    affectedProjectNames: affectedProjects.map(p => p.name),
    requiresOvernightPrinting,
    requiresWeekendWork,
    deadlineRisks,
    estimatedCompletionDate: formatDateString(completionDate),
    hoursAdded: totalHoursNeeded,
  };
};

/**
 * Calculate impact for defer option - REAL deadline risk check
 */
const calculateDeferImpact = (
  projectId: string,
  unitsToRecover: number,
  estimatedHours: number,
  cycles: PlannedCycle[],
  projects: Project[]
): { willMissDeadline: boolean; daysAtRisk: number; reason: string; reasonHe: string } => {
  const project = projects.find(p => p.id === projectId);
  if (!project) {
    return { willMissDeadline: false, daysAtRisk: 0, reason: '', reasonHe: '' };
  }
  
  const dueDate = new Date(project.dueDate);
  const now = new Date();
  
  // Find the last planned cycle for this project
  const projectCycles = cycles
    .filter(c => c.projectId === projectId && c.status === 'planned')
    .sort((a, b) => new Date(b.endTime).getTime() - new Date(a.endTime).getTime());
  
  const lastCycle = projectCycles[0];
  
  // Calculate when a deferred cycle would be scheduled (after all current work)
  const allPlannedCycles = cycles
    .filter(c => c.status === 'planned')
    .sort((a, b) => new Date(b.endTime).getTime() - new Date(a.endTime).getTime());
  
  const lastPlannedCycle = allPlannedCycles[0];
  const estimatedDeferredStart = lastPlannedCycle 
    ? new Date(lastPlannedCycle.endTime)
    : now;
  
  const estimatedDeferredEnd = new Date(estimatedDeferredStart.getTime() + estimatedHours * 60 * 60 * 1000);
  
  // Check if deferred completion is after due date
  if (estimatedDeferredEnd > dueDate) {
    const daysLate = Math.ceil((estimatedDeferredEnd.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
    return {
      willMissDeadline: true,
      daysAtRisk: daysLate,
      reason: `Project due ${project.dueDate}. Deferred completion would be ${daysLate} days late.`,
      reasonHe: `הפרויקט אמור להסתיים ב-${project.dueDate}. השלמה דחויה תאחר ב-${daysLate} ימים.`,
    };
  }
  
  // Check if there's limited slack time
  const slackHours = getWorkHoursUntilDate(dueDate);
  if (slackHours < estimatedHours * 2) {
    return {
      willMissDeadline: false,
      daysAtRisk: 0,
      reason: `Low slack time until deadline (${slackHours.toFixed(1)}h available).`,
      reasonHe: `זמן גמיש נמוך עד הדדליין (${slackHours.toFixed(1)} שעות זמינות).`,
    };
  }
  
  return { willMissDeadline: false, daysAtRisk: 0, reason: '', reasonHe: '' };
};

/**
 * Finds future cycles that could potentially merge with remake units
 * Uses REAL capacity from product presets
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
  
  const project = projects.find(p => p.id === projectId);
  if (!project) return candidates;
  
  // Get product to find actual max units per plate
  const product = getProduct(project.productId);
  let maxUnitsPerPlate = 10; // Default fallback
  
  if (product && product.platePresets && product.platePresets.length > 0) {
    // Find the preset with maximum units
    maxUnitsPerPlate = Math.max(...product.platePresets.map(p => p.unitsPerPlate));
  }
  
  // Find same-project cycles that aren't at full capacity
  const sameProjectCycles = cycles.filter(c => 
    c.projectId === projectId &&
    c.status === 'planned' &&
    new Date(c.startTime) > today &&
    c.plateType !== 'closeout'
  ).sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  
  for (const cycle of sameProjectCycles.slice(0, 3)) {
    const printer = printers.find(p => p.id === cycle.printerId);
    const canAdd = Math.min(maxUnitsPerPlate - cycle.unitsPlanned, unitsNeeded);
    
    if (canAdd > 0) {
      const startTime = new Date(cycle.startTime);
      const cycleDuration = getCycleDurationHours(cycle);
      
      candidates.push({
        cycleId: cycle.id,
        projectId: cycle.projectId,
        projectName: project.name,
        printerId: cycle.printerId,
        printerName: printer?.name || 'Unknown',
        scheduledDate: formatDateString(startTime),
        scheduledTime: startTime.toTimeString().slice(0, 5),
        currentUnits: cycle.unitsPlanned,
        maxUnits: maxUnitsPerPlate,
        canAddUnits: canAdd,
        color,
        cycleDurationHours: cycleDuration,
      });
    }
  }
  
  return candidates;
};

/**
 * Main analysis function - calculates all options and their impacts
 * v2: All calculations are real, not hardcoded
 */
export const analyzeDecisionOptions = (
  projectId: string,
  unitsScrap: number,
  gramsWasted: number,
  cycleHours: number = 2.5,
  needsSpoolChange: boolean = false
): DecisionAnalysis => {
  const projects = getProjects();
  const cycles = getPlannedCycles();
  const project = projects.find(p => p.id === projectId);
  
  if (!project) {
    throw new Error('Project not found');
  }
  
  const remainingUnits = project.quantityTarget - project.quantityGood;
  
  // Calculate impact for immediate completion using user-provided hours
  const immediateImpact = calculateImmediateImpact(
    unitsScrap,
    project.color,
    cycleHours,
    cycles,
    projects,
    needsSpoolChange
  );
  
  // Calculate REAL defer impact
  const deferImpact = calculateDeferImpact(
    projectId,
    unitsScrap,
    cycleHours,
    cycles,
    projects
  );
  
  // Find merge candidates with REAL capacity
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
  if (immediateImpact.requiresWeekendWork) {
    immediateWarnings.push('May require weekend work');
    immediateWarningsHe.push('עלול לדרוש עבודה בסופ"ש');
  }
  if (immediateImpact.deadlineRisks.length > 0) {
    immediateWarnings.push(`${immediateImpact.deadlineRisks.length} project(s) at risk of missing deadline`);
    immediateWarningsHe.push(`${immediateImpact.deadlineRisks.length} פרויקטים בסיכון לפספס דדליין`);
  }
  
  options.push({
    option: 'complete_now',
    available: true,
    impact: immediateImpact,
    description: `Schedule ${unitsScrap} units immediately. Est. ${cycleHours}h print time.`,
    descriptionHe: `תזמן ${unitsScrap} יחידות מיידית. הערכה: ${cycleHours} שעות הדפסה.`,
    recommendation: immediateImpact.deadlineRisks.length === 0 && immediateImpact.cyclesPushed < 2 
      ? 'recommended' : 'neutral',
    warnings: immediateWarnings,
    warningsHe: immediateWarningsHe,
  });
  
  // Option 2: Defer to Later - now with REAL deadline check
  const deferWarnings: string[] = [];
  const deferWarningsHe: string[] = [];
  
  if (deferImpact.willMissDeadline) {
    deferWarnings.push(`Deadline at risk: ${deferImpact.daysAtRisk} days late`);
    deferWarningsHe.push(`דדליין בסיכון: איחור של ${deferImpact.daysAtRisk} ימים`);
  } else if (deferImpact.reason) {
    deferWarnings.push(deferImpact.reason);
    deferWarningsHe.push(deferImpact.reasonHe);
  }
  
  options.push({
    option: 'defer_to_later',
    available: true,
    impact: null,
    description: `Create remake project for ${unitsScrap} units, scheduled after current priorities.`,
    descriptionHe: `צור פרויקט השלמה ל-${unitsScrap} יחידות, מתוזמן אחרי עדיפויות נוכחיות.`,
    recommendation: deferImpact.willMissDeadline ? 'not_recommended' : 'neutral',
    warnings: deferWarnings,
    warningsHe: deferWarningsHe,
  });
  
  // Option 3: Merge with Future Cycle
  const canMerge = mergeCandidates.length > 0 && 
    mergeCandidates.some(c => c.canAddUnits >= unitsScrap);
  
  const mergeWarnings: string[] = [];
  const mergeWarningsHe: string[] = [];
  
  if (canMerge) {
    const bestCandidate = mergeCandidates.find(c => c.canAddUnits >= unitsScrap);
    if (bestCandidate) {
      mergeWarnings.push(`Will add ~${(unitsScrap * (bestCandidate.cycleDurationHours / bestCandidate.currentUnits)).toFixed(1)}h to cycle`);
      mergeWarningsHe.push(`יוסיף כ-${(unitsScrap * (bestCandidate.cycleDurationHours / bestCandidate.currentUnits)).toFixed(1)} שעות למחזור`);
    }
  }
  
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
    warnings: mergeWarnings,
    warningsHe: mergeWarningsHe,
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
    userEstimates: {
      estimatedPrintHours: cycleHours,
      needsSpoolChange,
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
  const materialCost = unitsScrap * 45;
  
  return {
    hoursToRecover,
    cyclesNeeded,
    materialCost: gramsWasted + materialCost,
  };
};
