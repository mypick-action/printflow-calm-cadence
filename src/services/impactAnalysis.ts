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
  // NEW: Domino effect details
  dominoEffect: DominoCycle[];
}

export interface DominoCycle {
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
}

export interface DeferImpact {
  willMissDeadline: boolean;
  daysAtRisk: number;
  latestStart: string;
  estimatedStart: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  reason: string;
  reasonHe: string;
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
  cycleDurationHours: number;
  // NEW: Time-based capacity
  availableTimeHours: number; // How much time can be added to this cycle
  extensionImpact: {
    additionalTimeNeeded: number; // Hours added by merging
    newEndTime: string;
    wouldCrossDeadline: boolean;
    wouldRequireOvernight: boolean;
    affectedCycles: DominoCycle[]; // Full domino effect details
  };
}

// Debug info for merge rejection
export interface MergeRejection {
  cycleId: string;
  projectId: string;
  startTime: string;
  status: string;
  plateType: string;
  unitsPlanned: number;
  printerId: string;
  reason: 'not_planned' | 'not_future' | 'different_project' | 'closeout' | 'no_capacity' | 'missing_presets' | 'no_project';
}

export interface MergeDebugInfo {
  totalCyclesChecked: number;
  sameProjectCyclesFound: number;
  rejections: MergeRejection[];
  summary: Record<string, number>;
  maxUnitsPerPlate: number;
  hoursPerUnit: number;
  productFound: boolean;
}

export interface DecisionAnalysis {
  unitsToRecover: number;
  gramsWasted: number;
  options: DecisionOptionAnalysis[];
  mergeCandidates: MergeCandidate[];
  mergeDebug?: MergeDebugInfo; // Debug info for merge
  originalProject: {
    id: string;
    name: string;
    dueDate: string;
    remainingUnits: number;
    color: string;
  };
  // User input for display
  userEstimates: {
    estimatedPrintHours: number;
    needsSpoolChange: boolean;
  };
  // Defer analysis details
  deferAnalysis: DeferImpact;
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
  needsSpoolChange: boolean = false,
  targetPrinterId?: string
): ScheduleImpact => {
  const settings = getFactorySettings();
  const overrides = getTemporaryOverrides();
  const printers = getActivePrinters();
  
  // Use user-provided estimated hours directly
  const hoursNeeded = estimatedHours;
  
  // Add time for spool change if needed (15 minutes)
  const totalHoursNeeded = needsSpoolChange ? hoursNeeded + 0.25 : hoursNeeded;
  
  // Find the target printer (either specified or first available)
  const targetPrinter = targetPrinterId 
    ? printers.find(p => p.id === targetPrinterId)
    : printers[0];
  
  // Find cycles that would be pushed - ONLY for the SAME printer
  const today = new Date();
  const futureCycles = existingCycles.filter(c => 
    c.status === 'planned' && 
    new Date(c.startTime) > today &&
    (!targetPrinter || c.printerId === targetPrinter.id) // Filter by same printer
  ).sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  
  // Build domino effect with CHAIN calculation (start = max(prevEnd, originalStart))
  const dominoEffect: DominoCycle[] = [];
  let previousNewEnd: Date | null = null;
  let cyclesPushed = 0;
  const affectedProjectIds = new Set<string>();
  
  for (const cycle of futureCycles) {
    const project = projects.find(p => p.id === cycle.projectId);
    const printer = printers.find(p => p.id === cycle.printerId);
    
    const originalStart = new Date(cycle.startTime);
    const originalEnd = new Date(cycle.endTime);
    const cycleDuration = getCycleDurationHours(cycle);
    
    // Calculate new start: max(previousCycleNewEnd, originalStart + delay)
    let newStart: Date;
    if (previousNewEnd) {
      // Chain calculation: start after the previous pushed cycle ends
      newStart = new Date(Math.max(previousNewEnd.getTime(), originalStart.getTime() + totalHoursNeeded * 60 * 60 * 1000));
    } else {
      // First cycle: just add the delay from the new immediate work
      newStart = new Date(originalStart.getTime() + totalHoursNeeded * 60 * 60 * 1000);
    }
    
    const newEnd = new Date(newStart.getTime() + cycleDuration * 60 * 60 * 1000);
    const delayHours = (newStart.getTime() - originalStart.getTime()) / (1000 * 60 * 60);
    
    // Only count as affected if there's actual delay
    if (delayHours < 0.1) break; // Stop if no significant delay
    
    // Check if this cycle's delay causes deadline crossing
    const dueDate = project ? new Date(project.dueDate) : null;
    const crossesDeadline = dueDate ? newEnd > dueDate : false;
    
    dominoEffect.push({
      cycleId: cycle.id,
      projectId: cycle.projectId,
      projectName: project?.name || 'Unknown',
      printerId: cycle.printerId,
      printerName: printer?.name || 'Unknown',
      originalStart: originalStart.toISOString(),
      originalEnd: originalEnd.toISOString(),
      newStart: newStart.toISOString(),
      newEnd: newEnd.toISOString(),
      delayHours,
      crossesDeadline,
    });
    
    cyclesPushed++;
    affectedProjectIds.add(cycle.projectId);
    previousNewEnd = newEnd;
    
    // Limit domino effect to 5 cycles for readability
    if (dominoEffect.length >= 5) break;
  }
  
  const affectedProjects = projects.filter(p => affectedProjectIds.has(p.id));
  
  // Check for overnight/weekend work based on remaining hours today
  const remainingToday = getRemainingWorkHoursToday();
  const requiresOvernightPrinting = totalHoursNeeded > remainingToday;
  
  // Check if today is Friday and work extends past normal hours
  const dayOfWeek = today.getDay();
  const requiresWeekendWork = (dayOfWeek === 5 && requiresOvernightPrinting) || dayOfWeek === 6;
  
  // Check deadline risks - from domino effect
  const deadlineRisks: DeadlineRisk[] = dominoEffect
    .filter(d => d.crossesDeadline)
    .map(d => {
      const project = projects.find(p => p.id === d.projectId);
      const cycle = futureCycles.find(c => c.id === d.cycleId);
      return {
        projectId: d.projectId,
        projectName: d.projectName,
        dueDate: project?.dueDate || '',
        originalCompletionDate: cycle?.endTime.split('T')[0] || '',
        newCompletionDate: new Date(new Date(cycle?.endTime || '').getTime() + d.delayHours * 60 * 60 * 1000).toISOString().split('T')[0],
        daysDelay: Math.ceil(d.delayHours / 24),
        willMissDeadline: true,
      };
    });
  
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
    dominoEffect,
  };
};

