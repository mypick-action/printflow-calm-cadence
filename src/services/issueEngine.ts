// ============= ISSUE ENGINE =============
// Deterministic rules-based decision system for production recovery
// NO AI, NO LLM, NO Cloud - Pure local logic

import {
  Project,
  Printer,
  PlannedCycle,
  Product,
  FactorySettings,
  getProjects,
  getPrinters,
  getProducts,
  getFactorySettings,
  getPlannedCycles,
  getActiveCycleForPrinter,
  getDayScheduleForDate,
} from './storage';
import { getAvailableGramsByColor } from './materialAdapter';

// ============= TYPES =============

export type IssueType = 
  | 'interrupted_mid_cycle'
  | 'completed_with_defects'
  | 'material_shortage'
  | 'time_overrun'
  | 'printer_failure'
  | 'unknown';

export interface IssueContext {
  printerId: string;
  projectId: string;
  issueType: IssueType;
  unitsLost?: number;
  gramsWasted?: number;
  cycleWasCompleted: boolean;
}

export interface RecoveryOption {
  id: string;
  type: 'reduce_units' | 'add_cycle' | 'change_spool' | 'extend_hours' | 'defer_units' | 'move_printer' | 'delay_project';
  title: string;
  titleEn: string;
  description: string;
  descriptionEn: string;
  impact: {
    unitsAffected: number;
    timeChange: number; // in hours (positive = more time needed)
    materialChange: number; // in grams (positive = more material needed)
  };
  resolvesIssue: boolean;
  priority: number; // 1 = highest priority
}

export interface IssueAnalysis {
  issueDetected: boolean;
  blockingReason: string;
  blockingReasonEn: string;
  recoveryOptions: RecoveryOption[];
  requiresUserDecision: boolean;
  context: {
    project: Project | null;
    printer: Printer | null;
    product: Product | null;
    activeCycle: PlannedCycle | null;
    remainingUnits: number;
    remainingTimeToday: number; // in hours
    remainingDaysUntilDue: number;
    availableFilament: number; // in grams
  };
}

// ============= HELPER FUNCTIONS =============

const getWorkingHoursForDate = (date: Date, settings: FactorySettings): number => {
  const schedule = getDayScheduleForDate(date, settings, []);
  if (!schedule || !schedule.enabled) return 0;
  
  const [startH, startM] = schedule.startTime.split(':').map(Number);
  const [endH, endM] = schedule.endTime.split(':').map(Number);
  
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;
  
  return (endMinutes - startMinutes) / 60;
};

const getRemainingWorkingHoursToday = (settings: FactorySettings): number => {
  const now = new Date();
  const schedule = getDayScheduleForDate(now, settings, []);
  
  if (!schedule || !schedule.enabled) return 0;
  
  const [endH, endM] = schedule.endTime.split(':').map(Number);
  const endMinutes = endH * 60 + endM;
  
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const remaining = endMinutes - currentMinutes;
  
  return Math.max(0, remaining / 60);
};