/**
 * Calculate impact for defer option - REAL deadline risk check with latestStart and riskLevel
 */

const calculateDeferImpact = (
  projectId: string,
  unitsToRecover: number,
  estimatedHours: number,
  cycles: PlannedCycle[],
  projects: Project[]
): DeferImpact => {
  const project = projects.find(p => p.id === projectId);
  if (!project) {
    return { 
      willMissDeadline: false, 
      daysAtRisk: 0, 
      latestStart: '', 
      estimatedStart: '',
      riskLevel: 'low',
      reason: '', 
      reasonHe: '' 
    };
  }
  
  const dueDate = new Date(project.dueDate);
  const now = new Date();
  
  // Calculate latestStart: due date minus estimated hours (in work days)
  const latestStartDate = new Date(dueDate.getTime() - estimatedHours * 60 * 60 * 1000);
  const latestStart = formatDateString(latestStartDate);
  
  // Calculate when a deferred cycle would be scheduled (after all current work)
  const allPlannedCycles = cycles
    .filter(c => c.status === 'planned')
    .sort((a, b) => new Date(b.endTime).getTime() - new Date(a.endTime).getTime());
  
  const lastPlannedCycle = allPlannedCycles[0];
  const estimatedDeferredStart = lastPlannedCycle 
    ? new Date(lastPlannedCycle.endTime)
    : now;
  
  const estimatedStart = formatDateString(estimatedDeferredStart);
  const estimatedDeferredEnd = new Date(estimatedDeferredStart.getTime() + estimatedHours * 60 * 60 * 1000);
  
  // Calculate slack time
  const slackHours = getWorkHoursUntilDate(dueDate);
  const slackRatio = slackHours / estimatedHours;
  
  // Determine risk level based on slack ratio
  let riskLevel: 'low' | 'medium' | 'high' | 'critical';
  if (estimatedDeferredEnd > dueDate) {
    riskLevel = 'critical';
  } else if (slackRatio < 1.5) {
    riskLevel = 'high';
  } else if (slackRatio < 3) {
    riskLevel = 'medium';
  } else {
    riskLevel = 'low';
  }
  
  // Check if deferred completion is after due date
  if (estimatedDeferredEnd > dueDate) {
    const daysLate = Math.ceil((estimatedDeferredEnd.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
    return {
      willMissDeadline: true,
      daysAtRisk: daysLate,
      latestStart,
      estimatedStart,
      riskLevel,
      reason: `Project due ${project.dueDate}. Deferred completion would be ${daysLate} days late.`,
      reasonHe: `הפרויקט אמור להסתיים ב-${project.dueDate}. השלמה דחויה תאחר ב-${daysLate} ימים.`,
    };
  }
  
  // Build reason based on risk level
  let reason = '';
  let reasonHe = '';
  
  if (riskLevel === 'high') {
    reason = `Low slack time until deadline (${slackHours.toFixed(1)}h available for ${estimatedHours}h job).`;
    reasonHe = `זמן גמיש נמוך (${slackHours.toFixed(1)} שעות זמינות ל-${estimatedHours} שעות עבודה).`;
  } else if (riskLevel === 'medium') {
    reason = `Moderate slack time (${slackHours.toFixed(1)}h available).`;
    reasonHe = `זמן גמיש בינוני (${slackHours.toFixed(1)} שעות זמינות).`;
  }
  
  return { 
    willMissDeadline: false, 
    daysAtRisk: 0, 
    latestStart,
    estimatedStart,
    riskLevel,
    reason, 
    reasonHe 
  };
};

/**
 * Finds future cycles that could potentially merge with remake units
 * Uses REAL capacity from product presets
 * Returns both candidates AND debug info for rejected cycles
 */
const findMergeCandidates = (
  projectId: string,
  color: string,
  unitsNeeded: number,
  cycles: PlannedCycle[],
  projects: Project[]
): { candidates: MergeCandidate[]; debug: MergeDebugInfo } => {
  const candidates: MergeCandidate[] = [];
  const rejections: MergeRejection[] = [];
  const printers = getActivePrinters();
  const today = new Date();
  
  const project = projects.find(p => p.id === projectId);
  if (!project) {
    console.log('[findMergeCandidates] No project found for id:', projectId);
    return { 
      candidates, 
      debug: { 
        totalCyclesChecked: 0, 
        sameProjectCyclesFound: 0, 
        rejections: [], 
        summary: { no_project: 1 }, 
        maxUnitsPerPlate: 0, 
        hoursPerUnit: 0,
        productFound: false 
      } 
    };
  }
  
  // Get product to find actual max units per plate and cycle time
  const product = getProduct(project.productId);
  let maxUnitsPerPlate = 10; // Default fallback
  let hoursPerUnit = 0.3; // Default hours per unit
  let productFound = false;
  
  if (product && product.platePresets && product.platePresets.length > 0) {
    productFound = true;
    // Find the preset with maximum units
    const maxPreset = product.platePresets.reduce((max, p) => 
      p.unitsPerPlate > max.unitsPerPlate ? p : max, product.platePresets[0]);
    maxUnitsPerPlate = maxPreset.unitsPerPlate;
    hoursPerUnit = maxPreset.cycleHours / maxPreset.unitsPerPlate;
  }
  
  console.log('[findMergeCandidates] Looking for project:', projectId, 'maxUnitsPerPlate:', maxUnitsPerPlate, 'hoursPerUnit:', hoursPerUnit);
  
  // Check ALL cycles and categorize rejections
  for (const cycle of cycles) {
    // Check status
    if (cycle.status !== 'planned') {
      rejections.push({
        cycleId: cycle.id,
        projectId: cycle.projectId,
        startTime: cycle.startTime,
        status: cycle.status,
        plateType: cycle.plateType || 'unknown',
        unitsPlanned: cycle.unitsPlanned,
        printerId: cycle.printerId,
        reason: 'not_planned'
      });
      continue;
    }
    
    // Check project match
    if (cycle.projectId !== projectId) {
      rejections.push({
        cycleId: cycle.id,
        projectId: cycle.projectId,
        startTime: cycle.startTime,
        status: cycle.status,
        plateType: cycle.plateType || 'unknown',
        unitsPlanned: cycle.unitsPlanned,
        printerId: cycle.printerId,
        reason: 'different_project'
      });
      continue;
    }
    
    // Check future
    if (new Date(cycle.startTime) <= today) {
      rejections.push({
        cycleId: cycle.id,
        projectId: cycle.projectId,
        startTime: cycle.startTime,
        status: cycle.status,
        plateType: cycle.plateType || 'unknown',
        unitsPlanned: cycle.unitsPlanned,
        printerId: cycle.printerId,
        reason: 'not_future'
      });
      continue;
    }
    
    // Check plateType
    if (cycle.plateType === 'closeout') {
      rejections.push({
        cycleId: cycle.id,
        projectId: cycle.projectId,
        startTime: cycle.startTime,
        status: cycle.status,
        plateType: cycle.plateType,
        unitsPlanned: cycle.unitsPlanned,
        printerId: cycle.printerId,
        reason: 'closeout'
      });
      continue;
    }
    
    // Check capacity
    const canAdd = Math.min(maxUnitsPerPlate - cycle.unitsPlanned, unitsNeeded);
    if (canAdd <= 0) {
      rejections.push({
        cycleId: cycle.id,
        projectId: cycle.projectId,
        startTime: cycle.startTime,
        status: cycle.status,
        plateType: cycle.plateType || 'unknown',
        unitsPlanned: cycle.unitsPlanned,
        printerId: cycle.printerId,
        reason: 'no_capacity'
      });
      continue;
    }
    
    // This cycle is a valid merge candidate!
    const printer = printers.find(p => p.id === cycle.printerId);
    const startTime = new Date(cycle.startTime);
    const cycleDuration = getCycleDurationHours(cycle);
    const additionalTimeNeeded = canAdd * hoursPerUnit;
    
    // Calculate extension impact
    const originalEnd = new Date(cycle.endTime);
    const newEnd = new Date(originalEnd.getTime() + additionalTimeNeeded * 60 * 60 * 1000);
    
    // Check if extension would cause issues
    const dueDate = new Date(project.dueDate);
    const wouldCrossDeadline = newEnd > dueDate;
    
    // Check for overnight
    const settings = getFactorySettings();
    const overrides = getTemporaryOverrides();
    const daySchedule = getDayScheduleForDate(originalEnd, settings, overrides);
    const workEndTime = daySchedule ? parseTime(daySchedule.endTime) : { hours: 18, minutes: 0 };
    const workEndMinutes = workEndTime.hours * 60 + workEndTime.minutes;
    const newEndMinutes = newEnd.getHours() * 60 + newEnd.getMinutes();
    const wouldRequireOvernight = newEndMinutes > workEndMinutes;
    
    // Build domino effect for subsequent cycles on same printer
    const allPlannedCycles = cycles.filter(c => c.status === 'planned')
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    const subsequentCycles = allPlannedCycles.filter(c => 
      c.printerId === cycle.printerId && 
      new Date(c.startTime) > originalEnd
    );
    const affectedCycles: DominoCycle[] = [];
    let previousNewEnd = newEnd;
    
    for (const subCycle of subsequentCycles.slice(0, 3)) {
      const subProject = projects.find(p => p.id === subCycle.projectId);
      const subOriginalStart = new Date(subCycle.startTime);
      const subOriginalEnd = new Date(subCycle.endTime);
      const subDuration = getCycleDurationHours(subCycle);
      
      const subNewStart = new Date(Math.max(previousNewEnd.getTime(), subOriginalStart.getTime() + additionalTimeNeeded * 60 * 60 * 1000));
      const subNewEnd = new Date(subNewStart.getTime() + subDuration * 60 * 60 * 1000);
      const subDelay = (subNewStart.getTime() - subOriginalStart.getTime()) / (1000 * 60 * 60);
      
      if (subDelay < 0.1) break;
      
      const subDueDate = subProject ? new Date(subProject.dueDate) : null;
      
      affectedCycles.push({
        cycleId: subCycle.id,
        projectId: subCycle.projectId,
        projectName: subProject?.name || 'Unknown',
        printerId: subCycle.printerId,
        printerName: printer?.name || 'Unknown',
        originalStart: subOriginalStart.toISOString(),
        originalEnd: subOriginalEnd.toISOString(),
        newStart: subNewStart.toISOString(),
        newEnd: subNewEnd.toISOString(),
        delayHours: subDelay,
        crossesDeadline: subDueDate ? subNewEnd > subDueDate : false,
      });
      
      previousNewEnd = subNewEnd;
    }
    
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
      availableTimeHours: (maxUnitsPerPlate - cycle.unitsPlanned) * hoursPerUnit,
      extensionImpact: {
        additionalTimeNeeded,
        newEndTime: newEnd.toISOString(),
        wouldCrossDeadline,
        wouldRequireOvernight,
        affectedCycles,
      },
    });
    
    // Limit to 3 candidates
    if (candidates.length >= 3) break;
  }
  
  // Build summary
  const summary: Record<string, number> = {};
  for (const r of rejections) {
    summary[r.reason] = (summary[r.reason] || 0) + 1;
  }
  
  const sameProjectCycles = cycles.filter(c => c.projectId === projectId);
  
  console.log('[findMergeCandidates] Results:', {
    totalCycles: cycles.length,
    sameProjectCycles: sameProjectCycles.length,
    candidates: candidates.length,
    summary
  });
  
  return { 
    candidates, 
    debug: {
      totalCyclesChecked: cycles.length,
      sameProjectCyclesFound: sameProjectCycles.length,
      rejections: rejections.slice(0, 20), // Limit to 20 for readability
      summary,
      maxUnitsPerPlate,
      hoursPerUnit,
      productFound
    }
  };
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
  
  // Find merge candidates with REAL capacity + debug info
  const mergeResult = findMergeCandidates(
    projectId,
    project.color,
    unitsScrap,
    cycles,
    projects
  );
  const mergeCandidates = mergeResult.candidates;
  const mergeDebug = mergeResult.debug;
  
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
    mergeDebug, // Debug info for merge rejection analysis
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
    deferAnalysis: deferImpact,
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