const getDaysUntilDue = (dueDate: string): number => {
  const due = new Date(dueDate);
  const now = new Date();
  const diffTime = due.getTime() - now.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

// Use centralized adapter for material availability
const getAvailableFilamentForColor = (color: string): number => {
  return getAvailableGramsByColor(color);
};

const getProductForProject = (project: Project): Product | null => {
  const products = getProducts();
  return products.find(p => p.id === project.productId) || null;
};

// ============= RULE ENGINE =============

const evaluateTimeConstraint = (
  remainingUnits: number,
  unitsPerCycle: number,
  cycleHours: number,
  remainingTimeToday: number,
  remainingDaysUntilDue: number,
  settings: FactorySettings
): { canFinishToday: boolean; canFinishOnTime: boolean; cyclesNeeded: number; hoursNeeded: number } => {
  const cyclesNeeded = Math.ceil(remainingUnits / unitsPerCycle);
  const hoursNeeded = cyclesNeeded * cycleHours;
  
  const canFinishToday = hoursNeeded <= remainingTimeToday;
  
  // Calculate total available hours until due date
  let totalAvailableHours = remainingTimeToday;
  const today = new Date();
  
  for (let i = 1; i < remainingDaysUntilDue; i++) {
    const futureDate = new Date(today);
    futureDate.setDate(today.getDate() + i);
    totalAvailableHours += getWorkingHoursForDate(futureDate, settings);
  }
  
  const canFinishOnTime = hoursNeeded <= totalAvailableHours;
  
  return { canFinishToday, canFinishOnTime, cyclesNeeded, hoursNeeded };
};

const evaluateMaterialConstraint = (
  remainingUnits: number,
  gramsPerUnit: number,
  availableFilament: number
): { hasSufficientMaterial: boolean; gramsNeeded: number; shortfall: number } => {
  const gramsNeeded = remainingUnits * gramsPerUnit;
  const hasSufficientMaterial = availableFilament >= gramsNeeded;
  const shortfall = Math.max(0, gramsNeeded - availableFilament);
  
  return { hasSufficientMaterial, gramsNeeded, shortfall };
};

// ============= RECOVERY OPTION GENERATORS =============

const generateReduceUnitsOption = (
  remainingUnits: number,
  currentUnitsPerCycle: number,
  cycleHours: number,
  remainingTimeToday: number,
  gramsPerUnit: number
): RecoveryOption | null => {
  // Calculate how many units can fit in remaining time
  const cyclesThatFit = Math.floor(remainingTimeToday / cycleHours);
  if (cyclesThatFit < 1) return null;
  
  // Suggest reducing by 20-30%
  const reducedUnits = Math.floor(currentUnitsPerCycle * 0.75);
  if (reducedUnits < 2) return null;
  
  const newCycleHours = cycleHours * (reducedUnits / currentUnitsPerCycle);
  const unitsPossible = cyclesThatFit * reducedUnits;
  
  return {
    id: 'reduce_units_1',
    type: 'reduce_units',
    title: `הפחת ל-${reducedUnits} יחידות למחזור`,
    titleEn: `Reduce to ${reducedUnits} units per cycle`,
    description: `זמן מחזור חדש: ${newCycleHours.toFixed(1)} שעות. ניתן להשלים ${unitsPossible} יחידות היום.`,
    descriptionEn: `New cycle time: ${newCycleHours.toFixed(1)}h. Can complete ${unitsPossible} units today.`,
    impact: {
      unitsAffected: unitsPossible,
      timeChange: -((currentUnitsPerCycle - reducedUnits) * (cycleHours / currentUnitsPerCycle)),
      materialChange: 0,
    },
    resolvesIssue: unitsPossible >= remainingUnits,
    priority: 2,
  };
};

const generateAddCycleOption = (
  remainingUnits: number,
  unitsPerCycle: number,
  cycleHours: number,
  remainingTimeToday: number
): RecoveryOption | null => {
  const currentCyclesPlanned = Math.floor(remainingTimeToday / cycleHours);
  const additionalCycleNeeded = Math.ceil(remainingUnits / unitsPerCycle) - currentCyclesPlanned;
  
  if (additionalCycleNeeded <= 0) return null;
  
  return {
    id: 'add_cycle_1',
    type: 'add_cycle',
    title: `הוסף ${additionalCycleNeeded} מחזורים נוספים מחר`,
    titleEn: `Add ${additionalCycleNeeded} extra cycle(s) tomorrow`,
    description: `יושלמו ${additionalCycleNeeded * unitsPerCycle} יחידות נוספות.`,
    descriptionEn: `Will complete ${additionalCycleNeeded * unitsPerCycle} additional units.`,
    impact: {
      unitsAffected: additionalCycleNeeded * unitsPerCycle,
      timeChange: additionalCycleNeeded * cycleHours,
      materialChange: 0,
    },
    resolvesIssue: true,
    priority: 3,
  };
};

const generateExtendHoursOption = (
  remainingUnits: number,
  unitsPerCycle: number,
  cycleHours: number,
  remainingTimeToday: number
): RecoveryOption | null => {
  const hoursNeeded = Math.ceil(remainingUnits / unitsPerCycle) * cycleHours;
  const extraHoursNeeded = hoursNeeded - remainingTimeToday;
  
  if (extraHoursNeeded <= 0) return null;
  if (extraHoursNeeded > 4) return null; // Max 4 hours overtime
  
  const newEndTime = 17.5 + extraHoursNeeded; // Assuming standard 17:30 end
  const endTimeFormatted = `${Math.floor(newEndTime)}:${(newEndTime % 1) * 60 === 0 ? '00' : '30'}`;
  
  return {
    id: 'extend_hours_1',
    type: 'extend_hours',
    title: `הארך יום עבודה עד ${endTimeFormatted}`,
    titleEn: `Extend workday until ${endTimeFormatted}`,
    description: `תוספת של ${extraHoursNeeded.toFixed(1)} שעות. משלים את כל היחידות היום.`,
    descriptionEn: `Adding ${extraHoursNeeded.toFixed(1)} hours. Completes all units today.`,
    impact: {
      unitsAffected: remainingUnits,
      timeChange: extraHoursNeeded,
      materialChange: 0,
    },
    resolvesIssue: true,
    priority: 1,
  };
};

const generateDeferUnitsOption = (
  remainingUnits: number,
  unitsPerCycle: number,
  remainingTimeToday: number,
  cycleHours: number
): RecoveryOption | null => {
  const unitsTodayPossible = Math.floor(remainingTimeToday / cycleHours) * unitsPerCycle;
  const unitsToDefer = remainingUnits - unitsTodayPossible;
  
  if (unitsToDefer <= 0) return null;
  
  return {
    id: 'defer_units_1',
    type: 'defer_units',
    title: `ייצר ${unitsTodayPossible} היום, ${unitsToDefer} מחר`,
    titleEn: `Produce ${unitsTodayPossible} today, ${unitsToDefer} tomorrow`,
    description: `עיכוב של יום אחד בהשלמה.`,
    descriptionEn: `One day delay in completion.`,
    impact: {
      unitsAffected: remainingUnits,
      timeChange: cycleHours * Math.ceil(unitsToDefer / unitsPerCycle),
      materialChange: 0,
    },
    resolvesIssue: true,
    priority: 4,
  };
};

const generateMaterialOptions = (
  shortfall: number,
  printer: Printer
): RecoveryOption[] => {
  const options: RecoveryOption[] = [];
  
  // Option 1: Use larger spool
  if (shortfall <= 2000) {
    options.push({
      id: 'change_spool_2kg',
      type: 'change_spool',
      title: 'החלף לגליל 2 ק"ג',
      titleEn: 'Switch to 2kg spool',
      description: `מספק ${2000}g נוספים.`,
      descriptionEn: `Provides additional ${2000}g.`,
      impact: {
        unitsAffected: 0,
        timeChange: 0.25, // 15 min spool change
        materialChange: 2000,
      },
      resolvesIssue: shortfall <= 2000,
      priority: 1,
    });
  }
  
  if (shortfall <= 5000) {
    options.push({
      id: 'change_spool_5kg',
      type: 'change_spool',
      title: 'החלף לגליל 5 ק"ג',
      titleEn: 'Switch to 5kg spool',
      description: `מספק ${5000}g נוספים.`,
      descriptionEn: `Provides additional ${5000}g.`,
      impact: {
        unitsAffected: 0,
        timeChange: 0.25,
        materialChange: 5000,
      },
      resolvesIssue: shortfall <= 5000,
      priority: 2,
    });
  }
  
  // Option 2: Use AMS if available
  if (printer.hasAMS) {
    options.push({
      id: 'use_ams',
      type: 'change_spool',
      title: 'השתמש ב-AMS עם גלילים מרובים',
      titleEn: 'Use AMS with multiple spools',
      description: 'טעינה אוטומטית ללא הפסקה.',
      descriptionEn: 'Automatic refill without stopping.',
      impact: {
        unitsAffected: 0,
        timeChange: 0,
        materialChange: shortfall,
      },
      resolvesIssue: true,
      priority: 1,
    });
  }
  
  return options;
};

const generateDelayProjectOption = (
  project: Project,
  daysNeeded: number
): RecoveryOption => {
  const newDueDate = new Date(project.dueDate);
  newDueDate.setDate(newDueDate.getDate() + daysNeeded);
  const formattedDate = newDueDate.toLocaleDateString('he-IL');
  
  return {
    id: 'delay_project_1',
    type: 'delay_project',
    title: `דחה תאריך יעד ב-${daysNeeded} ימים`,
    titleEn: `Delay due date by ${daysNeeded} days`,
    description: `תאריך יעד חדש: ${formattedDate}`,
    descriptionEn: `New due date: ${formattedDate}`,
    impact: {
      unitsAffected: 0,
      timeChange: daysNeeded * 8, // Assuming 8 hour workday
      materialChange: 0,
    },
    resolvesIssue: true,
    priority: 5,
  };
};

// ============= MAIN ANALYSIS FUNCTION =============

export const analyzeIssue = (context: IssueContext): IssueAnalysis => {
  const projects = getProjects();
  const printers = getPrinters();
  const settings = getFactorySettings();
  
  const project = projects.find(p => p.id === context.projectId) || null;
  const printer = printers.find(p => p.id === context.printerId) || null;
  const product = project ? getProductForProject(project) : null;
  const activeCycle = getActiveCycleForPrinter(context.printerId);
  
  // Calculate remaining units
  let remainingUnits = 0;
  if (project) {
    remainingUnits = project.quantityTarget - project.quantityGood;
    if (context.unitsLost) {
      remainingUnits += context.unitsLost;
    }
  }
  
  // Get time constraints
  const remainingTimeToday = settings ? getRemainingWorkingHoursToday(settings) : 0;
  const remainingDaysUntilDue = project ? getDaysUntilDue(project.dueDate) : 0;
  
  // Get material constraints
  const availableFilament = project ? getAvailableFilamentForColor(project.color) : 0;
  
  // Get preset info
  const defaultPreset = product?.platePresets.find(p => p.isRecommended) || product?.platePresets[0];
  const unitsPerCycle = defaultPreset?.unitsPerPlate || 8;
  const cycleHours = defaultPreset?.cycleHours || 2;
  const gramsPerUnit = product?.gramsPerUnit || 45;
  
  // Base analysis result
  const analysis: IssueAnalysis = {
    issueDetected: false,
    blockingReason: '',
    blockingReasonEn: '',
    recoveryOptions: [],
    requiresUserDecision: true,
    context: {
      project,
      printer,
      product,
      activeCycle,
      remainingUnits,
      remainingTimeToday,
      remainingDaysUntilDue,
      availableFilament,
    },
  };
  
  if (!project || !printer || !product || !settings) {
    analysis.issueDetected = true;
    analysis.blockingReason = 'חסרים נתונים קריטיים לניתוח.';
    analysis.blockingReasonEn = 'Missing critical data for analysis.';
    return analysis;
  }
  
  // Evaluate constraints
  const timeEval = evaluateTimeConstraint(
    remainingUnits,
    unitsPerCycle,
    cycleHours,
    remainingTimeToday,
    remainingDaysUntilDue,
    settings
  );
  
  const materialEval = evaluateMaterialConstraint(
    remainingUnits,
    gramsPerUnit,
    availableFilament
  );
  
  // Determine blocking reason based on issue type and constraints
  if (context.issueType === 'interrupted_mid_cycle' || context.issueType === 'printer_failure') {
    analysis.issueDetected = true;
    
    if (!timeEval.canFinishOnTime) {
      analysis.blockingReason = `לא ניתן להשלים ${remainingUnits} יחידות עד תאריך היעד. נדרשות ${timeEval.hoursNeeded.toFixed(1)} שעות עבודה.`;
      analysis.blockingReasonEn = `Cannot complete ${remainingUnits} units by due date. ${timeEval.hoursNeeded.toFixed(1)} work hours needed.`;
    } else if (!timeEval.canFinishToday) {
      analysis.blockingReason = `לא ניתן להשלים היום. נותרו ${remainingTimeToday.toFixed(1)} שעות, נדרשות ${timeEval.hoursNeeded.toFixed(1)}.`;
      analysis.blockingReasonEn = `Cannot complete today. ${remainingTimeToday.toFixed(1)}h remaining, ${timeEval.hoursNeeded.toFixed(1)}h needed.`;
    } else {
      analysis.blockingReason = `המחזור הופסק. נותרו ${remainingUnits} יחידות להשלמה.`;
      analysis.blockingReasonEn = `Cycle interrupted. ${remainingUnits} units remaining.`;
    }
  }
  
  if (context.issueType === 'completed_with_defects') {
    analysis.issueDetected = true;
    const defectUnits = context.unitsLost || 0;
    analysis.blockingReason = `${defectUnits} יחידות פגומות. נדרש לייצר ${defectUnits} יחידות נוספות.`;
    analysis.blockingReasonEn = `${defectUnits} defective units. Need to produce ${defectUnits} additional units.`;
  }
  
  if (context.issueType === 'material_shortage' || !materialEval.hasSufficientMaterial) {
    analysis.issueDetected = true;
    analysis.blockingReason = `חסר חומר גלם. נדרשים ${materialEval.gramsNeeded}g, זמינים ${availableFilament}g. חסרים ${materialEval.shortfall}g.`;
    analysis.blockingReasonEn = `Material shortage. Need ${materialEval.gramsNeeded}g, have ${availableFilament}g. Missing ${materialEval.shortfall}g.`;
  }
  
  if (context.issueType === 'time_overrun') {
    analysis.issueDetected = true;
    analysis.blockingReason = `חריגת זמן. נדרשות ${timeEval.hoursNeeded.toFixed(1)} שעות, ${timeEval.canFinishToday ? 'ניתן להשלים היום' : 'לא ניתן להשלים היום'}.`;
    analysis.blockingReasonEn = `Time overrun. ${timeEval.hoursNeeded.toFixed(1)}h needed, ${timeEval.canFinishToday ? 'can finish today' : 'cannot finish today'}.`;
  }
  
  // Generate recovery options based on detected issues
  const options: RecoveryOption[] = [];
  
  // Time-based options
  if (!timeEval.canFinishToday && remainingTimeToday > 0) {
    const extendOption = generateExtendHoursOption(remainingUnits, unitsPerCycle, cycleHours, remainingTimeToday);
    if (extendOption) options.push(extendOption);
    
    const reduceOption = generateReduceUnitsOption(remainingUnits, unitsPerCycle, cycleHours, remainingTimeToday, gramsPerUnit);
    if (reduceOption) options.push(reduceOption);
    
    const deferOption = generateDeferUnitsOption(remainingUnits, unitsPerCycle, remainingTimeToday, cycleHours);
    if (deferOption) options.push(deferOption);
  }
  
  // Always offer adding cycles if time permits
  if (!timeEval.canFinishToday) {
    const addCycleOption = generateAddCycleOption(remainingUnits, unitsPerCycle, cycleHours, remainingTimeToday);
    if (addCycleOption) options.push(addCycleOption);
  }
  
  // Material options
  if (!materialEval.hasSufficientMaterial) {
    const materialOptions = generateMaterialOptions(materialEval.shortfall, printer);
    options.push(...materialOptions);
  }
  
  // Last resort: delay project
  if (!timeEval.canFinishOnTime) {
    const daysNeeded = Math.ceil((timeEval.hoursNeeded - (remainingTimeToday + (remainingDaysUntilDue - 1) * 8)) / 8);
    if (daysNeeded > 0) {
      options.push(generateDelayProjectOption(project, daysNeeded));
    }
  }
  
  // Sort by priority
  options.sort((a, b) => a.priority - b.priority);
  
  // Limit to 4 options max
  analysis.recoveryOptions = options.slice(0, 4);
  
  // If no issue detected and we got here, something went wrong
  if (!analysis.issueDetected && context.issueType !== 'unknown') {
    analysis.issueDetected = true;
    analysis.blockingReason = 'זוהתה בעיה. בחרו אפשרות התאוששות.';
    analysis.blockingReasonEn = 'Issue detected. Select a recovery option.';
  }
  
  return analysis;
};

// ============= SIMPLE CONSTRAINTS CHECK =============
// For quick validation without full analysis

export const checkCanProceed = (
  projectId: string,
  printerId: string
): { canProceed: boolean; warnings: string[]; warningsEn: string[] } => {
  const projects = getProjects();
  const printers = getPrinters();
  const settings = getFactorySettings();
  
  const project = projects.find(p => p.id === projectId);
  const printer = printers.find(p => p.id === printerId);
  const product = project ? getProductForProject(project) : null;
  
  const warnings: string[] = [];
  const warningsEn: string[] = [];
  
  if (!project || !printer || !product || !settings) {
    return { canProceed: false, warnings: ['חסרים נתונים'], warningsEn: ['Missing data'] };
  }
  
  const remainingUnits = project.quantityTarget - project.quantityGood;
  const gramsPerUnit = product.gramsPerUnit;
  const availableFilament = getAvailableFilamentForColor(project.color);
  const gramsNeeded = remainingUnits * gramsPerUnit;
  
  if (availableFilament < gramsNeeded) {
    warnings.push(`חומר גלם לא מספיק (חסר ${gramsNeeded - availableFilament}g)`);
    warningsEn.push(`Insufficient material (missing ${gramsNeeded - availableFilament}g)`);
  }
  
  const remainingDays = getDaysUntilDue(project.dueDate);
  if (remainingDays <= 1) {
    warnings.push('תאריך יעד מחר או היום!');
    warningsEn.push('Due date is today or tomorrow!');
  }
  
  if (!printer.active) {
    warnings.push('המדפסת לא פעילה');
    warningsEn.push('Printer is not active');
  }
  
  return {
    canProceed: warnings.length === 0,
    warnings,
    warningsEn,
  };
};
