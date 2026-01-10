// ============= PLANNING ENGINE =============
// Deterministic rules-based scheduler for PrintFlow
// NO AI, NO LLM, NO Cloud - Pure local constraint-based logic

// Debug flag for planning start times
const DEBUG_PLANNING_START = true;
function dbgStart(...args: any[]) {
  if (!DEBUG_PLANNING_START) return;
  console.log('[PlanningStart]', ...args);
}

import {
  Project,
  Printer,
  PlannedCycle,
  Product,
  FactorySettings,
  Spool,
  DaySchedule,
  PlatePreset,
  getProjects,
  getActiveProjects,
  getPrinters,
  getActivePrinters,
  getProducts,
  getProduct,
  getFactorySettings,
  getSpools,
  getPlannedCycles,
  getDayScheduleForDate,
  getAvailableFilamentForPrinter,
  getGramsPerCycle,
  getColorInventory,
  getColorInventoryItem,
  getTotalGrams,
  CycleReadinessState,
} from './storage';
import { normalizeColor } from './colorNormalization';
import { getAvailableGramsByColor } from './materialAdapter';
import { formatDateStringLocal } from './dateUtils';
import { logCycleBlock, getBlockSummary } from './cycleBlockLogger';
import { isFeatureEnabled } from './featureFlags';
import { MinHeap } from './minHeap';
import {
  advanceToNextWorkdayStart as advanceToNextWorkdayStartRaw,
  updateSlotBoundsForDay,
  getEffectiveAvailability,
  isWithinWorkWindow,
  canStartCycleAt,
  isNightTime,
  getNextOperatorTime,  // NEW: Self-contained plate release calculator
  isOperatorPresent,    // NEW: Check if operator can load new plates
  hoursBetween,
  PrinterTimeSlot as SchedulingSlot,
  PlateReleaseInfo,
  EndOfDayTimeSource,
  getNightWindow,       // NEW: Get night window for slot override
  getEndOfNightWindow,  // NEW: Get end of night window for nightIneligibleUntil
} from './schedulingHelpers';

// ============= MANDATORY ADVANCE LOG WRAPPER =============
// This wrapper MUST be used for all advanceToNextWorkdayStart calls
// to track why printers are being advanced and detect loops

interface AdvanceLogContext {
  reason: string;
  printerId?: string;
  printerName?: string;
  currentTime: Date;
  isNightSlot: boolean;
  projectsTried?: number;
  totalProjects?: number;
  nightIneligibleUntil?: Date | null;
  projectId?: string;
  projectName?: string;
}

let advanceCallCount = 0;
const ADVANCE_LOOP_THRESHOLD = 50; // Warn if more than 50 advances in one plan

function advanceToNextWorkdayStart(
  currentTime: Date, 
  settings: FactorySettings,
  logContext: AdvanceLogContext
): Date | null {
  advanceCallCount++;
  
  const result = advanceToNextWorkdayStartRaw(currentTime, settings);
  
  console.log('[ADVANCE_GUARD] 🔄 advanceToNextWorkdayStart called:', {
    callNumber: advanceCallCount,
    reason: logContext.reason,
    isNightSlot: logContext.isNightSlot,
    printerId: logContext.printerId,
    printerName: logContext.printerName,
    currentTime: logContext.currentTime.toISOString(),
    resultTime: result?.toISOString() ?? 'null',
    projectsTried: logContext.projectsTried ?? 'N/A',
    totalProjects: logContext.totalProjects ?? 'N/A',
    nightIneligibleUntil: logContext.nightIneligibleUntil?.toISOString() ?? 'not_set',
    projectId: logContext.projectId ?? 'N/A',
    projectName: logContext.projectName ?? 'N/A',
  });
  
  // Warn about potential infinite loop
  if (advanceCallCount > ADVANCE_LOOP_THRESHOLD) {
    console.warn('[ADVANCE_GUARD] ⚠️ HIGH ADVANCE COUNT:', advanceCallCount, 
      '- Possible infinite loop! Last reason:', logContext.reason);
  }
  
  return result;
}

// Reset counter at start of each planning run
function resetAdvanceCounter() {
  const previousCount = advanceCallCount;
  advanceCallCount = 0;
  if (previousCount > 0) {
    console.log('[ADVANCE_GUARD] 📊 Previous plan had', previousCount, 'advance calls');
  }
}
import {
  logPlanningDecision,
  clearDecisionLog,
  PrinterScoreDetails,
} from './planningDecisionLog';
import { 
  preCalculateNightAllocations, 
  calculateNightAllocationFromDemand,
  getNightAllocationSnapshot,
  clearNightAllocationSnapshot,
  NightAllocationResult,
  NightAllocationInput,
} from './nightPreloadCalculator';

// ============= TYPES =============

// Type for advance reason tracking callback
type AdvanceReasonTracker = (reason: string) => void;

export interface DailySlot {
  startTime: Date;
  endTime: Date;
  printerId: string;
  available: boolean;
}

export interface ScheduledCycle {
  id: string;
  projectId: string;
  printerId: string;
  unitsPlanned: number;
  gramsPlanned: number;
  startTime: Date;
  endTime: Date;
  plateType: 'full' | 'reduced' | 'closeout';
  shift: 'day' | 'end_of_day';
  isEndOfDayCycle: boolean;
  // Readiness tracking (new for PRD compliance)
  readinessState: 'ready' | 'waiting_for_spool' | 'blocked_inventory' | 'waiting_for_plate_reload';
  readinessDetails?: string;
  requiredColor: string;
  requiredGrams: number;
  suggestedSpoolIds?: string[];
  // Preset selection fields
  presetId?: string;
  presetName?: string;
  presetSelectionReason?: string;
  // Plate constraint fields
  plateIndex?: number;        // Which plate (1..4) this cycle uses
  plateReleaseTime?: Date;    // When this plate will be available again
}

export interface DayPlan {
  date: Date;
  dateString: string;
  isWorkday: boolean;
  workStart: string;
  workEnd: string;
  printerPlans: PrinterDayPlan[];
  totalUnits: number;
  totalCycles: number;
  unusedCapacityHours: number;
}

export interface PrinterDayPlan {
  printerId: string;
  printerName: string;
  cycles: ScheduledCycle[];
  totalUnits: number;
  totalHours: number;
  capacityUsedPercent: number;
}

export interface PlanningWarning {
  type: 'material_low' | 'deadline_risk' | 'capacity_unused' | 'printer_overload';
  message: string;
  messageEn: string;
  projectId?: string;
  printerId?: string;
  severity: 'info' | 'warn' | 'error';
}

export interface BlockingIssue {
  type: 'insufficient_material' | 'insufficient_time' | 'no_printers' | 'no_preset' | 'deadline_impossible';
  message: string;
  messageEn: string;
  projectId?: string;
  printerId?: string;
  details?: {
    required?: number;
    available?: number;
    shortfall?: number;
  };
}

export interface PlanningResult {
  success: boolean;
  days: DayPlan[];
  totalUnitsPlanned: number;
  totalCyclesPlanned: number;
  unusedCapacityHours: number;
  warnings: PlanningWarning[];
  blockingIssues: BlockingIssue[];
  cycles: PlannedCycle[];
  generatedAt: string;
}

export interface ProjectPlanningState {
  project: Project;
  product: Product;
  preset: PlatePreset;
  remainingUnits: number;
  assignedPrinterId?: string;
  priority: number;
  daysUntilDue: number;
}

// ============= HELPER FUNCTIONS =============

const generateId = (): string => {
  // Use proper UUID for database compatibility
  return crypto.randomUUID();
};

const parseTime = (timeStr: string): { hours: number; minutes: number } => {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return { hours, minutes };
};

const getWorkingHoursForDay = (schedule: DaySchedule | null): number => {
  if (!schedule || !schedule.enabled) return 0;
  
  const start = parseTime(schedule.startTime);
  const end = parseTime(schedule.endTime);
  
  const startMinutes = start.hours * 60 + start.minutes;
  let endMinutes = end.hours * 60 + end.minutes;
  
  // Handle cross-midnight shifts (e.g., 17:30 -> 02:00 = 8.5 hours)
  if (endMinutes < startMinutes) {
    endMinutes += 24 * 60; // Add 24 hours worth of minutes
  }
  
  return Math.max(0, (endMinutes - startMinutes) / 60);
};

const createDateWithTime = (date: Date, timeStr: string): Date => {
  const result = new Date(date);
  const { hours, minutes } = parseTime(timeStr);
  result.setHours(hours, minutes, 0, 0);
  return result;
};

const addHours = (date: Date, hours: number): Date => {
  const result = new Date(date);
  result.setTime(result.getTime() + hours * 60 * 60 * 1000);
  return result;
};

const addDays = (date: Date, days: number): Date => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

/**
 * Find the next working day's start time.
 * Scans up to `maxDaysAhead` days looking for a day with enabled schedule.
 * Returns null if no working day found within the limit.
 */
const findNextWorkDayStart = (
  fromDate: Date,
  settings: FactorySettings,
  maxDaysAhead: number = 7
): Date | null => {
  for (let offset = 1; offset <= maxDaysAhead; offset++) {
    const checkDate = addDays(fromDate, offset);
    const schedule = getDayScheduleForDate(checkDate, settings, []);
    if (schedule?.enabled) {
      return createDateWithTime(checkDate, schedule.startTime);
    }
  }
  return null;
};

const getDaysUntilDue = (dueDate: string, fromDate: Date): number => {
  const due = new Date(dueDate);
  const from = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
  const diffTime = due.getTime() - from.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

// Use timezone-safe local date formatting
const formatDateString = formatDateStringLocal;

// DEPRECATED: Use getAvailableGramsByColor from materialAdapter instead
// Kept for backward compatibility during migration
const getAvailableFilamentForColor = (color: string, spools: Spool[]): number => {
  // Use centralized adapter as primary source
  return getAvailableGramsByColor(color);
};

// ============= OPTIMAL PRESET SELECTION =============

interface PresetSelectionResult {
  preset: PlatePreset;
  reason: string;
  reasonHe: string;
}

/**
 * Select the optimal preset for a cycle based on constraints
 * Scoring considers: units per plate, cycle time, risk level, recommended status
 * WEEKEND OPTIMIZATION: Before weekend (Thu afternoon), prefer long cycles to maximize plate utilization
 */
export const selectOptimalPreset = (
  product: Product,
  remainingUnits: number,
  availableHours: number,
  availableGrams: number,
  isNightSlot: boolean,
  preferredPresetId?: string,
  isPreWeekend: boolean = false // True if scheduling Thu afternoon cycles going into weekend
): PresetSelectionResult | null => {
  const presets = product.platePresets;
  if (!presets || presets.length === 0) return null;
  
  // If only one preset, use it
  if (presets.length === 1) {
    return {
      preset: presets[0],
      reason: 'Only available preset',
      reasonHe: 'פריסה יחידה זמינה',
    };
  }
  
  // If preferred preset is set and valid, use it
  if (preferredPresetId) {
    const preferred = presets.find(p => p.id === preferredPresetId);
    if (preferred) {
      return {
        preset: preferred,
        reason: 'User preferred preset',
        reasonHe: 'פריסה מועדפת ע״י המשתמש',
      };
    }
  }
  
  // Filter presets by constraints
  const validPresets = presets.filter(p => {
    // Night slot: only allow if preset is marked as safe for night
    if (isNightSlot && !p.allowedForNightCycle) return false;
    
    // Check if cycle fits in available time
    if (p.cycleHours > availableHours) return false;
    
    // Check if we have enough material for one cycle
    const gramsNeeded = p.unitsPerPlate * product.gramsPerUnit;
    if (gramsNeeded > availableGrams) return false;
    
    return true;
  });
  
  if (validPresets.length === 0) {
    // No valid presets - return the recommended or first preset with reason
    const fallback = presets.find(p => p.isRecommended) || presets[0];
    return {
      preset: fallback,
      reason: 'No preset fits constraints, using default',
      reasonHe: 'אין פריסה מתאימה לאילוצים, שימוש בברירת מחדל',
    };
  }
  
  // Score each valid preset
  const scored = validPresets.map(p => {
    let score = 0;
    const gramsNeeded = p.unitsPerPlate * product.gramsPerUnit;
    
    // More units per plate = better efficiency (40 points max)
    const maxUnits = Math.max(...validPresets.map(pr => pr.unitsPerPlate));
    score += (p.unitsPerPlate / maxUnits) * 40;
    
    // Shorter cycle = faster turnaround (20 points max)
    const maxHours = Math.max(...validPresets.map(pr => pr.cycleHours));
    score += (1 - p.cycleHours / maxHours) * 20;
    
    // Risk level bonus (20 points max)
    if (p.riskLevel === 'low') score += 20;
    else if (p.riskLevel === 'medium') score += 10;
    // high risk = 0 points
    
    // Recommended bonus (20 points)
    if (p.isRecommended) score += 20;
    
    // Special adjustments
    // If remaining units are low, prefer smaller presets to avoid waste
    if (remainingUnits <= p.unitsPerPlate) {
      // Penalize presets with too many units (would waste capacity)
      const wastedUnits = p.unitsPerPlate - remainingUnits;
      score -= wastedUnits * 2;
    }
    
    // If remaining hours are low, prefer faster presets
    if (availableHours < 4 && p.cycleHours > availableHours * 0.8) {
      score -= 10;
    }
    
    // Night cycle: prefer low risk
    if (isNightSlot && p.riskLevel === 'low') {
      score += 10;
    }
    
    // ============= WEEKEND OPTIMIZATION (DETERMINISTIC) =============
    // Before weekend (Thu afternoon), prefer LONG cycles to maximize plate utilization
    // Goal: 4 long cycles should cover Thu 17:30 → Sun 08:30 (~63 hours)
    // This is NOT a preference - it's a hard requirement for operational efficiency
    if (isPreWeekend) {
      // Strong bonus for longer cycles - this should be decisive
      const longestHours = Math.max(...validPresets.map(pr => pr.cycleHours));
      const shortestHours = Math.min(...validPresets.map(pr => pr.cycleHours));
      const range = longestHours - shortestHours;
      
      if (range > 0) {
        // Normalize cycle length to 0-1 range, then give up to 100 bonus points
        // This overwhelms all other scoring factors for weekend scheduling
        const normalizedLength = (p.cycleHours - shortestHours) / range;
        score += normalizedLength * 100; // Decisive bonus for longest cycles
      }
      
      console.log('[WeekendOptimization] 📅 Pre-weekend preset scoring:', {
        preset: p.name,
        cycleHours: p.cycleHours,
        longestHours,
        bonusPoints: range > 0 ? ((p.cycleHours - shortestHours) / range) * 100 : 0,
        totalScore: score,
      });
    }
    
    return { preset: p, score };
  });
  
  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);
  
  const best = scored[0];
  
  // Generate reason based on why this preset was chosen
  let reason = 'Best overall score';
  let reasonHe = 'הציון הטוב ביותר';
  
  if (best.preset.isRecommended) {
    reason = 'Recommended preset with optimal balance';
    reasonHe = 'פריסה מומלצת עם איזון אופטימלי';
  } else if (remainingUnits <= best.preset.unitsPerPlate) {
    reason = 'Best fit for remaining units';
    reasonHe = 'התאמה מיטבית ליחידות הנותרות';
  } else if (isNightSlot && best.preset.riskLevel === 'low') {
    reason = 'Safe preset for night operation';
    reasonHe = 'פריסה בטוחה לפעילות לילה';
  } else if (best.preset.unitsPerPlate === Math.max(...validPresets.map(p => p.unitsPerPlate))) {
    reason = 'Maximum units per cycle';
    reasonHe = 'מקסימום יחידות למחזור';
  }
  
  return {
    preset: best.preset,
    reason,
    reasonHe,
  };
};



const prioritizeProjects = (projects: Project[], products: Product[], fromDate: Date, existingCycles: PlannedCycle[] = []): ProjectPlanningState[] => {
  const projectStates: ProjectPlanningState[] = [];
  
  // Get first available product as fallback for projects without product
  const defaultProduct = products[0];
  const defaultPreset: PlatePreset | undefined = defaultProduct?.platePresets?.[0];
  
  for (const project of projects) {
    // Skip completed projects
    if (project.status === 'completed') continue;
    
    // Try to find product, use default if not found (migration scenario)
    let product = products.find(p => p.id === project.productId);
    let preset: PlatePreset | undefined;
    
    if (product) {
      // Get the preferred or recommended preset
      preset = project.preferredPresetId 
        ? product.platePresets.find(p => p.id === project.preferredPresetId)
        : product.platePresets.find(p => p.isRecommended) || product.platePresets[0];
    } else if (defaultProduct && defaultPreset) {
      // Fallback: Use default product and preset for projects without product mapping
      // This allows migrated projects to still be planned
      console.log(`[Planning] Project "${project.name}" has no product, using default`);
      product = defaultProduct;
      preset = defaultPreset;
    }
    
    if (!product || !preset) continue;
    
    // Calculate units already being produced in in_progress cycles
    const inProgressUnits = existingCycles
      .filter(c => c.projectId === project.id && c.status === 'in_progress')
      .reduce((sum, c) => sum + c.unitsPlanned, 0);
    
    const remainingUnits = project.quantityTarget - project.quantityGood - inProgressUnits;
    if (remainingUnits <= 0) continue;
    
    const daysUntilDue = getDaysUntilDue(project.dueDate, fromDate);
    
    // Calculate priority score (lower = higher priority)
    // Critical urgency = 0-10, Urgent = 10-20, Normal = 20+
    let priority = daysUntilDue;
    if (project.urgency === 'critical') priority = Math.min(priority, 5);
    else if (project.urgency === 'urgent') priority = Math.min(priority, 15);
    
    projectStates.push({
      project,
      product,
      preset,
      remainingUnits,
      priority,
      daysUntilDue,
    });
  }
  
  // Sort by priority (lower first), then by due date
  projectStates.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.daysUntilDue - b.daysUntilDue;
  });
  
  return projectStates;
};

// ============= PROJECT-CENTRIC SCHEDULING FUNCTIONS =============

// Scoring weights for printer selection
const SCORING_WEIGHTS = {
  AVAILABILITY: 40,    // 0-40 points based on wait time
  COLOR_MATCH: 30,     // 0-30 points for color matching
  SWITCH_COST: 5,      // 0-5 points for avoiding color switch
  CONTINUITY: 15,      // 0-15 points for project continuity
};

/**
 * Score a printer for a specific project.
 * Returns detailed scoring breakdown for debugging.
 * 
 * @param slot - Printer time slot
 * @param projectColor - Color required by project
 * @param planningStartTime - Reference time for wait calculation
 * @param effectiveAvailabilityTime - When printer is actually available
 * @param lastProjectId - ID of last project scheduled on this printer
 * @param currentProjectId - ID of project being scored for
 * @param settings - Factory settings
 */
function scorePrinterForProject(
  slot: PrinterTimeSlot,
  projectColor: string,
  planningStartTime: Date,
  effectiveAvailabilityTime: Date,
  lastProjectId: string | undefined,
  currentProjectId: string,
  settings: FactorySettings
): PrinterScoreDetails {
  const reasons: string[] = [];
  const scores = {
    availability: 0,
    colorMatch: 0,
    switchCost: 0,
    projectContinuity: 0,
    total: 0,
  };
  
  // Calculate wait hours from planning start
  const waitHours = hoursBetween(planningStartTime, effectiveAvailabilityTime);
  const isNextDay = effectiveAvailabilityTime.getTime() > slot.endOfDayTime.getTime();
  
  // 1. Availability Score (0-40)
  // Less wait = higher score
  // 0 hours wait = 40 points, 24+ hours wait = 0 points
  const maxWaitHours = 24;
  scores.availability = Math.max(0, SCORING_WEIGHTS.AVAILABILITY * (1 - Math.min(waitHours, maxWaitHours) / maxWaitHours));
  if (waitHours <= 0.5) {
    reasons.push('זמינה מיידית');
  } else if (isNextDay) {
    reasons.push(`זמינה ביום הבא (${waitHours.toFixed(1)} שעות)`);
  } else {
    reasons.push(`המתנה ${waitHours.toFixed(1)} שעות`);
  }
  
  // 2. Color Match Score (0-30)
  const normalizedProjectColor = normalizeColor(projectColor);
  const normalizedPrinterColor = slot.lastScheduledColor ? normalizeColor(slot.lastScheduledColor) : null;
  
  if (normalizedPrinterColor === normalizedProjectColor) {
    scores.colorMatch = SCORING_WEIGHTS.COLOR_MATCH;
    reasons.push(`צבע תואם (${projectColor})`);
  } else if (!normalizedPrinterColor) {
    // Neutral - no color loaded
    scores.colorMatch = SCORING_WEIGHTS.COLOR_MATCH / 2;
    reasons.push('אין צבע טעון');
  } else {
    // Different color
    scores.colorMatch = 0;
    reasons.push(`צריך החלפת צבע (${slot.lastScheduledColor} → ${projectColor})`);
  }
  
  // 3. Switch Cost Score (0-5)
  // Binary: matching color = 5, different = 0
  if (normalizedPrinterColor === normalizedProjectColor) {
    scores.switchCost = SCORING_WEIGHTS.SWITCH_COST;
  } else {
    scores.switchCost = 0;
  }
  
  // 4. Project Continuity Score (0-15)
  // Bonus for continuing same project on same printer
  if (lastProjectId === currentProjectId) {
    scores.projectContinuity = SCORING_WEIGHTS.CONTINUITY;
    reasons.push('המשכיות פרויקט');
  } else {
    scores.projectContinuity = 0;
  }
  
  // Calculate total
  scores.total = scores.availability + scores.colorMatch + scores.switchCost + scores.projectContinuity;
  
  return {
    printerId: slot.printerId,
    printerName: slot.printerName,
    currentTime: new Date(slot.currentTime),
    effectiveAvailabilityTime: new Date(effectiveAvailabilityTime),
    waitHours,
    isNextDay,
    scores,
    reasons,
  };
}

/**
 * Dry-run simulation to estimate project finish time.
 * Uses MinHeap for efficient printer selection.
 * Shares logic with actual scheduling via schedulingHelpers.
 * 
 * @returns Estimated finish time, cycles needed, and deadline status
 */
function estimateProjectFinishTime(
  project: ProjectPlanningState,
  printerSlots: PrinterTimeSlot[],
  printerIds: string[],
  planningStartTime: Date,
  settings: FactorySettings,
  printers: Printer[],
  trackAdvanceReason?: AdvanceReasonTracker
): {
  finishTime: Date | null;
  cycleCount: number;
  meetsDeadline: boolean;
  marginHours: number;
} {
  const maxSimulationDays = 30;
  const maxSimulationTime = new Date(planningStartTime);
  maxSimulationTime.setDate(maxSimulationTime.getDate() + maxSimulationDays);
  
  // Create simulation slots (clones) - deep clone dates and platesInUse
  const simSlots = printerSlots
    .filter(s => printerIds.includes(s.printerId))
    .map(s => ({
      ...s,
      currentTime: new Date(s.currentTime),
      endOfDayTime: new Date(s.endOfDayTime),
      endOfWorkHours: new Date(s.endOfWorkHours),
      workDayStart: new Date(s.workDayStart),
      // FIX #2: Deep clone platesInUse array with dates
      platesInUse: (s.platesInUse || []).map(p => ({
        releaseTime: new Date(p.releaseTime),
        cycleId: p.cycleId,
      })),
      physicalPlateCapacity: s.physicalPlateCapacity,
      // Preserve debug fields
      endOfDayTimeSource: s.endOfDayTimeSource,
      endOfDayTimeReason: s.endOfDayTimeReason,
    }));
  
  if (simSlots.length === 0) {
    return { finishTime: null, cycleCount: 0, meetsDeadline: false, marginHours: 0 };
  }
  
  // Initialize MinHeap with printer availability
  const heap = new MinHeap<typeof simSlots[0]>();
  for (const slot of simSlots) {
    heap.push(slot.currentTime.getTime(), slot);
  }
  
  let remainingUnits = project.remainingUnits;
  let cycleCount = 0;
  let lastFinishTime: Date | null = null;
  const cycleHours = project.preset.cycleHours;
  const unitsPerCycle = project.preset.unitsPerPlate;
  const transitionMs = (settings.transitionMinutes ?? 0) * 60 * 1000;
  
  // Find printer object for canStartCycleAt check
  const printerMap = new Map<string, Printer>();
  for (const p of printers) {
    printerMap.set(p.id, p);
  }
  
  while (remainingUnits > 0 && !heap.isEmpty()) {
    const entry = heap.pop();
    if (!entry) break;
    
    const slot = entry.data;
    
    // Safety: stop if simulation goes too far
    if (slot.currentTime > maxSimulationTime) {
      break;
    }
    
    // Check if we're past end of day
    if (slot.currentTime >= slot.endOfDayTime) {
      // ============= DEBUG LOG: Advance reason =============
      console.log('[EstimateSim] ⏭️ Advancing to next day:', {
        reason: 'past_endOfDayTime',
        projectId: project.project.id,
        projectName: project.project.name,
        printerId: slot.printerId,
        printerName: slot.printerName,
        currentTime: slot.currentTime.toISOString(),
        workDayStart: slot.workDayStart.toISOString(),
        endOfWorkHours: slot.endOfWorkHours.toISOString(),
        endOfDayTime: slot.endOfDayTime.toISOString(),
        endOfDayTimeSource: (slot as any).endOfDayTimeSource ?? 'unknown',
        endOfDayTimeReason: (slot as any).endOfDayTimeReason ?? '',
        afterHoursBehavior: settings.afterHoursBehavior,
        printerHasAMS: slot.hasAMS,
        printerCanStartAfterHours: slot.canStartNewCyclesAfterHours,
        lastScheduledColor: slot.lastScheduledColor ?? 'none',
        projectColor: project.project.color ?? 'none',
        presetAllowedForNight: project.preset?.allowedForNightCycle,
      });
      
      // Advance to next workday
      const nextStart = advanceToNextWorkdayStart(slot.currentTime, settings, {
        reason: 'past_endOfDayTime',
        printerId: slot.printerId,
        printerName: slot.printerName,
        currentTime: slot.currentTime,
        isNightSlot: slot.currentTime >= slot.endOfWorkHours,
        projectId: project.project.id,
        projectName: project.project.name,
      });
      if (!nextStart || nextStart > maxSimulationTime) {
        continue; // No more workdays in simulation window
      }
      
      slot.currentTime = nextStart;
      updateSlotBoundsForDay(slot, nextStart, settings);
      heap.push(slot.currentTime.getTime(), slot);
      continue;
    }
    
    // ============= CRITICAL: Check if operator is present to load new plate =============
    // Even with FULL_AUTOMATION, an operator must physically load the plate
    // This prevents scheduling new cycles on Friday/Saturday or outside work hours
    if (!isOperatorPresent(slot.currentTime, settings)) {
      console.log('[EstimateSim] ⏭️ Advancing to next day:', {
        reason: 'no_operator_present',
        projectId: project.project.id,
        projectName: project.project.name,
        printerId: slot.printerId,
        printerName: slot.printerName,
        currentTime: slot.currentTime.toISOString(),
        dayOfWeek: slot.currentTime.toLocaleDateString('en-US', { weekday: 'long' }),
        workDayStart: slot.workDayStart.toISOString(),
        endOfWorkHours: slot.endOfWorkHours.toISOString(),
      });
      
      // Advance to next workday when operator arrives
      const nextStart = advanceToNextWorkdayStart(slot.currentTime, settings, {
        reason: 'no_operator_present',
        printerId: slot.printerId,
        printerName: slot.printerName,
        currentTime: slot.currentTime,
        isNightSlot: slot.currentTime >= slot.endOfWorkHours,
        projectId: project.project.id,
        projectName: project.project.name,
      });
      if (!nextStart || nextStart > maxSimulationTime) {
        continue;
      }
      slot.currentTime = nextStart;
      updateSlotBoundsForDay(slot, nextStart, settings);
      // Release plates that operator can clear
      if (slot.platesInUse) {
        slot.platesInUse = slot.platesInUse.filter(p => 
          getNextOperatorTime(p.releaseTime, settings) > slot.currentTime
        );
      }
      heap.push(slot.currentTime.getTime(), slot);
      continue;
    }
    
    // Check if cycle can start (3-level control for night automation)
    const printer = printerMap.get(slot.printerId);
    if (!canStartCycleAt(
      slot.currentTime,
      printer,  // Pass full printer object
      project.preset,
      settings,
      slot.workDayStart,
      slot.endOfWorkHours
    )) {
      // ============= DEBUG LOG: canStartCycleAt failed =============
      console.log('[EstimateSim] ⏭️ Advancing to next day:', {
        reason: 'canStartCycleAt_false',
        projectId: project.project.id,
        projectName: project.project.name,
        printerId: slot.printerId,
        printerName: slot.printerName,
        currentTime: slot.currentTime.toISOString(),
        workDayStart: slot.workDayStart.toISOString(),
        endOfWorkHours: slot.endOfWorkHours.toISOString(),
        endOfDayTime: slot.endOfDayTime.toISOString(),
        endOfDayTimeSource: (slot as any).endOfDayTimeSource ?? 'unknown',
        endOfDayTimeReason: (slot as any).endOfDayTimeReason ?? '',
        isWithinWorkHours: slot.currentTime >= slot.workDayStart && slot.currentTime < slot.endOfWorkHours,
        afterHoursBehavior: settings.afterHoursBehavior,
        printerHasAMS: slot.hasAMS,
        printerCanStartAfterHours: printer?.canStartNewCyclesAfterHours,
        lastScheduledColor: slot.lastScheduledColor ?? 'none',
        projectColor: project.project.color ?? 'none',
        presetAllowedForNight: project.preset?.allowedForNightCycle,
      });
      
      // Cannot start here - advance to next workday
      const nextStart = advanceToNextWorkdayStart(slot.currentTime, settings, {
        reason: 'canStartCycleAt_false',
        printerId: slot.printerId,
        printerName: slot.printerName,
        currentTime: slot.currentTime,
        isNightSlot: slot.currentTime >= slot.endOfWorkHours,
        projectId: project.project.id,
        projectName: project.project.name,
      });
      if (!nextStart || nextStart > maxSimulationTime) {
        continue;
      }
      slot.currentTime = nextStart;
      updateSlotBoundsForDay(slot, nextStart, settings);
      heap.push(slot.currentTime.getTime(), slot);
      continue;
    }
    
    // ============= PLATE CONSTRAINT CHECK (Dry-Run V2) =============
    const isWithinWorkHoursSim = slot.currentTime >= slot.workDayStart && slot.currentTime < slot.endOfWorkHours;
    
    // Simulate plate release during work hours - use properly typed slot
    if (isWithinWorkHoursSim && slot.platesInUse) {
      slot.platesInUse = slot.platesInUse.filter(p => p.releaseTime > slot.currentTime);
    }
    
    const simPlatesInUse = slot.platesInUse?.length ?? 0;
    const simPlateCapacity = slot.physicalPlateCapacity ?? 4;
    const simPlatesAvailable = simPlateCapacity - simPlatesInUse;
    
    if (simPlatesAvailable <= 0) {
      if (isWithinWorkHoursSim && slot.platesInUse?.length > 0) {
        const nearestRelease = Math.min(...slot.platesInUse.map(p => p.releaseTime.getTime()));
        if (nearestRelease < slot.endOfWorkHours.getTime()) {
          slot.currentTime = new Date(nearestRelease);
          slot.platesInUse = slot.platesInUse.filter(p => p.releaseTime > slot.currentTime);
          heap.push(slot.currentTime.getTime(), slot);
          continue;
        }
      }
      // ============= DEBUG LOG: No plates available =============
      console.log('[EstimateSim] ⏭️ Advancing to next day:', {
        reason: 'no_plates_available',
        projectId: project.project.id,
        projectName: project.project.name,
        printerId: slot.printerId,
        printerName: slot.printerName,
        currentTime: slot.currentTime.toISOString(),
        workDayStart: slot.workDayStart.toISOString(),
        endOfWorkHours: slot.endOfWorkHours.toISOString(),
        endOfDayTime: slot.endOfDayTime.toISOString(),
        endOfDayTimeSource: (slot as any).endOfDayTimeSource ?? 'unknown',
        isWithinWorkHours: isWithinWorkHoursSim,
        platesInUse: simPlatesInUse,
        plateCapacity: simPlateCapacity,
        afterHoursBehavior: settings.afterHoursBehavior,
        printerHasAMS: slot.hasAMS,
        printerCanStartAfterHours: slot.canStartNewCyclesAfterHours,
        lastScheduledColor: slot.lastScheduledColor ?? 'none',
        projectColor: project.project.color ?? 'none',
      });
      
      // No plates - advance to next workday
      const nextStart = advanceToNextWorkdayStart(slot.currentTime, settings, {
        reason: 'no_plates_available',
        printerId: slot.printerId,
        printerName: slot.printerName,
        currentTime: slot.currentTime,
        isNightSlot: slot.currentTime >= slot.endOfWorkHours,
        projectId: project.project.id,
        projectName: project.project.name,
      });
      if (!nextStart || nextStart > maxSimulationTime) continue;
      slot.currentTime = nextStart;
      updateSlotBoundsForDay(slot, nextStart, settings);
      // FIX #1: Do NOT reset plates - filter by releaseTime at new day start
      slot.platesInUse = slot.platesInUse.filter(p => p.releaseTime > slot.currentTime);
      heap.push(slot.currentTime.getTime(), slot);
      continue;
    }
    
    // Schedule one cycle
    const cycleEndTime = new Date(slot.currentTime.getTime() + cycleHours * 60 * 60 * 1000);
    
    // ============= SECONDARY NIGHT VALIDATION (Dry-Run V2) =============
    const isNightSlotSim = slot.currentTime >= slot.endOfWorkHours;
    if (!isNightSlotSim && cycleEndTime > slot.endOfWorkHours) {
      // Cycle extends into night - check if allowed
      const canRunAutonomous = 
        settings.afterHoursBehavior === 'FULL_AUTOMATION' &&
        (printer?.canStartNewCyclesAfterHours ?? false) &&
        project.preset.allowedForNightCycle !== false;
      
      if (!canRunAutonomous) {
        // ============= DEBUG LOG: Cycle extends to night not allowed =============
        console.log('[EstimateSim] ⏭️ Advancing to next day:', {
          reason: 'cycle_extends_night_not_allowed',
          projectId: project.project.id,
          projectName: project.project.name,
          printerId: slot.printerId,
          printerName: slot.printerName,
          currentTime: slot.currentTime.toISOString(),
          cycleEndTime: cycleEndTime.toISOString(),
          cycleHours: cycleHours,
          workDayStart: slot.workDayStart.toISOString(),
          endOfWorkHours: slot.endOfWorkHours.toISOString(),
          endOfDayTime: slot.endOfDayTime.toISOString(),
          endOfDayTimeSource: (slot as any).endOfDayTimeSource ?? 'unknown',
          afterHoursBehavior: settings.afterHoursBehavior,
          printerHasAMS: slot.hasAMS,
          printerCanStartAfterHours: printer?.canStartNewCyclesAfterHours,
          lastScheduledColor: slot.lastScheduledColor ?? 'none',
          projectColor: project.project.color ?? 'none',
          presetAllowedForNight: project.preset?.allowedForNightCycle,
        });
        
        const nextStart = advanceToNextWorkdayStart(slot.currentTime, settings, {
          reason: 'cycle_extends_night_not_allowed',
          printerId: slot.printerId,
          printerName: slot.printerName,
          currentTime: slot.currentTime,
          isNightSlot: slot.currentTime >= slot.endOfWorkHours,
          projectId: project.project.id,
          projectName: project.project.name,
        });
        if (!nextStart || nextStart > maxSimulationTime) continue;
        slot.currentTime = nextStart;
        updateSlotBoundsForDay(slot, nextStart, settings);
        heap.push(slot.currentTime.getTime(), slot);
        continue;
      }
    }
    
    lastFinishTime = cycleEndTime;
    
    const unitsThisCycle = Math.min(unitsPerCycle, remainingUnits);
    remainingUnits -= unitsThisCycle;
    cycleCount++;
    
    // Track plate usage in simulation - use properly typed slot
    const PLATE_CLEANUP_SIM = 10;
    if (!slot.platesInUse) slot.platesInUse = [];
    slot.platesInUse.push({
      releaseTime: new Date(cycleEndTime.getTime() + PLATE_CLEANUP_SIM * 60 * 1000),
      cycleId: `sim-${cycleCount}`,
    });
    
    // Advance printer time (including transition)
    slot.currentTime = new Date(cycleEndTime.getTime() + transitionMs);
    
    // Push back to heap for potential next cycle
    heap.push(slot.currentTime.getTime(), slot);
  }
  
  // Calculate deadline margin
  const deadlineDate = new Date(project.project.dueDate);
  const meetsDeadline = lastFinishTime !== null && lastFinishTime <= deadlineDate;
  const marginHours = lastFinishTime 
    ? (deadlineDate.getTime() - lastFinishTime.getTime()) / (1000 * 60 * 60)
    : -Infinity;
  
  return {
    finishTime: lastFinishTime,
    cycleCount,
    meetsDeadline,
    marginHours,
  };
}

/**
 * Select minimum number of printers needed to meet deadline.
 * Uses scoring to pick best printers, then validates with dry-run.
 * 
 * @returns Array of selected printer IDs with score details
 */
function selectMinimumPrintersForDeadline(
  project: ProjectPlanningState,
  printerSlots: PrinterTimeSlot[],
  planningStartTime: Date,
  settings: FactorySettings,
  printers: Printer[],
  lastProjectByPrinter: Map<string, string>,
  trackAdvanceReason?: AdvanceReasonTracker
): {
  selectedPrinterIds: string[];
  printerScores: PrinterScoreDetails[];
  estimationResult: {
    estimatedFinishTime: Date | null;
    meetsDeadline: boolean;
    marginHours: number;
    cycleCount: number;
  };
} {
  // Score all printers
  const scoredPrinters: PrinterScoreDetails[] = [];
  
  for (const slot of printerSlots) {
    const effectiveTime = getEffectiveAvailability(slot, settings);
    const lastProjectId = lastProjectByPrinter.get(slot.printerId);
    
    const scoreDetails = scorePrinterForProject(
      slot,
      project.project.color,
      planningStartTime,
      effectiveTime,
      lastProjectId,
      project.project.id,
      settings
    );
    
    scoredPrinters.push(scoreDetails);
    
    // Debug log
    console.log(`[Scoring] ${slot.printerName}:`, {
      currentTime: slot.currentTime.toISOString(),
      effectiveTime: effectiveTime.toISOString(),
      waitHours: scoreDetails.waitHours.toFixed(2),
      isNextDay: scoreDetails.isNextDay,
      totalScore: scoreDetails.scores.total,
    });
  }
  
  // Sort by score (highest first)
  scoredPrinters.sort((a, b) => b.scores.total - a.scores.total);
  
  // Try with increasing number of printers until deadline is met
  for (let numPrinters = 1; numPrinters <= scoredPrinters.length; numPrinters++) {
    const selectedIds = scoredPrinters.slice(0, numPrinters).map(p => p.printerId);
    
    const estimation = estimateProjectFinishTime(
      project,
      printerSlots,
      selectedIds,
      planningStartTime,
      settings,
      printers,
      trackAdvanceReason
    );
    
    if (estimation.meetsDeadline || numPrinters === scoredPrinters.length) {
      return {
        selectedPrinterIds: selectedIds,
        printerScores: scoredPrinters.slice(0, numPrinters),
        estimationResult: {
          estimatedFinishTime: estimation.finishTime,
          meetsDeadline: estimation.meetsDeadline,
          marginHours: estimation.marginHours,
          cycleCount: estimation.cycleCount,
        },
      };
    }
  }
  
  // Fallback: use all printers
  return {
    selectedPrinterIds: scoredPrinters.map(p => p.printerId),
    printerScores: scoredPrinters,
    estimationResult: {
      estimatedFinishTime: null,
      meetsDeadline: false,
      marginHours: -Infinity,
      cycleCount: 0,
    },
  };
}

/**
 * Schedule all cycles for a project on selected printers.
 * Uses MinHeap for earliest-available scheduling.
 * 
 * @returns Array of scheduled cycles and updated printer slots
 */
function scheduleProjectOnPrinters(
  project: ProjectPlanningState,
  printerSlots: PrinterTimeSlot[],
  selectedPrinterIds: string[],
  settings: FactorySettings,
  printers: Printer[],
  dateString: string,
  workingMaterial: Map<string, number>,
  workingSpoolAssignments: Map<string, Set<string>>,
  trackAdvanceReason?: AdvanceReasonTracker
): ScheduledCycle[] {
  const scheduledCycles: ScheduledCycle[] = [];
  const transitionMs = (settings.transitionMinutes ?? 0) * 60 * 1000;
  const PLATE_CLEANUP_MINUTES = 10;
  
  // Get selected slots
  const selectedSlots = printerSlots.filter(s => selectedPrinterIds.includes(s.printerId));
  if (selectedSlots.length === 0) return [];
  
  // Initialize MinHeap
  const heap = new MinHeap<PrinterTimeSlot>();
  for (const slot of selectedSlots) {
    heap.push(slot.currentTime.getTime(), slot);
  }
  
  let remainingUnits = project.remainingUnits;
  const colorKey = normalizeColor(project.project.color);
  
  // Find printer objects for checks
  const printerMap = new Map<string, Printer>();
  for (const p of printers) {
    printerMap.set(p.id, p);
  }
  
  // Track consumed material during scheduling (for accurate hasMaterial check)
  let consumedMaterial = 0;
  
  while (remainingUnits > 0 && !heap.isEmpty()) {
    const entry = heap.pop();
    if (!entry) break;
    
    const slot = entry.data;
    const printer = printerMap.get(slot.printerId);
    
    // Check if past end of day
    if (slot.currentTime >= slot.endOfDayTime) {
      // ============= DEBUG LOG: Past endOfDayTime =============
      console.log('[V2Schedule] ⏭️ Advancing to next day:', {
        reason: 'past_endOfDayTime',
        projectId: project.project.id,
        projectName: project.project.name,
        printerId: slot.printerId,
        printerName: slot.printerName,
        currentTime: slot.currentTime.toISOString(),
        workDayStart: slot.workDayStart.toISOString(),
        endOfWorkHours: slot.endOfWorkHours.toISOString(),
        endOfDayTime: slot.endOfDayTime.toISOString(),
        endOfDayTimeSource: (slot as any).endOfDayTimeSource ?? 'unknown',
        endOfDayTimeReason: (slot as any).endOfDayTimeReason ?? '',
        afterHoursBehavior: settings.afterHoursBehavior,
        printerHasAMS: slot.hasAMS,
        printerCanStartAfterHours: slot.canStartNewCyclesAfterHours,
        lastScheduledColor: slot.lastScheduledColor ?? 'none',
        projectColor: project.project.color ?? 'none',
        presetAllowedForNight: project.preset?.allowedForNightCycle,
      });
      
      // Track reason for summary
      trackAdvanceReason?.('past_endOfDayTime');
      
      // Advance to next workday
      const nextStart = advanceToNextWorkdayStart(slot.currentTime, settings, {
        reason: 'past_endOfDayTime',
        printerId: slot.printerId,
        printerName: slot.printerName,
        currentTime: slot.currentTime,
        isNightSlot: slot.currentTime >= slot.endOfWorkHours,
        projectId: project.project.id,
        projectName: project.project.name,
      });
      if (!nextStart) continue;
      
      slot.currentTime = nextStart;
      updateSlotBoundsForDay(slot, nextStart, settings);
      // Release plates at new workday start (operator arrives and clears finished plates)
      if (slot.platesInUse) {
        slot.platesInUse = slot.platesInUse.filter(p => 
          getNextOperatorTime(p.releaseTime, settings) > slot.currentTime
        );
      }
      heap.push(slot.currentTime.getTime(), slot);
      continue;
    }
    
    // ============= CRITICAL: Check if operator is present to load new plate =============
    // Even with FULL_AUTOMATION, an operator must physically load the plate
    // This prevents scheduling new cycles on Friday/Saturday or outside work hours
    if (!isOperatorPresent(slot.currentTime, settings)) {
      console.log('[V2Schedule] ⏭️ Advancing to next day:', {
        reason: 'no_operator_present',
        projectId: project.project.id,
        projectName: project.project.name,
        printerId: slot.printerId,
        printerName: slot.printerName,
        currentTime: slot.currentTime.toISOString(),
        dayOfWeek: slot.currentTime.toLocaleDateString('en-US', { weekday: 'long' }),
        workDayStart: slot.workDayStart.toISOString(),
        endOfWorkHours: slot.endOfWorkHours.toISOString(),
      });
      
      // Track reason for summary
      trackAdvanceReason?.('no_operator_present');
      
      // Advance to next workday when operator arrives
      const nextStart = advanceToNextWorkdayStart(slot.currentTime, settings, {
        reason: 'no_operator_present',
        printerId: slot.printerId,
        printerName: slot.printerName,
        currentTime: slot.currentTime,
        isNightSlot: slot.currentTime >= slot.endOfWorkHours,
        projectId: project.project.id,
        projectName: project.project.name,
      });
      if (!nextStart) continue;
      slot.currentTime = nextStart;
      updateSlotBoundsForDay(slot, nextStart, settings);
      // Release plates that operator can clear
      if (slot.platesInUse) {
        slot.platesInUse = slot.platesInUse.filter(p => 
          getNextOperatorTime(p.releaseTime, settings) > slot.currentTime
        );
      }
      heap.push(slot.currentTime.getTime(), slot);
      continue;
    }
    
    // ============= PLATE CONSTRAINT CHECK (V2) =============
    // Check plate availability - uses actual release time considering operator presence
    const isWithinWorkHoursNow = slot.currentTime >= slot.workDayStart && slot.currentTime < slot.endOfWorkHours;
    
    // Release plates based on ACTUAL availability (when operator can clear them)
    // - During work hours: release if releaseTime passed
    // - Overnight/weekend plates: only release at workDayStart when operator arrives
    if (slot.platesInUse) {
      slot.platesInUse = slot.platesInUse.filter(p => 
        getNextOperatorTime(p.releaseTime, settings) > slot.currentTime
      );
    }
    
    const platesInUseCount = slot.platesInUse?.length ?? 0;
    const platesAvailable = slot.physicalPlateCapacity - platesInUseCount;
    
    if (platesAvailable <= 0) {
      if (isWithinWorkHoursNow && slot.platesInUse && slot.platesInUse.length > 0) {
        // Wait for nearest plate release during work hours
        const actualReleaseTimes = slot.platesInUse.map(p => 
          getNextOperatorTime(p.releaseTime, settings).getTime()
        );
        const nearestRelease = Math.min(...actualReleaseTimes);
        if (nearestRelease < slot.endOfWorkHours.getTime()) {
          slot.currentTime = new Date(nearestRelease);
          // Re-filter plates
          slot.platesInUse = slot.platesInUse.filter(p => 
            getNextOperatorTime(p.releaseTime, settings) > slot.currentTime
          );
          heap.push(slot.currentTime.getTime(), slot);
          continue;
        }
      }
      // ============= DEBUG LOG: No plates available =============
      console.log('[V2Schedule] ⏭️ Advancing to next day:', {
        reason: 'no_plates_available',
        projectId: project.project.id,
        projectName: project.project.name,
        printerId: slot.printerId,
        printerName: slot.printerName,
        currentTime: slot.currentTime.toISOString(),
        workDayStart: slot.workDayStart.toISOString(),
        endOfWorkHours: slot.endOfWorkHours.toISOString(),
        endOfDayTime: slot.endOfDayTime.toISOString(),
        endOfDayTimeSource: (slot as any).endOfDayTimeSource ?? 'unknown',
        isWithinWorkHours: isWithinWorkHoursNow,
        platesInUse: platesInUseCount,
        plateCapacity: slot.physicalPlateCapacity,
        afterHoursBehavior: settings.afterHoursBehavior,
        printerHasAMS: slot.hasAMS,
        printerCanStartAfterHours: slot.canStartNewCyclesAfterHours,
        lastScheduledColor: slot.lastScheduledColor ?? 'none',
        projectColor: project.project.color ?? 'none',
      });
      
      // Track reason for summary
      trackAdvanceReason?.('no_plates_available');
      
      // No plates available - advance to next workday
      const nextStart = advanceToNextWorkdayStart(slot.currentTime, settings, {
        reason: 'no_plates_available',
        printerId: slot.printerId,
        printerName: slot.printerName,
        currentTime: slot.currentTime,
        isNightSlot: slot.currentTime >= slot.endOfWorkHours,
        projectId: project.project.id,
        projectName: project.project.name,
      });
      if (!nextStart) continue;
      slot.currentTime = nextStart;
      updateSlotBoundsForDay(slot, nextStart, settings);
      // Release plates using getNextOperatorTime (self-contained, doesn't use slot bounds)
      slot.platesInUse = slot.platesInUse.filter(p => 
        getNextOperatorTime(p.releaseTime, settings) > slot.currentTime
      );
      heap.push(slot.currentTime.getTime(), slot);
      continue;
    }
    
    // Check if can start cycle here (3-level control)
    if (!canStartCycleAt(
      slot.currentTime,
      printer,  // Pass full printer object
      project.preset,
      settings,
      slot.workDayStart,
      slot.endOfWorkHours
    )) {
      // ============= DEBUG LOG: canStartCycleAt failed =============
      console.log('[V2Schedule] ⏭️ Advancing to next day:', {
        reason: 'canStartCycleAt_false',
        projectId: project.project.id,
        projectName: project.project.name,
        printerId: slot.printerId,
        printerName: slot.printerName,
        currentTime: slot.currentTime.toISOString(),
        workDayStart: slot.workDayStart.toISOString(),
        endOfWorkHours: slot.endOfWorkHours.toISOString(),
        endOfDayTime: slot.endOfDayTime.toISOString(),
        endOfDayTimeSource: (slot as any).endOfDayTimeSource ?? 'unknown',
        endOfDayTimeReason: (slot as any).endOfDayTimeReason ?? '',
        isWithinWorkHours: slot.currentTime >= slot.workDayStart && slot.currentTime < slot.endOfWorkHours,
        afterHoursBehavior: settings.afterHoursBehavior,
        printerHasAMS: slot.hasAMS,
        printerCanStartAfterHours: printer?.canStartNewCyclesAfterHours,
        lastScheduledColor: slot.lastScheduledColor ?? 'none',
        projectColor: project.project.color ?? 'none',
        presetAllowedForNight: project.preset?.allowedForNightCycle,
      });
      
      // Track reason for summary
      trackAdvanceReason?.('canStartCycleAt_false');
      
      // Advance to next workday
      const nextStart = advanceToNextWorkdayStart(slot.currentTime, settings, {
        reason: 'canStartCycleAt_false',
        printerId: slot.printerId,
        printerName: slot.printerName,
        currentTime: slot.currentTime,
        isNightSlot: slot.currentTime >= slot.endOfWorkHours,
        projectId: project.project.id,
        projectName: project.project.name,
      });
      if (!nextStart) continue;
      
      slot.currentTime = nextStart;
      updateSlotBoundsForDay(slot, nextStart, settings);
      // Release plates using getNextOperatorTime (self-contained, doesn't use slot bounds)
      if (slot.platesInUse) {
        slot.platesInUse = slot.platesInUse.filter(p => 
          getNextOperatorTime(p.releaseTime, settings) > slot.currentTime
        );
      }
      heap.push(slot.currentTime.getTime(), slot);
      continue;
    }
    
    // Calculate cycle timing
    const cycleHours = project.preset.cycleHours;
    const cycleEndTime = new Date(slot.currentTime.getTime() + cycleHours * 60 * 60 * 1000);
    
    // Check if cycle fits in available window
    if (cycleEndTime > slot.endOfDayTime) {
      // ============= DEBUG LOG: Cycle exceeds endOfDayTime =============
      console.log('[V2Schedule] ⏭️ Advancing to next day:', {
        reason: 'cycle_exceeds_endOfDayTime',
        projectId: project.project.id,
        projectName: project.project.name,
        printerId: slot.printerId,
        printerName: slot.printerName,
        currentTime: slot.currentTime.toISOString(),
        cycleEndTime: cycleEndTime.toISOString(),
        cycleHours: cycleHours,
        workDayStart: slot.workDayStart.toISOString(),
        endOfWorkHours: slot.endOfWorkHours.toISOString(),
        endOfDayTime: slot.endOfDayTime.toISOString(),
        endOfDayTimeSource: (slot as any).endOfDayTimeSource ?? 'unknown',
        endOfDayTimeReason: (slot as any).endOfDayTimeReason ?? '',
        afterHoursBehavior: settings.afterHoursBehavior,
        printerHasAMS: slot.hasAMS,
        printerCanStartAfterHours: slot.canStartNewCyclesAfterHours,
        lastScheduledColor: slot.lastScheduledColor ?? 'none',
        projectColor: project.project.color ?? 'none',
        presetAllowedForNight: project.preset?.allowedForNightCycle,
      });
      
      // Track reason for summary
      trackAdvanceReason?.('cycle_exceeds_endOfDayTime');
      
      // Doesn't fit - advance to next workday
      const nextStart = advanceToNextWorkdayStart(slot.currentTime, settings, {
        reason: 'cycle_exceeds_endOfDayTime',
        printerId: slot.printerId,
        printerName: slot.printerName,
        currentTime: slot.currentTime,
        isNightSlot: slot.currentTime >= slot.endOfWorkHours,
        projectId: project.project.id,
        projectName: project.project.name,
      });
      if (!nextStart) continue;
      
      slot.currentTime = nextStart;
      updateSlotBoundsForDay(slot, nextStart, settings);
      // Release plates using getNextOperatorTime (self-contained, doesn't use slot bounds)
      if (slot.platesInUse) {
        slot.platesInUse = slot.platesInUse.filter(p => 
          getNextOperatorTime(p.releaseTime, settings) > slot.currentTime
        );
      }
      heap.push(slot.currentTime.getTime(), slot);
      continue;
    }
    
    // ============= NIGHT COLOR LOCK CHECK (Non-AMS printers) =============
    // PER OFFICIAL SPEC: At night without AMS, printer is locked to PHYSICAL color.
    // CRITICAL FIX: Uses nightIneligibleUntil to prevent infinite loops
    const isNightSlot = isNightTime(slot.currentTime, slot.endOfWorkHours);
    
    if (isNightSlot && !slot.hasAMS) {
      // CONDITION 1: nightIneligibleUntil - if printer is marked ineligible for night, skip until end of night
      if (slot.nightIneligibleUntil && slot.currentTime < slot.nightIneligibleUntil) {
        console.log('[V2Schedule] 🌙 NIGHT INELIGIBLE - Skipping until end of night:', {
          printerId: slot.printerId,
          printerName: slot.printerName,
          currentTime: slot.currentTime.toISOString(),
          nightIneligibleUntil: slot.nightIneligibleUntil.toISOString(),
          action: 'SKIP_TO_DAY_START',
        });
        
        // Advance to next workday start (end of night ineligibility)
        const nextStart = advanceToNextWorkdayStart(slot.currentTime, settings, {
          reason: 'nightIneligibleUntil_skip',
          printerId: slot.printerId,
          printerName: slot.printerName,
          currentTime: slot.currentTime,
          isNightSlot: true, // We're definitely in night slot if this code runs
          nightIneligibleUntil: slot.nightIneligibleUntil,
          projectId: project.project.id,
          projectName: project.project.name,
        });
        if (!nextStart) continue;
        
        slot.currentTime = nextStart;
        slot.nightIneligibleUntil = undefined; // Clear for new day
        updateSlotBoundsForDay(slot, nextStart, settings);
        heap.push(slot.currentTime.getTime(), slot);
        continue;
      }
      
      // RULE: No AMS + Night = Printer color is LOCKED to physical mounted color
      
      // Check if we have a VALID physical color
      const hasValidPhysicalColor = 
        slot.physicalLockedColor && 
        slot.physicalLockedColor.trim() !== '' && 
        slot.physicalLockedColor.toUpperCase() !== 'NONE';
      
      if (!hasValidPhysicalColor) {
        // ============= No physical color known = Mark printer INELIGIBLE for tonight =============
        // CONDITION 1 FIX: Set nightIneligibleUntil to end of night window (prevents infinite loop)
        const nightEnd = getEndOfNightWindow(slot.currentTime, settings);
        slot.nightIneligibleUntil = nightEnd;
        
        console.log('[V2Schedule] 🚫 NIGHT BLOCK - No physical color known:', {
          reason: 'no_physical_color_night',
          projectId: project.project.id,
          projectName: project.project.name,
          printerId: slot.printerId,
          printerName: slot.printerName,
          currentTime: slot.currentTime.toISOString(),
          nightIneligibleUntil: nightEnd.toISOString(),
          hasAMS: slot.hasAMS,
          physicalLockedColor: slot.physicalLockedColor ?? 'undefined',
          projectColor: project.project.color ?? 'none',
          rule: 'NO physical color = Printer INELIGIBLE for tonight. Will try at day start.',
          action: 'SET_NIGHT_INELIGIBLE_UNTIL',
        });
        
        logCycleBlock({
          reason: 'no_physical_color_night',
          projectId: project.project.id,
          projectName: project.project.name,
          printerId: slot.printerId,
          printerName: slot.printerName,
          details: `Night block: No physical color known. Printer marked ineligible until ${nightEnd.toISOString()}`,
        });
        
        trackAdvanceReason?.('no_physical_color_night');
        
        // CONDITION 2: Only advance when isNightSlot=true (we're in night, advance to day)
        const nextStart = advanceToNextWorkdayStart(slot.currentTime, settings, {
          reason: 'no_physical_color_night',
          printerId: slot.printerId,
          printerName: slot.printerName,
          currentTime: slot.currentTime,
          isNightSlot: true, // We're definitely in night slot if this code runs
          nightIneligibleUntil: nightEnd,
          projectId: project.project.id,
          projectName: project.project.name,
        });
        if (!nextStart) continue;
        
        slot.currentTime = nextStart;
        updateSlotBoundsForDay(slot, nextStart, settings);
        if (slot.platesInUse) {
          slot.platesInUse = slot.platesInUse.filter(p => 
            getNextOperatorTime(p.releaseTime, settings) > slot.currentTime
          );
        }
        heap.push(slot.currentTime.getTime(), slot);
        continue;
      }
      
      // Physical color IS known - verify it matches project color
      const physicalColorKey = normalizeColor(slot.physicalLockedColor);
      if (physicalColorKey !== colorKey) {
        // ============= Color mismatch = Skip THIS project, try others =============
        // IMPORTANT: Do NOT advance to next day - just skip this project
        // Other projects with matching colors can still be scheduled for this night slot
        console.log('[V2Schedule] 🔒 NIGHT COLOR LOCK - MISMATCH:', {
          reason: 'color_lock_night',
          projectId: project.project.id,
          projectName: project.project.name,
          printerId: slot.printerId,
          printerName: slot.printerName,
          currentTime: slot.currentTime.toISOString(),
          hasAMS: slot.hasAMS,
          physicalLockedColor: slot.physicalLockedColor,
          physicalColorKey,
          projectColor: project.project.color ?? 'none',
          projectColorKey: colorKey,
          action: 'SKIP_PROJECT_TRY_NEXT',
        });
        
        logCycleBlock({
          reason: 'color_lock_night',
          projectId: project.project.id,
          projectName: project.project.name,
          printerId: slot.printerId,
          printerName: slot.printerName,
          details: `Night color lock: printer has ${slot.physicalLockedColor}, project needs ${project.project.color}. Trying next project.`,
        });
        
        trackAdvanceReason?.('color_lock_night');
        
        // CRITICAL FIX: Do NOT advance the printer - just continue to next project
        // The printer stays at the same time, we just try the next project in queue
        continue;
      }
      
      // ============= Color MATCHES - PASS =============
      console.log('[V2Schedule] ✅ NIGHT COLOR LOCK - PASS:', {
        printerId: slot.printerId,
        printerName: slot.printerName,
        physicalLockedColor: slot.physicalLockedColor,
        projectColor: project.project.color,
        verdict: 'ALLOWED - colors match',
      });
    }
    
    // ============= SECONDARY NIGHT VALIDATION (V2) =============
    // If cycle starts during work hours but ends after - validate autonomous operation
    if (!isNightSlot && cycleEndTime > slot.endOfWorkHours) {
      // Cycle extends into night - check if allowed
      const canRunAutonomous = 
        settings.afterHoursBehavior === 'FULL_AUTOMATION' &&
        (printer?.canStartNewCyclesAfterHours ?? false) &&
        project.preset.allowedForNightCycle !== false;
      
      if (!canRunAutonomous) {
        // ============= DEBUG LOG: Cycle extends to night not allowed =============
        console.log('[V2Schedule] ⏭️ Advancing to next day:', {
          reason: 'cycle_extends_night_not_allowed',
          projectId: project.project.id,
          projectName: project.project.name,
          printerId: slot.printerId,
          printerName: slot.printerName,
          currentTime: slot.currentTime.toISOString(),
          cycleEndTime: cycleEndTime.toISOString(),
          cycleHours: cycleHours,
          workDayStart: slot.workDayStart.toISOString(),
          endOfWorkHours: slot.endOfWorkHours.toISOString(),
          endOfDayTime: slot.endOfDayTime.toISOString(),
          endOfDayTimeSource: (slot as any).endOfDayTimeSource ?? 'unknown',
          afterHoursBehavior: settings.afterHoursBehavior,
          printerHasAMS: slot.hasAMS,
          printerCanStartAfterHours: printer?.canStartNewCyclesAfterHours,
          lastScheduledColor: slot.lastScheduledColor ?? 'none',
          projectColor: project.project.color ?? 'none',
          presetAllowedForNight: project.preset?.allowedForNightCycle,
        });
        
        // Track reason for summary
        trackAdvanceReason?.('cycle_extends_night_not_allowed');
        
        // Cannot extend into night - advance to next workday
        const nextStart = advanceToNextWorkdayStart(slot.currentTime, settings, {
          reason: 'cycle_extends_night_not_allowed',
          printerId: slot.printerId,
          printerName: slot.printerName,
          currentTime: slot.currentTime,
          isNightSlot: false, // Cycle starts in day but extends into night
          projectId: project.project.id,
          projectName: project.project.name,
        });
        if (!nextStart) continue;
        
        slot.currentTime = nextStart;
        updateSlotBoundsForDay(slot, nextStart, settings);
        // Release plates using getNextOperatorTime (self-contained, doesn't use slot bounds)
        if (slot.platesInUse) {
          slot.platesInUse = slot.platesInUse.filter(p => 
            getNextOperatorTime(p.releaseTime, settings) > slot.currentTime
          );
        }
        heap.push(slot.currentTime.getTime(), slot);
        continue;
      }
      
      // ============= NON-AMS COLOR LOCK FOR NIGHT EXTENSION =============
      // Per official spec: Use physicalLockedColor (physical mounted color), not lastScheduledColor
      if (!slot.hasAMS && slot.physicalLockedColor) {
        const physicalColorKey = normalizeColor(slot.physicalLockedColor);
        if (physicalColorKey !== colorKey) {
          // ============= DEBUG LOG: Non-AMS color lock for night extension =============
          console.log('[V2Schedule] 🔒 NON-AMS COLOR LOCK (extends to night):', {
            reason: 'non_ams_color_lock',
            projectId: project.project.id,
            projectName: project.project.name,
            printerId: slot.printerId,
            printerName: slot.printerName,
            currentTime: slot.currentTime.toISOString(),
            cycleEndTime: cycleEndTime.toISOString(),
            cycleHours: cycleHours,
            workDayStart: slot.workDayStart.toISOString(),
            endOfWorkHours: slot.endOfWorkHours.toISOString(),
            endOfDayTime: slot.endOfDayTime.toISOString(),
            endOfDayTimeSource: (slot as any).endOfDayTimeSource ?? 'unknown',
            afterHoursBehavior: settings.afterHoursBehavior,
            printerHasAMS: slot.hasAMS,
            printerCanStartAfterHours: slot.canStartNewCyclesAfterHours,
            physicalLockedColor: slot.physicalLockedColor,  // SOURCE OF TRUTH
            lastScheduledColor: slot.lastScheduledColor ?? 'none',  // For reference
            projectColor: project.project.color ?? 'none',
            physicalColorKey,
            projectColorKey: colorKey,
            rule: 'PHYSICAL color takes precedence - cycle extends to night when no operator',
          });
          
          // Track reason for summary
          trackAdvanceReason?.('non_ams_color_lock');
          
          // Non-AMS printer locked to different PHYSICAL color - cannot extend into night
          const nextStart = advanceToNextWorkdayStart(slot.currentTime, settings, {
            reason: 'non_ams_color_lock',
            printerId: slot.printerId,
            printerName: slot.printerName,
            currentTime: slot.currentTime,
            isNightSlot: false, // Cycle starts in day but extends into night
            projectId: project.project.id,
            projectName: project.project.name,
          });
          if (!nextStart) continue;
          
          slot.currentTime = nextStart;
          updateSlotBoundsForDay(slot, nextStart, settings);
          heap.push(slot.currentTime.getTime(), slot);
          continue;
        }
      }
    }
    
    // Calculate units and grams
    const unitsThisCycle = Math.min(project.preset.unitsPerPlate, remainingUnits);
    const gramsThisCycle = unitsThisCycle * project.product.gramsPerUnit;
    
    // ============= FIX #1: Check material with consumed tracking =============
    const availableMaterialNow = (workingMaterial.get(colorKey) ?? 0) - consumedMaterial;
    const hasMaterial = availableMaterialNow >= gramsThisCycle;
    let readinessState: CycleReadinessState = 'waiting_for_spool';
    let readinessDetails: string | undefined;
    
    if (!hasMaterial) {
      readinessState = 'blocked_inventory';
      readinessDetails = `חסר ${project.project.color}: צריך ${gramsThisCycle}g`;
    } else if (normalizeColor(slot.lastScheduledColor || '') === colorKey) {
      readinessState = 'ready';
    } else {
      readinessState = 'waiting_for_spool';
      readinessDetails = `טען גליל ${project.project.color} על ${slot.printerName}`;
    }
    
    // Calculate remaining day hours for end-of-day detection
    const remainingDayHours = (slot.endOfDayTime.getTime() - cycleEndTime.getTime()) / (1000 * 60 * 60);
    const isEndOfDayCycle = remainingDayHours < 2;
    
    // Plate tracking
    const plateReleaseTime = new Date(cycleEndTime.getTime() + PLATE_CLEANUP_MINUTES * 60 * 1000);
    const plateIndex = (slot.cyclesScheduled?.length ?? 0) + 1;
    
    // Create cycle
    const cycle: ScheduledCycle = {
      id: generateId(),
      projectId: project.project.id,
      printerId: slot.printerId,
      unitsPlanned: unitsThisCycle,
      gramsPlanned: gramsThisCycle,
      startTime: new Date(slot.currentTime),
      endTime: cycleEndTime,
      plateType: unitsThisCycle < project.preset.unitsPerPlate 
        ? (remainingUnits <= unitsThisCycle ? 'closeout' : 'reduced')
        : 'full',
      shift: isEndOfDayCycle ? 'end_of_day' : 'day',
      isEndOfDayCycle,
      readinessState,
      readinessDetails,
      requiredColor: project.project.color,
      requiredGrams: gramsThisCycle,
      presetId: project.preset.id,
      presetName: project.preset.name,
      presetSelectionReason: 'Selected by planning engine',
      plateIndex,
      plateReleaseTime,
    };
    
    scheduledCycles.push(cycle);
    remainingUnits -= unitsThisCycle;
    
    // ============= FIX #1: Track consumed material =============
    consumedMaterial += gramsThisCycle;
    
    // ============= FIX #2: Update plate tracking =============
    if (!slot.platesInUse) slot.platesInUse = [];
    slot.platesInUse.push({
      releaseTime: plateReleaseTime,
      cycleId: cycle.id,
    });
    
    // Update slot
    slot.cyclesScheduled = slot.cyclesScheduled || [];
    slot.cyclesScheduled.push(cycle);
    slot.currentTime = new Date(cycleEndTime.getTime() + transitionMs);
    
    // ============= COLOR TRACKING UPDATE (per official spec) =============
    // lastScheduledColor: Always updated (for optimization/grouping)
    slot.lastScheduledColor = project.project.color;
    
    // physicalLockedColor: ONLY updated when operator is present (during work hours)!
    // This is the PHYSICAL constraint - color cannot change without operator.
    // At night, the physical color stays locked to whatever was last set during work hours.
    const cycleStartTime = new Date(slot.currentTime.getTime() - (cycleHours * 60 * 60_000) - transitionMs);
    const isOperatorPresentNow = isWithinWorkWindow(cycleStartTime, slot.workDayStart, slot.endOfWorkHours);
    if (isOperatorPresentNow) {
      // Operator is present - they can change the spool, so update physical color
      slot.physicalLockedColor = project.project.color;
    }
    // If no operator, physical color stays locked to previous value
    
    // Track spool assignment
    if (!workingSpoolAssignments.has(colorKey)) {
      workingSpoolAssignments.set(colorKey, new Set());
    }
    workingSpoolAssignments.get(colorKey)!.add(slot.printerId);
    
    // Push back to heap
    heap.push(slot.currentTime.getTime(), slot);
  }
  
  // Update project remaining units
  project.remainingUnits = remainingUnits;
  
  return scheduledCycles;
}

// ============= CONSTRAINT VALIDATION =============


const validateMaterialConstraints = (
  projectStates: ProjectPlanningState[],
  spools: Spool[]
): BlockingIssue[] => {
  const issues: BlockingIssue[] = [];
  const materialNeeds = new Map<string, { needed: number; projectIds: string[] }>();
  
  // Calculate total material needed per color (using normalized color keys)
  for (const state of projectStates) {
    const gramsNeeded = state.remainingUnits * state.product.gramsPerUnit;
    const colorKey = normalizeColor(state.project.color);
    
    const existing = materialNeeds.get(colorKey) || { needed: 0, projectIds: [] };
    existing.needed += gramsNeeded;
    existing.projectIds.push(state.project.id);
    materialNeeds.set(colorKey, existing);
  }
  
  // Build available material map from ColorInventory (primary source)
  const availableMaterial = new Map<string, number>();
  const colorInventory = getColorInventory();
  for (const item of colorInventory) {
    const colorKey = normalizeColor(item.color);
    const current = availableMaterial.get(colorKey) || 0;
    availableMaterial.set(colorKey, current + getTotalGrams(item));
  }
  
  // Also check spools for backward compatibility
  for (const spool of spools) {
    if (spool.state !== 'empty') {
      const colorKey = normalizeColor(spool.color);
      if (!availableMaterial.has(colorKey)) {
        const current = availableMaterial.get(colorKey) || 0;
        availableMaterial.set(colorKey, current + spool.gramsRemainingEst);
      }
    }
  }
  
  // Check against available material
  for (const [colorKey, needs] of materialNeeds) {
    const available = availableMaterial.get(colorKey) || 0;
    
    if (available < needs.needed) {
      issues.push({
        type: 'insufficient_material',
        message: `חסר פילמנט ${colorKey}: נדרשים ${Math.ceil(needs.needed)}g, זמינים ${Math.ceil(available)}g`,
        messageEn: `Insufficient ${colorKey} filament: need ${Math.ceil(needs.needed)}g, have ${Math.ceil(available)}g`,
        details: {
          required: needs.needed,
          available,
          shortfall: needs.needed - available,
        },
      });
    }
  }
  
  return issues;
};

const validateTimeConstraints = (
  projectStates: ProjectPlanningState[],
  settings: FactorySettings,
  printers: Printer[],
  fromDate: Date,
  planningDays: number
): BlockingIssue[] => {
  const issues: BlockingIssue[] = [];
  
  for (const state of projectStates) {
    // Calculate hours needed
    const cyclesNeeded = Math.ceil(state.remainingUnits / state.preset.unitsPerPlate);
    const hoursNeeded = cyclesNeeded * state.preset.cycleHours;
    
    // Calculate available hours until due date
    let availableHours = 0;
    const daysToCheck = Math.min(state.daysUntilDue, planningDays);
    
    for (let i = 0; i < daysToCheck; i++) {
      const checkDate = new Date(fromDate);
      checkDate.setDate(checkDate.getDate() + i);
      const schedule = getDayScheduleForDate(checkDate, settings, []);
      availableHours += getWorkingHoursForDay(schedule) * printers.length;
    }
    
    // Account for transition time between cycles
    const transitionHours = (cyclesNeeded - 1) * (settings.transitionMinutes / 60);
    const totalHoursNeeded = hoursNeeded + transitionHours;
    
    if (totalHoursNeeded > availableHours && state.daysUntilDue <= planningDays) {
      issues.push({
        type: 'deadline_impossible',
        message: `פרויקט "${state.project.name}" לא ניתן להשלמה עד ${state.project.dueDate}: נדרשות ${totalHoursNeeded.toFixed(1)} שעות, זמינות ${availableHours.toFixed(1)}`,
        messageEn: `Project "${state.project.name}" cannot be completed by ${state.project.dueDate}: need ${totalHoursNeeded.toFixed(1)}h, have ${availableHours.toFixed(1)}h`,
        projectId: state.project.id,
        details: {
          required: totalHoursNeeded,
          available: availableHours,
          shortfall: totalHoursNeeded - availableHours,
        },
      });
    }
  }
  
  return issues;
};

// ============= CYCLE SCHEDULING =============

// PlateReleaseInfo imported from schedulingHelpers

interface PrinterTimeSlot {
  printerId: string;
  printerName: string;
  currentTime: Date;
  endOfDayTime: Date;  // Extended end (includes night window for FULL_AUTOMATION)
  endOfWorkHours: Date; // Regular work end (for determining if cycle is "night")
  workDayStart: Date;   // Start of this work day (for work hours check)
  cyclesScheduled: ScheduledCycle[];
  // ============= PLATE CONSTRAINT FIELDS =============
  physicalPlateCapacity: number;  // From printer settings (default 4)
  platesInUse: PlateReleaseInfo[];  // Plates currently in use with release times
  
  // ============= COLOR TRACKING (per official spec) =============
  // CRITICAL: physicalLockedColor is the PHYSICAL color mounted on the printer.
  // This is the source of truth for night color lock checks.
  // It can ONLY change when operator is present (during work hours).
  physicalLockedColor?: string;  // The actual mounted color (from printer.mountedColor or spool)
  
  // lastScheduledColor tracks what color was last PLANNED on this printer.
  // This is for optimization/grouping during normal hours, NOT for night locks.
  lastScheduledColor?: string;
  
  hasAMS: boolean;                // Cache of printer.hasAMS
  canStartNewCyclesAfterHours: boolean;  // Cache of printer.canStartNewCyclesAfterHours
  // ============= DEBUG FIELDS =============
  endOfDayTimeSource?: EndOfDayTimeSource;    // Why endOfDayTime was set to its value
  endOfDayTimeReason?: string;    // Additional human-readable reason
  // ============= PRE-LOADED PLATES FOR OVERNIGHT/WEEKEND =============
  // When operator leaves at end of work hours, they load up to 5 plates
  // These plates are consumed one-by-one during night/weekend cycles
  preLoadedPlatesRemaining: number;  // Starts at 0, set to 5 when operator loads
  preLoadedAt?: Date;  // Track when plates were pre-loaded (for debugging)
  // ============= AUTONOMOUS DAY FLAG =============
  isAutonomousDay: boolean;  // True for non-working days (Fri/Sat) - no operator to load plates
  // ============= NIGHT INELIGIBILITY (CONDITION 1 FIX) =============
  // CRITICAL: Prevents infinite loop in night scheduling!
  // When a printer fails a hard night requirement (e.g., no physical color),
  // set this to the end of the night window. The scheduler will skip ALL projects
  // for this printer until this time, then clear it for the new day.
  nightIneligibleUntil?: Date;
}

const scheduleCyclesForDay = (
  date: Date,
  schedule: DaySchedule,
  printers: Printer[],
  projectStates: ProjectPlanningState[],
  settings: FactorySettings,
  materialTracker: Map<string, number>,
  existingCycles: PlannedCycle[],
  spoolAssignmentTracker: Map<string, Set<string>>, // tracks which spools are assigned to which printers
  allowCrossMidnight: boolean = false, // allow cycles to cross midnight
  planningStartTime?: Date, // NEW: When replanning starts (from recalculatePlan)
  isAutonomousDay: boolean = false, // true for non-working days with FULL_AUTOMATION
  trackAdvanceReason?: AdvanceReasonTracker
): { dayPlan: DayPlan; updatedProjectStates: ProjectPlanningState[]; updatedMaterialTracker: Map<string, number>; updatedSpoolAssignments: Map<string, Set<string>> } => {
  
  // ============= DEBUG: Night scheduling input diagnostic =============
  console.log('[NightScheduling] ⚡ scheduleCyclesForDay input:', {
    date: formatDateString(date),
    isAutonomousDay,
    afterHoursBehavior: settings.afterHoursBehavior,
    printerNightConfig: printers.map(p => ({
      id: p.id,
      name: p.name,
      canStartNewCyclesAfterHours: p.canStartNewCyclesAfterHours,
      status: p.status,
    })),
  });
  
  const dayStart = isAutonomousDay
    ? createDateWithTime(date, '00:00') 
    : createDateWithTime(date, schedule.startTime);
  
  // Calculate dayEnd based on mode:
  // 1. Autonomous day (non-working with FULL_AUTOMATION): runs until next working day starts
  // 2. FULL_AUTOMATION on working day: extends night window until next working day starts
  // 3. Normal: just the regular work hours
  let dayEnd: Date;
  // For autonomous days, endOfRegularWorkday is start of day (00:00) - any cycle is "night"
  let endOfRegularWorkday: Date = isAutonomousDay 
    ? createDateWithTime(date, '00:00')
    : createDateWithTime(date, schedule.endTime);
  
  if (isAutonomousDay) {
    // Non-working day: window extends until next working day start
    const nextWorkDayStart = findNextWorkDayStart(date, settings, 7);
    dayEnd = nextWorkDayStart ?? createDateWithTime(addDays(date, 1), '00:00');
  } else {
    // Working day - calculate regular end
    const startMinutes = parseTime(schedule.startTime).hours * 60 + parseTime(schedule.startTime).minutes;
    const endMinutes = parseTime(schedule.endTime).hours * 60 + parseTime(schedule.endTime).minutes;
    
    if (endMinutes < startMinutes || allowCrossMidnight) {
      // Shift crosses midnight - add 1 day to end time
      endOfRegularWorkday = addHours(endOfRegularWorkday, 24);
    }
    
    // For FULL_AUTOMATION, extend to next working day's start (clean night window)
    if (settings.afterHoursBehavior === 'FULL_AUTOMATION') {
      const nextWorkDayStart = findNextWorkDayStart(date, settings, 7);
      // Use next day start OR 24h from work end (whichever is earlier/defined)
      dayEnd = nextWorkDayStart ?? createDateWithTime(addDays(date, 1), schedule.startTime);
    } else {
      dayEnd = endOfRegularWorkday;
    }
  }
  
  const dateString = formatDateString(date);
  const planningDateString = planningStartTime ? formatDateString(planningStartTime) : null;
  
  // Check if we're planning for the same day as planningStartTime
  const isSameDay = Boolean(planningStartTime && planningDateString === dateString);
  
  dbgStart('SameDayCheck', {
    dateISO: date.toISOString(),
    planningISO: planningStartTime?.toISOString() ?? null,
    dateString,
    planningDateString,
    isSameDay,
  });
  
  dbgStart('Day init', {
    dateString,
    dayStart: dayStart.toISOString(),
    dayEnd: dayEnd.toISOString(),
    endOfWorkHours: endOfRegularWorkday.toISOString(),
    isAutonomousDay,
    planningStartTime: planningStartTime?.toISOString() ?? null,
  });
  
  // ============= SAFE FIX: Calculate effective start time =============
  // If planningStartTime is provided and it's today, use max(dayStart, planningStartTime)
  // This prevents scheduling cycles in the past when replanning mid-day
  const effectiveStart = isSameDay && planningStartTime
    ? new Date(Math.max(dayStart.getTime(), planningStartTime.getTime()))
    : new Date(dayStart);
  
  dbgStart('EffectiveStart', {
    dateString,
    isSameDay: Boolean(isSameDay),
    effectiveStart: effectiveStart.toISOString(),
  });
  
  // Find locked cycles (completed/in_progress or manually locked) for this day
  // These cycles are treated as "facts" - the engine plans around them
  const lockedCyclesForDay = existingCycles.filter(c => {
    const cycleDate = formatDateString(new Date(c.startTime));
    if (cycleDate !== dateString) return false;
    // Include completed, in_progress, OR manually locked cycles
    return c.status === 'in_progress' || c.status === 'completed' || (c.locked && c.source === 'manual');
  });
  
  // Compute latest locked end per printer (busyUntil)
  const busyUntilByPrinter = new Map<string, Date>();
  for (const c of lockedCyclesForDay) {
    const pid = c.printerId;
    const end = new Date(c.endTime);
    const prev = busyUntilByPrinter.get(pid);
    if (!prev || end.getTime() > prev.getTime()) {
      busyUntilByPrinter.set(pid, end);
    }
  }
  
  dbgStart('BusyUntilByPrinter', Array.from(busyUntilByPrinter.entries()).map(([pid, dt]) => ({
    printerId: pid,
    busyUntil: dt.toISOString(),
  })));
  
  const transitionMs = (settings.transitionMinutes ?? 0) * 60_000;
  
  // Initialize printer time slots with correct start time
  // Each printer starts at max(effectiveStart, busyUntil + transition)
  const printerSlots: PrinterTimeSlot[] = printers.map(p => {
    const busyUntil = busyUntilByPrinter.get(p.id);
    const startFromBusy = busyUntil 
      ? new Date(busyUntil.getTime() + transitionMs) 
      : null;
    
    // Use the later of: effectiveStart OR when printer becomes free
    const startTime = startFromBusy && startFromBusy.getTime() > effectiveStart.getTime()
      ? startFromBusy
      : effectiveStart;
    
    // ============= PLATE CONSTRAINT INITIALIZATION =============
    // FIXED HARDWARE CAPACITY: All printers have 8 plate capacity
    // Global allocation (50 plates total) is handled by nightPreloadCalculator
    // - During work hours: plates recycle after cycle ends + 10min cleanup
    // - Outside work hours: plates don't recycle, hard stop after capacity exhausted
    const FIXED_PLATE_CAPACITY = 8;
    const plateCapacity = FIXED_PLATE_CAPACITY;
    
    // Initialize plates in use from locked cycles
    // Each locked cycle "holds" a plate until its end time + cleanup delay
    const lockedCyclesForPrinter = lockedCyclesForDay.filter(c => c.printerId === p.id);
    const PLATE_CLEANUP_MINUTES = 10;
    const platesInUse: PlateReleaseInfo[] = lockedCyclesForPrinter.map(c => ({
      releaseTime: new Date(new Date(c.endTime).getTime() + PLATE_CLEANUP_MINUTES * 60_000),
      cycleId: c.id,
    }));
    
    // Get the last scheduled color from locked cycles (for optimization grouping)
    const lastLockedCycle = lockedCyclesForPrinter
      .sort((a, b) => new Date(b.endTime).getTime() - new Date(a.endTime).getTime())[0];
    const lastScheduledColor = lastLockedCycle?.requiredColor;
    
    // ============= PHYSICAL LOCKED COLOR (V2-ONLY SPEC) =============
    // PRIORITY ORDER for determining physical color:
    // 1. mountedColor - explicit spool loading (most current)
    // 2. confirmedSpoolColor - set on Start Print (persists between prints)
    // 3. undefined - truly no physical color known
    const physicalLockedColor = p.mountedColor ?? p.confirmedSpoolColor ?? undefined;
    
    // Diagnostic log: show which source was used
    console.log('[Planning] 🔒 physicalLockedColor for', p.name, ':', {
      mountedColor: p.mountedColor ?? 'undefined',
      confirmedSpoolColor: p.confirmedSpoolColor ?? 'undefined',
      confirmedSpoolAt: p.confirmedSpoolAt ?? 'never',
      resolved: physicalLockedColor ?? 'NO_PHYSICAL_COLOR',
    });
    
    // Warning if currentColor exists but neither mounted nor confirmed color
    if (p.currentColor && !p.mountedColor && !p.confirmedSpoolColor) {
      console.warn('[Planning] ⚠️ Printer has currentColor but NO mountedColor/confirmedSpoolColor (IGNORED):', {
        printerId: p.id,
        printerName: p.name,
        currentColor: p.currentColor,
        warning: 'currentColor is history only - NOT a physical spool!',
      });
    }
    
    // ============= COMPUTE endOfDayTimeSource for debugging =============
    // Source is ONLY 'endOfWorkHours' or 'nextWorkdayStart', reason explains why
    let endOfDayTimeSource: EndOfDayTimeSource = 'endOfWorkHours';
    let endOfDayTimeReason = '';
    
    if (isAutonomousDay) {
      endOfDayTimeSource = 'nextWorkdayStart';
      endOfDayTimeReason = 'autonomous_day: extends to next workday';
    } else if (settings.afterHoursBehavior !== 'FULL_AUTOMATION') {
      endOfDayTimeSource = 'endOfWorkHours';
      endOfDayTimeReason = `afterHours_disabled: afterHoursBehavior=${settings.afterHoursBehavior}`;
    } else if (!p.canStartNewCyclesAfterHours) {
      endOfDayTimeSource = 'endOfWorkHours';
      endOfDayTimeReason = `printer_night_disabled: canStartNewCyclesAfterHours=false`;
    } else {
      // FULL_AUTOMATION enabled and printer allows night
      endOfDayTimeSource = 'nextWorkdayStart';
      endOfDayTimeReason = `extended to ${dayEnd.toISOString()}`;
    }
    
    // FIX: Calculate printer-specific endOfDayTime based on the source we computed
    // This ensures endOfDayTime matches endOfDayTimeSource (was always using dayEnd before)
    const printerEndOfDayTime = endOfDayTimeSource === 'nextWorkdayStart'
      ? new Date(dayEnd)
      : new Date(endOfRegularWorkday);
    
    return {
      printerId: p.id,
      printerName: p.name,
      currentTime: new Date(startTime),
      endOfDayTime: printerEndOfDayTime,  // FIX: per-printer calculation
      endOfWorkHours: new Date(endOfRegularWorkday),
      workDayStart: new Date(dayStart),
      cyclesScheduled: [],
      // Plate constraint fields
      physicalPlateCapacity: plateCapacity,
      platesInUse,
      // Color tracking (per official spec)
      physicalLockedColor,  // Physical mounted color - source of truth for night locks
      lastScheduledColor,   // For optimization/grouping during normal hours
      hasAMS: p.hasAMS ?? false,
      canStartNewCyclesAfterHours: p.canStartNewCyclesAfterHours ?? false,
      // Debug fields
      endOfDayTimeSource,
      endOfDayTimeReason,
      // Pre-loaded plates for overnight runs (starts at 0, set when operator loads at end of day)
      preLoadedPlatesRemaining: 0,
      preLoadedAt: undefined,
      // Autonomous day flag - no operator available to load plates
      isAutonomousDay,
    };
  });
  
  // ============= MANDATORY DEBUG LOG: Printer state at planning start =============
  // Log every printer's AMS and color state to debug night color lock issues
  // Per official spec: physicalLockedColor is SOURCE OF TRUTH for night locks
  console.log('[Planning] 🖨️ === PRINTER STATE AT PLANNING START ===');
  for (const slot of printerSlots) {
    const printer = printers.find(p => p.id === slot.printerId);
    console.log('[Planning] 🖨️ Printer:', {
      printerId: slot.printerId,
      printerName: slot.printerName,
      // AMS status - determines if color can change at night
      hasAMS: slot.hasAMS,
      hasAMS_fromPrinter: printer?.hasAMS ?? 'undefined',
      // COLOR TRACKING (per official spec):
      physicalLockedColor: slot.physicalLockedColor ?? 'NONE',  // SOURCE OF TRUTH for night locks
      lastScheduledColor: slot.lastScheduledColor ?? 'none',    // For optimization only
      rawMountedColor: printer?.mountedColor ?? 'undefined',    // Raw printer data
      rawCurrentColor: printer?.currentColor ?? 'undefined',    // Raw printer data
      // Other settings
      canStartNewCyclesAfterHours: slot.canStartNewCyclesAfterHours,
      physicalPlateCapacity: slot.physicalPlateCapacity,
      isAutonomousDay: slot.isAutonomousDay ?? false,
    });
  }
  console.log('[Planning] 🖨️ === END PRINTER STATE ===');
  
  dbgStart('SlotsStartTimes', printerSlots.map(s => ({
    printer: s.printerName,
    printerId: s.printerId,
    slotStart: s.currentTime.toISOString(),
    endOfDayTime: s.endOfDayTime.toISOString(),
    endOfDayTimeSource: s.endOfDayTimeSource,
    platesInUse: s.platesInUse.length,
    physicalPlateCapacity: s.physicalPlateCapacity,
    hasAMS: s.hasAMS,
    lastScheduledColor: s.lastScheduledColor,
  })));
  
  // Clone project states for modification
  let workingStates = projectStates.map(s => ({ ...s }));
  const workingMaterial = new Map(materialTracker);
  
  // Clone spool assignment tracker (color -> set of printer IDs using that color simultaneously)
  const workingSpoolAssignments = new Map<string, Set<string>>();
  for (const [color, printerSet] of spoolAssignmentTracker) {
    workingSpoolAssignments.set(color, new Set(printerSet));
  }
  
  // ============= V2-ONLY: PROJECT-CENTRIC ALGORITHM =============
  // LEGACY ALGORITHM HAS BEEN REMOVED - V2 is the Single Source of Truth
  // Feature flag kept for display purposes only (always returns true)
  const useProjectCentric = isFeatureEnabled('PLANNER_V2_PROJECT_CENTRIC');
  
  // ============= ALGORITHM LOG: Confirm V2-Only =============
  console.log('[Planning] 🧠 === ALGORITHM SELECTION ===');
  console.log('[Planning] 🧠 Active Algorithm: V2 (Project-Centric)');
  console.log('[Planning] 🧠 Legacy Algorithm: REMOVED');
  console.log('[Planning] 🧠 Feature Flag Value:', useProjectCentric);
  if (!useProjectCentric) {
    console.error('[Planning] ❌ CRITICAL: V2 flag is OFF but Legacy has been removed!');
    console.error('[Planning] ❌ Planning will proceed with V2 anyway (Single Source of Truth)');
  }
  console.log('[Planning] 🧠 ===========================');
  
  // ============= V2: PROJECT-CENTRIC ALGORITHM =============
  // Process projects in priority order, selecting minimum printers for each
  console.log('[PlannerV2] 🚀 Using Project-Centric algorithm');
  clearDecisionLog();
  
  // Track last project scheduled on each printer (for continuity scoring)
  const lastProjectByPrinter = new Map<string, string>();
  
  // Use effectiveStart as planning reference time
  const v2PlanningStartTime = new Date(effectiveStart);
  
  for (const projectState of workingStates) {
    if (projectState.remainingUnits <= 0) continue;
    
    // Select minimum printers for this project
    const selection = selectMinimumPrintersForDeadline(
      projectState,
      printerSlots,
      v2PlanningStartTime,
      settings,
      printers,
      lastProjectByPrinter,
      trackAdvanceReason
    );
    
    // ============= ACCEPTANCE LOG: Project Decision =============
    console.log('[PlannerV2] 📋 Project Decision:', {
      projectId: projectState.project.id,
      projectName: projectState.project.name,
      projectColor: projectState.project.color,
      deadline: projectState.project.dueDate,
      remainingUnits: projectState.remainingUnits,
      selectedPrinters: selection.selectedPrinterIds.map(id => {
        const slot = printerSlots.find(s => s.printerId === id);
        return slot?.printerName ?? id;
      }),
      estimatedFinish: selection.estimationResult.estimatedFinishTime?.toISOString() ?? 'N/A',
      meetsDeadline: selection.estimationResult.meetsDeadline,
      marginHours: selection.estimationResult.marginHours.toFixed(1),
      cyclesNeeded: selection.estimationResult.cycleCount,
    });
    
    // ============= ACCEPTANCE LOG: Per-printer details =============
    for (const printerScore of selection.printerScores) {
      console.log(`[PlannerV2] 📊 Printer "${printerScore.printerName}":`, {
        currentTime: printerScore.currentTime.toISOString(),
        effectiveAvailabilityTime: printerScore.effectiveAvailabilityTime.toISOString(),
        waitHours: printerScore.waitHours.toFixed(2),
        isNextDay: printerScore.isNextDay,
        scores: printerScore.scores,
        reasons: printerScore.reasons,
      });
    }
    
    // Log planning decision
    logPlanningDecision({
      timestamp: new Date(),
      projectId: projectState.project.id,
      projectName: projectState.project.name,
      projectColor: projectState.project.color,
      deadline: projectState.project.dueDate,
      remainingUnits: projectState.remainingUnits,
      estimationResults: {
        printersNeeded: selection.selectedPrinterIds.length,
        estimatedFinishTime: selection.estimationResult.estimatedFinishTime,
        meetsDeadline: selection.estimationResult.meetsDeadline,
        marginHours: selection.estimationResult.marginHours,
      },
      selectedPrinters: selection.printerScores,
      reasons: selection.printerScores.flatMap(p => p.reasons),
    });
    
    // Schedule cycles on selected printers
    if (selection.selectedPrinterIds.length > 0) {
      const scheduledCycles = scheduleProjectOnPrinters(
        projectState,
        printerSlots,
        selection.selectedPrinterIds,
        settings,
        printers,
        dateString,
        workingMaterial,
        workingSpoolAssignments,
        trackAdvanceReason
      );
      
      // Add cycles to printer slots
      for (const cycle of scheduledCycles) {
        const slot = printerSlots.find(s => s.printerId === cycle.printerId);
        if (slot) {
          // Cycle already added in scheduleProjectOnPrinters
          lastProjectByPrinter.set(slot.printerId, projectState.project.id);
        }
      }
      
      console.log(`[PlannerV2] ✅ Scheduled ${scheduledCycles.length} cycles for "${projectState.project.name}"`);
    }
  }
  
  // Filter completed projects
  workingStates = workingStates.filter(s => s.remainingUnits > 0);
  
  // ============= DEBUG: Night scheduling diagnostic =============
  if (settings.afterHoursBehavior === 'FULL_AUTOMATION') {
    const statesWithRemaining = workingStates.filter(s => s.remainingUnits > 0);
    console.log('[NightScheduling] End of scheduleCyclesForDay diagnostic:', {
      date: dateString,
      isAutonomousDay,
      printerSlots: printerSlots.map(slot => ({
        printer: slot.printerName,
        currentTime: slot.currentTime.toISOString(),
        endOfWorkHours: slot.endOfWorkHours.toISOString(),
        endOfDayTime: slot.endOfDayTime.toISOString(),
        cyclesScheduled: slot.cyclesScheduled.length,
        isInNightWindow: slot.currentTime >= slot.endOfWorkHours,
        hasTimeRemaining: slot.currentTime < slot.endOfDayTime,
      })),
      statesWithRemainingUnits: statesWithRemaining.length,
      remainingProjects: statesWithRemaining.map(s => ({
        name: s.project.name,
        remaining: s.remainingUnits,
        color: s.project.color,
      })),
      totalCyclesScheduled: printerSlots.reduce((sum, s) => sum + s.cyclesScheduled.length, 0),
    });
  }
  
  // Build day plan
  const printerPlans: PrinterDayPlan[] = printerSlots.map(slot => {
    const totalHours = slot.cyclesScheduled.reduce((sum, c) => {
      return sum + (c.endTime.getTime() - c.startTime.getTime()) / (1000 * 60 * 60);
    }, 0);
    const dayHours = getWorkingHoursForDay(schedule);
    
    return {
      printerId: slot.printerId,
      printerName: slot.printerName,
      cycles: slot.cyclesScheduled,
      totalUnits: slot.cyclesScheduled.reduce((sum, c) => sum + c.unitsPlanned, 0),
      totalHours,
      capacityUsedPercent: dayHours > 0 ? (totalHours / dayHours) * 100 : 0,
    };
  });
  
  const totalUnits = printerPlans.reduce((sum, p) => sum + p.totalUnits, 0);
  const totalCycles = printerPlans.reduce((sum, p) => sum + p.cycles.length, 0);
  const totalScheduledHours = printerPlans.reduce((sum, p) => sum + p.totalHours, 0);
  const totalDayCapacity = getWorkingHoursForDay(schedule) * printers.length;
  
  const dayPlan: DayPlan = {
    date,
    dateString,
    isWorkday: true,
    workStart: schedule.startTime,
    workEnd: schedule.endTime,
    printerPlans,
    totalUnits,
    totalCycles,
    unusedCapacityHours: Math.max(0, totalDayCapacity - totalScheduledHours),
  };
  
  return {
    dayPlan,
    updatedProjectStates: workingStates,
    updatedMaterialTracker: workingMaterial,
    updatedSpoolAssignments: workingSpoolAssignments,
  };
};

// ============= PHYSICAL PLATE LIMIT =============
// Post-processing step to limit consecutive "ready" cycles per printer
// for night/weekend operations based on physicalPlateCapacity

/**
 * Check if a cycle can start autonomously (without operator intervention)
 * Uses the exact same 3-level control as the main planning logic:
 * 1. Factory: afterHoursBehavior === 'FULL_AUTOMATION'
 * 2. Printer: canStartNewCyclesAfterHours === true
 * 3. Preset: allowedForNightCycle !== false
 * 
 * Additionally, the cycle must start after the workday ends.
 */
const canCycleRunAutonomously = (
  cycleStartTime: Date,
  printerId: string,
  presetId: string | undefined,
  printers: Printer[],
  settings: FactorySettings,
  products: Product[]
): boolean => {
  // Level 1: Factory must allow full automation
  if (settings.afterHoursBehavior !== 'FULL_AUTOMATION') {
    return false;
  }
  
  // Level 2: Printer must allow night starts
  const printer = printers.find(p => p.id === printerId);
  if (!printer?.canStartNewCyclesAfterHours) {
    return false;
  }
  
  // Level 3: Preset must allow night cycles (default true if not set)
  if (presetId) {
    // Find preset across all products
    for (const product of products) {
      const preset = product.platePresets.find(p => p.id === presetId);
      if (preset) {
        if (preset.allowedForNightCycle === false) {
          return false;
        }
        break;
      }
    }
  }
  
  // Check if the cycle starts after work hours
  const cycleDate = new Date(cycleStartTime);
  cycleDate.setHours(0, 0, 0, 0);
  const schedule = getDayScheduleForDate(cycleDate, settings, []);
  
  if (!schedule?.enabled) {
    // Non-working day - any cycle that passes the 3-level check is autonomous
    return true;
  }
  
  // Check if cycle starts after end of workday
  const [endHour, endMinute] = schedule.endTime.split(':').map(Number);
  const endOfDay = new Date(cycleStartTime);
  endOfDay.setHours(endHour, endMinute, 0, 0);
  
  return cycleStartTime >= endOfDay;
};

/**
 * Check if a cycle is within work hours (operator available to reload plates)
 */
const isCycleWithinWorkHours = (
  cycleStartTime: Date,
  settings: FactorySettings
): boolean => {
  const cycleDate = new Date(cycleStartTime);
  cycleDate.setHours(0, 0, 0, 0);
  const schedule = getDayScheduleForDate(cycleDate, settings, []);
  
  if (!schedule?.enabled) {
    // Non-working day - not within work hours
    return false;
  }
  
  const [startHour, startMinute] = schedule.startTime.split(':').map(Number);
  const [endHour, endMinute] = schedule.endTime.split(':').map(Number);
  
  const workStart = new Date(cycleStartTime);
  workStart.setHours(startHour, startMinute, 0, 0);
  
  const workEnd = new Date(cycleStartTime);
  workEnd.setHours(endHour, endMinute, 0, 0);
  
  return cycleStartTime >= workStart && cycleStartTime < workEnd;
};

const applyPhysicalPlateLimit = (
  cycles: PlannedCycle[],
  printers: Printer[],
  settings: FactorySettings
): void => {
  // Get products for preset lookup
  const products = getProducts();
  
  // Create lookup for printer capacity and names
  const printerCapacity = new Map<string, number>();
  const printerNames = new Map<string, string>();
  for (const printer of printers) {
    // Default to 999 (unlimited) if not set
    printerCapacity.set(printer.id, printer.physicalPlateCapacity ?? 999);
    printerNames.set(printer.id, printer.name);
  }
  
  // Group cycles by printer
  const cyclesByPrinter = new Map<string, PlannedCycle[]>();
  for (const cycle of cycles) {
    if (!cyclesByPrinter.has(cycle.printerId)) {
      cyclesByPrinter.set(cycle.printerId, []);
    }
    cyclesByPrinter.get(cycle.printerId)!.push(cycle);
  }
  
  // Process each printer
  for (const [printerId, printerCycles] of cyclesByPrinter) {
    // Sort by start time
    printerCycles.sort((a, b) => 
      new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    );
    
    const capacity = printerCapacity.get(printerId) ?? 999;
    const printerName = printerNames.get(printerId) ?? printerId;
    
    // Skip printers with unlimited capacity
    if (capacity >= 999) continue;
    
    // Count consecutive autonomous ready cycles
    let autonomousReadyCount = 0;
    
    for (const cycle of printerCycles) {
      const cycleStart = new Date(cycle.startTime);
      
      // Check if this cycle is within work hours - reset counter
      if (isCycleWithinWorkHours(cycleStart, settings)) {
        autonomousReadyCount = 0;
        continue;
      }
      
      // Check if this cycle can run autonomously using the 3-level policy
      const isAutonomous = canCycleRunAutonomously(
        cycleStart,
        cycle.printerId,
        cycle.presetId,
        printers,
        settings,
        products
      );
      
      // Only count cycles that are ready AND can run autonomously
      if (isAutonomous && cycle.readinessState === 'ready') {
        autonomousReadyCount++;
        
        if (autonomousReadyCount > capacity) {
          // Exceeded plate limit - mark as waiting_for_plate_reload
          cycle.readinessState = 'waiting_for_plate_reload';
          cycle.readinessDetails = `הגעת למגבלת ${capacity} פלטות פיזיות. נדרשת טעינה ידנית.`;
          
          // Log the block
          logCycleBlock({
            reason: 'plates_limit',
            projectId: cycle.projectId,
            printerId: cycle.printerId,
            printerName,
            presetId: cycle.presetId,
            presetName: cycle.presetName,
            details: `Cycle #${autonomousReadyCount} exceeds physical plate capacity of ${capacity}`,
            scheduledDate: cycleStart.toISOString().split('T')[0],
            cycleHours: (new Date(cycle.endTime).getTime() - cycleStart.getTime()) / (1000 * 60 * 60),
          });
        }
      }
      // Note: If not autonomous (policy blocks it), don't count toward plate limit
      // These cycles would be blocked by policy anyway
    }
  }
};

// ============= MAIN PLANNING FUNCTION =============

export interface PlanningOptions {
  startDate?: Date;
  daysToPlane?: number;
  scope?: 'from_now' | 'from_tomorrow' | 'whole_week';
  lockInProgress?: boolean;
}

export const generatePlan = (options: PlanningOptions = {}): PlanningResult => {
  // Reset advance counter at start of each planning run
  resetAdvanceCounter();
  
  const {
    startDate = new Date(),
    daysToPlane = 7,
    scope = 'from_now',
    lockInProgress = true,
  } = options;
  
  const settings = getFactorySettings();
  const printers = getActivePrinters();
  const allProjects = getActiveProjects();
  // Filter out projects that should not be included in planning
  const projects = allProjects.filter(p => p.includeInPlanning !== false);
  const products = getProducts();
  const spools = getSpools();
  const existingCycles = getPlannedCycles();
  
  const warnings: PlanningWarning[] = [];
  const blockingIssues: BlockingIssue[] = [];
  
  // Validate basic requirements
  if (!settings) {
    blockingIssues.push({
      type: 'no_printers',
      message: 'חסרות הגדרות מפעל',
      messageEn: 'Missing factory settings',
    });
    return createEmptyResult(blockingIssues, warnings);
  }
  
  if (printers.length === 0) {
    blockingIssues.push({
      type: 'no_printers',
      message: 'אין מדפסות פעילות',
      messageEn: 'No active printers',
    });
    return createEmptyResult(blockingIssues, warnings);
  }
  
  // Prioritize projects
  const projectStates = prioritizeProjects(projects, products, startDate, existingCycles);
  
  if (projectStates.length === 0) {
    // No projects to schedule - return empty but successful plan
    return {
      success: true,
      days: [],
      totalUnitsPlanned: 0,
      totalCyclesPlanned: 0,
      unusedCapacityHours: 0,
      warnings: [{
        type: 'capacity_unused',
        message: 'אין פרויקטים פעילים לתזמון',
        messageEn: 'No active projects to schedule',
        severity: 'info',
      }],
      blockingIssues: [],
      cycles: [],
      generatedAt: new Date().toISOString(),
    };
  }
  
  // Validate material constraints
  const materialIssues = validateMaterialConstraints(projectStates, spools);
  // Material issues are warnings, not blocking (can still plan partial)
  for (const issue of materialIssues) {
    warnings.push({
      type: 'material_low',
      message: issue.message,
      messageEn: issue.messageEn,
      severity: 'warn',
    });
  }
  
  // Validate time constraints
  const timeIssues = validateTimeConstraints(projectStates, settings, printers, startDate, daysToPlane);
  for (const issue of timeIssues) {
    warnings.push({
      type: 'deadline_risk',
      message: issue.message,
      messageEn: issue.messageEn,
      projectId: issue.projectId,
      severity: 'error',
    });
  }
  
  // Initialize material tracker from ColorInventory (not just spools)
  const materialTracker = new Map<string, number>();
  const colorInventory = getColorInventory();
  for (const item of colorInventory) {
    const colorKey = normalizeColor(item.color);
    const current = materialTracker.get(colorKey) || 0;
    materialTracker.set(colorKey, current + getTotalGrams(item));
  }
  
  // Also add any spools not in color inventory (backward compatibility)
  for (const spool of spools) {
    if (spool.state !== 'empty') {
      const colorKey = normalizeColor(spool.color);
      // Only add if not already tracked via ColorInventory
      if (!materialTracker.has(colorKey)) {
        const current = materialTracker.get(colorKey) || 0;
        materialTracker.set(colorKey, current + spool.gramsRemainingEst);
      }
    }
  }
  
  // Generate day-by-day plan
  const days: DayPlan[] = [];
  let workingProjectStates = [...projectStates];
  let workingMaterialTracker = new Map(materialTracker);
  
  // ============= ADVANCE REASONS TRACKER =============
  // Track why slots advance to next day - for debugging "holes" in schedule
  // Passed as closure through the function chain (no global state)
  const advanceReasonCounts = new Map<string, number>();
  const trackAdvanceReason: AdvanceReasonTracker = (reason: string) => {
    advanceReasonCounts.set(reason, (advanceReasonCounts.get(reason) || 0) + 1);
  };
  
  for (let dayOffset = 0; dayOffset < daysToPlane; dayOffset++) {
    // CRITICAL FIX: Reset spool assignments at the START of each day
    // This ensures sequential cycles on same printer are allowed
    // Spool-limit only restricts CONCURRENT usage across printers, not across time
    const workingSpoolAssignments = new Map<string, Set<string>>();
    const planDate = new Date(startDate);
    planDate.setDate(planDate.getDate() + dayOffset);
    planDate.setHours(0, 0, 0, 0);
    
    const schedule = getDayScheduleForDate(planDate, settings, []);
    
    // Check if this is a non-working day
    const isNonWorkingDay = !schedule || !schedule.enabled;
    
    
    // Determine if we should plan autonomously on non-working days
    const shouldPlanAutonomous = isNonWorkingDay && settings.afterHoursBehavior === 'FULL_AUTOMATION';
    
    if (isNonWorkingDay && !shouldPlanAutonomous) {
      // Non-working day with no FULL_AUTOMATION - skip
      days.push({
        date: planDate,
        dateString: formatDateString(planDate),
        isWorkday: false,
        workStart: '',
        workEnd: '',
        printerPlans: printers.map(p => ({
          printerId: p.id,
          printerName: p.name,
          cycles: [],
          totalUnits: 0,
          totalHours: 0,
          capacityUsedPercent: 0,
        })),
        totalUnits: 0,
        totalCycles: 0,
        unusedCapacityHours: 0,
      });
      continue;
    }
    
    // Create a synthetic schedule for autonomous days
    // For autonomous days, we create a 24h window but use existing schedule defaults for structure
    const effectiveSchedule: DaySchedule = isNonWorkingDay 
      ? { enabled: true, startTime: '00:00', endTime: '23:59' }
      : schedule!;
    
    console.log('[Plan] 📅 Planning day:', {
      date: formatDateString(planDate),
      isNonWorkingDay,
      shouldPlanAutonomous,
    });
    
    // Schedule cycles for this day
    // Pass spool assignment tracker to enforce 1 spool = 1 printer rule
    // Pass startDate as planningStartTime to prevent scheduling in the past
    const { dayPlan, updatedProjectStates, updatedMaterialTracker, updatedSpoolAssignments } = scheduleCyclesForDay(
      planDate,
      effectiveSchedule,
      printers,
      workingProjectStates,
      settings,
      workingMaterialTracker,
      existingCycles,
      workingSpoolAssignments,
      false,            // allowCrossMidnight
      startDate,        // planningStartTime - prevents scheduling before this time
      shouldPlanAutonomous,  // isAutonomousDay - indicates this is a non-working day with FULL_AUTOMATION
      trackAdvanceReason    // Pass the tracker through the chain
    );
    
    days.push(dayPlan);
    workingProjectStates = updatedProjectStates;
    workingMaterialTracker = updatedMaterialTracker;
    // NOTE: workingSpoolAssignments NOT carried over - reset fresh each day (line 709)
    
    
    // If all projects are scheduled, no need to continue
    if (workingProjectStates.length === 0) break;
  }
  
  // Check for unscheduled projects
  if (workingProjectStates.length > 0) {
    for (const state of workingProjectStates) {
      warnings.push({
        type: 'capacity_unused',
        message: `פרויקט "${state.project.name}" לא תוזמן במלואו: נותרו ${state.remainingUnits} יחידות`,
        messageEn: `Project "${state.project.name}" not fully scheduled: ${state.remainingUnits} units remaining`,
        projectId: state.project.id,
        severity: 'warn',
      });
    }
  }
  
  // Convert scheduled cycles to PlannedCycle format
  const allCycles: PlannedCycle[] = [];
  for (const day of days) {
    for (const printerPlan of day.printerPlans) {
      for (const cycle of printerPlan.cycles) {
        allCycles.push({
          id: cycle.id,
          projectId: cycle.projectId,
          printerId: cycle.printerId,
          unitsPlanned: cycle.unitsPlanned,
          gramsPlanned: cycle.gramsPlanned,
          plateType: cycle.plateType,
          startTime: cycle.startTime.toISOString(),
          endTime: cycle.endTime.toISOString(),
          shift: cycle.shift,
          status: 'planned',
          // New readiness fields per PRD
          readinessState: cycle.readinessState,
          readinessDetails: cycle.readinessDetails,
          requiredColor: cycle.requiredColor,
          requiredGrams: cycle.requiredGrams,
          suggestedSpoolId: cycle.suggestedSpoolIds?.[0],
          // Preset selection fields
          presetId: cycle.presetId,
          presetName: cycle.presetName,
          presetSelectionReason: cycle.presetSelectionReason,
          // Plate constraint fields
          plateIndex: cycle.plateIndex,
          plateReleaseTime: cycle.plateReleaseTime?.toISOString(),
        });
      }
    }
  }
  
  // ============= SAFETY NET: Deduplicate cycles by printerId + startTime =============
  // This prevents any edge case where the same cycle might be created twice
  const uniqueCycleKeys = new Set<string>();
  const deduplicatedCycles = allCycles.filter(cycle => {
    const key = `${cycle.printerId}_${cycle.startTime}`;
    if (uniqueCycleKeys.has(key)) {
      console.warn('[Plan] ⚠️ Duplicate cycle filtered:', key);
      return false;
    }
    uniqueCycleKeys.add(key);
    return true;
  });
  
  if (deduplicatedCycles.length < allCycles.length) {
    console.log('[Plan] 🔄 Deduplication removed', allCycles.length - deduplicatedCycles.length, 'duplicate cycles');
  }
  
  // ============= POST-PROCESSING: Apply Physical Plate Limit =============
  // Under feature flag PHYSICAL_PLATES_LIMIT, limit consecutive "ready" cycles
  // per printer during night/weekend to physicalPlateCapacity
  if (isFeatureEnabled('PHYSICAL_PLATES_LIMIT')) {
    applyPhysicalPlateLimit(deduplicatedCycles, printers, settings);
  }
  
  // Calculate totals (use deduplicated cycles)
  const totalUnitsPlanned = deduplicatedCycles.reduce((sum, c) => sum + c.unitsPlanned, 0);
  const totalCyclesPlanned = deduplicatedCycles.length;
  const unusedCapacityHours = days.reduce((sum, d) => sum + d.unusedCapacityHours, 0);
  
  // ============= DEBUG LOG: Planning summary =============
  const cyclesByPrinter = new Map<string, number>();
  const skippedReasons = new Map<string, number>();
  
  for (const cycle of deduplicatedCycles) {
    cyclesByPrinter.set(cycle.printerId, (cyclesByPrinter.get(cycle.printerId) || 0) + 1);
  }
  
  // Count unscheduled projects
  const unscheduledCount = workingProjectStates.filter(s => s.remainingUnits > 0).length;
  for (const state of workingProjectStates.filter(s => s.remainingUnits > 0)) {
    const reason = `project_${state.project.name}_remaining_${state.remainingUnits}`;
    skippedReasons.set(reason, 1);
  }
  
  // Group cycles by day to see plate usage pattern
  const cyclesByDay = new Map<string, number>();
  for (const cycle of deduplicatedCycles) {
    const dayStr = cycle.startTime.split('T')[0];
    cyclesByDay.set(dayStr, (cyclesByDay.get(dayStr) || 0) + 1);
  }
  
  // ============= PLATE CONSTRAINT DEBUG: Per-printer plate timeline =============
  const plateDebugByPrinter = new Map<string, { cycles: Array<{ plateIndex: number; start: string; end: string; releaseTime: string; color: string }> }>();
  for (const cycle of deduplicatedCycles) {
    if (!plateDebugByPrinter.has(cycle.printerId)) {
      plateDebugByPrinter.set(cycle.printerId, { cycles: [] });
    }
    plateDebugByPrinter.get(cycle.printerId)!.cycles.push({
      plateIndex: cycle.plateIndex ?? 0,
      start: cycle.startTime,
      end: cycle.endTime,
      releaseTime: cycle.plateReleaseTime ?? 'N/A',
      color: cycle.requiredColor ?? 'unknown',
    });
  }
  
  console.log('[Plan] 📊 Planning Summary:', {
    printerSlots: printers.map(p => p.id),
    printerSlotsCount: printers.length,
    assignedByPrinter: Object.fromEntries(cyclesByPrinter),
    cyclesByDay: Object.fromEntries(cyclesByDay),
    totalCyclesPlanned,
    unscheduledProjects: unscheduledCount,
    skippedReasons: Object.fromEntries(skippedReasons),
    readinessBreakdown: {
      ready: deduplicatedCycles.filter(c => c.readinessState === 'ready').length,
      waiting_for_spool: deduplicatedCycles.filter(c => c.readinessState === 'waiting_for_spool').length,
      blocked_inventory: deduplicatedCycles.filter(c => c.readinessState === 'blocked_inventory').length,
      waiting_for_plate_reload: deduplicatedCycles.filter(c => c.readinessState === 'waiting_for_plate_reload').length,
    },
    plateConstraintInfo: {
      physicalPlateCapacity: printers.map(p => ({ id: p.id, name: p.name, capacity: p.physicalPlateCapacity ?? 4 })),
      plateUsageByPrinter: Object.fromEntries(
        Array.from(plateDebugByPrinter.entries()).map(([pid, data]) => [
          printers.find(p => p.id === pid)?.name ?? pid,
          data.cycles.map(c => `P${c.plateIndex}: ${c.start.split('T')[1]?.substring(0, 5) ?? c.start}-${c.end.split('T')[1]?.substring(0, 5) ?? c.end} (${c.color})`)
        ])
      ),
      note: 'Plates recycle during work hours after 10min cleanup. Outside work hours: no cleanup, max 4 cycles until next work day.',
    }
  });
  
  // ============= ADVANCE REASONS SUMMARY =============
  // Top-3 reasons why slots advanced to next day (causing "holes")
  const sortedReasons = Array.from(advanceReasonCounts.entries())
    .sort((a, b) => b[1] - a[1]);
  
  if (sortedReasons.length > 0) {
    console.log('[Plan] 🔍 Advance Reasons Summary (why slots jumped to next day):', {
      total: sortedReasons.reduce((sum, [, count]) => sum + count, 0),
      top3: sortedReasons.slice(0, 3).map(([reason, count]) => ({ reason, count })),
      all: Object.fromEntries(sortedReasons),
    });
  }
  
  // ============= NIGHT ALLOCATION REPORT =============
  // Show eligibleDemand/allocated/lockedColor/hasAMS per printer + blocked reasons summary
  // A cycle is "night" if it starts after the work hours end for that day
  const nightCycles = deduplicatedCycles.filter(c => {
    const cycleStart = new Date(c.startTime);
    // Get the schedule for the cycle's day
    const cycleDate = new Date(cycleStart);
    cycleDate.setHours(0, 0, 0, 0);
    const schedule = getDayScheduleForDate(cycleDate, settings, []);
    if (!schedule?.enabled) return true; // Non-working day = night
    // Parse end time
    const [endHour, endMinute] = schedule.endTime.split(':').map(Number);
    const endOfWork = new Date(cycleStart);
    endOfWork.setHours(endHour, endMinute, 0, 0);
    return cycleStart >= endOfWork;
  });
  
  // Build per-printer night allocation summary
  const printerNightAllocation = new Map<string, {
    name: string;
    eligibleDemand: number;
    allocated: number;
    physicalLockedColor: string;
    hasAMS: boolean;
    physicalPlateCapacity: number;
  }>();
  
  // Initialize with all printers
  for (const printer of printers) {
    printerNightAllocation.set(printer.id, {
      name: printer.name,
      eligibleDemand: printer.physicalPlateCapacity ?? 4, // Max possible = plate capacity
      allocated: 0,
      physicalLockedColor: printer.currentColor ?? printer.mountedColor ?? 'UNKNOWN',
      hasAMS: printer.hasAMS ?? false,
      physicalPlateCapacity: printer.physicalPlateCapacity ?? 4,
    });
  }
  
  // Count allocated night cycles per printer
  for (const cycle of nightCycles) {
    const alloc = printerNightAllocation.get(cycle.printerId);
    if (alloc) {
      alloc.allocated++;
    }
  }
  
  // Get blocked reasons summary from cycle block logger
  const blockSummary = getBlockSummary();
  const nightBlockedReasons = {
    no_physical_color_night: blockSummary.byReason.no_physical_color_night || 0,
    color_lock_night: blockSummary.byReason.color_lock_night || 0,
    no_night_preset: blockSummary.byReason.no_night_preset || 0,
    after_hours_policy: blockSummary.byReason.after_hours_policy || 0,
    plates_limit: blockSummary.byReason.plates_limit || 0,
    cycle_too_long_night: blockSummary.byReason.cycle_too_long_night || 0,
  };
  
  const totalNightBlocked = Object.values(nightBlockedReasons).reduce((a, b) => a + b, 0);
  const totalNightAllocated = Array.from(printerNightAllocation.values()).reduce((sum, p) => sum + p.allocated, 0);
  const totalNightCapacity = Array.from(printerNightAllocation.values()).reduce((sum, p) => sum + p.physicalPlateCapacity, 0);
  
  console.log('[Plan] 🌙 === NIGHT ALLOCATION REPORT ===');
  console.log('[Plan] 📊 Per-printer summary:', 
    Object.fromEntries(
      Array.from(printerNightAllocation.entries()).map(([id, data]) => [
        data.name,
        {
          eligibleDemand: data.eligibleDemand,
          allocated: data.allocated,
          physicalLockedColor: data.physicalLockedColor,
          hasAMS: data.hasAMS,
          utilizationPct: Math.round((data.allocated / data.eligibleDemand) * 100),
        }
      ])
    )
  );
  
  console.log('[Plan] 📊 Blocked reasons summary:', {
    totalBlocked: totalNightBlocked,
    breakdown: nightBlockedReasons,
  });
  
  console.log('[Plan] 📊 Night allocation totals:', {
    totalNightCapacity,
    totalNightAllocated,
    utilizationPct: totalNightCapacity > 0 ? Math.round((totalNightAllocated / totalNightCapacity) * 100) : 0,
    explanation: totalNightAllocated < totalNightCapacity 
      ? `Only ${totalNightAllocated}/${totalNightCapacity} plates utilized. Check blocked reasons above.`
      : 'Full night capacity utilized!',
  });

  
  return {
    success: blockingIssues.length === 0,
    days,
    totalUnitsPlanned,
    totalCyclesPlanned,
    unusedCapacityHours,
    warnings,
    blockingIssues,
    cycles: deduplicatedCycles,
    generatedAt: new Date().toISOString(),
  };
};

const createEmptyResult = (blockingIssues: BlockingIssue[], warnings: PlanningWarning[]): PlanningResult => ({
  success: false,
  days: [],
  totalUnitsPlanned: 0,
  totalCyclesPlanned: 0,
  unusedCapacityHours: 0,
  warnings,
  blockingIssues,
  cycles: [],
  generatedAt: new Date().toISOString(),
});

// ============= SINGLE DAY RECALCULATION =============

export const recalculateSingleDay = (date: Date): PlanningResult => {
  return generatePlan({
    startDate: date,
    daysToPlane: 1,
    scope: 'from_now',
    lockInProgress: true,
  });
};

// ============= PLAN VALIDATION =============

export interface PlanValidation {
  isValid: boolean;
  issues: string[];
  issuesEn: string[];
}

export const validateExistingPlan = (): PlanValidation => {
  const cycles = getPlannedCycles();
  const projects = getActiveProjects();
  const printers = getActivePrinters();
  const settings = getFactorySettings();
  
  const issues: string[] = [];
  const issuesEn: string[] = [];
  
  if (!settings) {
    issues.push('חסרות הגדרות מפעל');
    issuesEn.push('Missing factory settings');
    return { isValid: false, issues, issuesEn };
  }
  
  // Check for overlapping cycles per printer
  const printerCycles = new Map<string, PlannedCycle[]>();
  for (const cycle of cycles) {
    if (cycle.status === 'completed' || cycle.status === 'failed') continue;
    
    const existing = printerCycles.get(cycle.printerId) || [];
    existing.push(cycle);
    printerCycles.set(cycle.printerId, existing);
  }
  
  for (const [printerId, printerCycleList] of printerCycles) {
    printerCycleList.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    
    for (let i = 1; i < printerCycleList.length; i++) {
      const prev = printerCycleList[i - 1];
      const curr = printerCycleList[i];
      
      if (new Date(curr.startTime) < new Date(prev.endTime)) {
        const printer = printers.find(p => p.id === printerId);
        issues.push(`מחזורים חופפים במדפסת ${printer?.name || printerId}`);
        issuesEn.push(`Overlapping cycles on printer ${printer?.name || printerId}`);
      }
    }
  }
  
  // Check for cycles on non-working days (but allow with FULL_AUTOMATION)
  for (const cycle of cycles) {
    if (cycle.status === 'completed' || cycle.status === 'failed') continue;
    
    const cycleDate = new Date(cycle.startTime);
    const schedule = getDayScheduleForDate(cycleDate, settings, []);
    
    // Allow non-working day cycles if FULL_AUTOMATION is enabled
    if (!schedule || !schedule.enabled) {
      if (settings.afterHoursBehavior !== 'FULL_AUTOMATION') {
        issues.push(`מחזור מתוכנן ביום לא פעיל: ${cycleDate.toLocaleDateString('he-IL')}`);
        issuesEn.push(`Cycle scheduled on non-working day: ${cycleDate.toLocaleDateString('en-US')}`);
      }
    }
  }
  
  // Check for orphaned cycles (project no longer exists or completed)
  const projectIds = new Set(projects.map(p => p.id));
  for (const cycle of cycles) {
    if (cycle.status === 'completed' || cycle.status === 'failed') continue;
    
    if (!projectIds.has(cycle.projectId)) {
      issues.push(`מחזור מתוכנן לפרויקט שלא קיים`);
      issuesEn.push(`Cycle scheduled for non-existent project`);
    }
  }
  
  return {
    isValid: issues.length === 0,
    issues,
    issuesEn,
  };
};

// ============= DEADLINE GUARD: Impact Check for New Projects =============

export interface DeadlineImpactResult {
  safe: boolean;
  affectedProjects: {
    projectId: string;
    projectName: string;
    currentSlack: number;      // Current margin in hours
    newSlack: number;          // Margin after adding new project
    wouldMissDeadline: boolean;
    slackDropped: boolean;     // Dropped below threshold (4 hours)
  }[];
  summary: string;
  summaryHe: string;
}

/**
 * Check if adding a new project would impact existing deadlines.
 * Runs a "dry run" plan comparison: before vs after adding the project.
 * 
 * @param newProject - The project about to be created (not yet saved)
 * @returns DeadlineImpactResult with affected projects and recommendations
 */
export const checkDeadlineImpact = (
  newProject: Omit<Project, 'id' | 'createdAt' | 'quantityGood' | 'quantityScrap'>
): DeadlineImpactResult => {
  const SLACK_THRESHOLD_HOURS = 4; // Alert if margin drops below this
  
  console.log('[DeadlineGuard] Starting impact check for:', newProject.name);
  
  // Get current state
  const existingProjects = getActiveProjects();
  const products = getProducts();
  const settings = getFactorySettings();
  
  if (!settings) {
    return {
      safe: true,
      affectedProjects: [],
      summary: 'Cannot check - no factory settings',
      summaryHe: 'לא ניתן לבדוק - אין הגדרות מפעל',
    };
  }
  
  // Plan 1: Current state (without new project)
  const planBefore = generatePlan({
    startDate: new Date(),
    daysToPlane: 14,
    scope: 'from_now',
    lockInProgress: true,
  });
  
  // Calculate slack for each project in current plan
  const slackBefore = new Map<string, number>();
  for (const project of existingProjects) {
    if (!project.dueDate || project.status === 'completed') continue;
    
    // Find last cycle for this project
    const projectCycles = planBefore.cycles
      .filter(c => c.projectId === project.id)
      .sort((a, b) => new Date(b.endTime).getTime() - new Date(a.endTime).getTime());
    
    if (projectCycles.length > 0) {
      const lastCycleEnd = new Date(projectCycles[0].endTime);
      const deadline = new Date(project.dueDate);
      const slackHours = (deadline.getTime() - lastCycleEnd.getTime()) / (1000 * 60 * 60);
      slackBefore.set(project.id, slackHours);
    } else {
      // No cycles planned - project might be blocked or not enough capacity
      slackBefore.set(project.id, -999); // Will be compared later
    }
  }
  
  // Create temporary project for simulation
  const tempProject: Project = {
    ...newProject,
    id: 'temp-deadline-check-' + Date.now(),
    createdAt: new Date().toISOString().split('T')[0],
    quantityGood: 0,
    quantityScrap: 0,
  } as Project;
  
  // Temporarily add project to list for planning
  const projectsWithNew = [...existingProjects, tempProject];
  
  // Plan 2: With new project (dry run - we pass projects directly)
  // Since generatePlan uses getActiveProjects(), we need a different approach:
  // We'll calculate what cycles the new project would need and simulate impact
  
  const planAfter = generatePlan({
    startDate: new Date(),
    daysToPlane: 14,
    scope: 'from_now',
    lockInProgress: true,
    // Note: This will NOT include the temp project since it's not in storage
    // So we calculate impact differently - by checking if existing projects' cycles shift
  });
  
  // For now, use a simpler approach: check if adding cycles for new project
  // would push existing projects beyond their deadlines
  const product = products.find(p => p.id === newProject.productId);
  const preset = product?.platePresets?.[0];
  
  if (!product || !preset) {
    return {
      safe: true,
      affectedProjects: [],
      summary: 'Cannot estimate - no product/preset',
      summaryHe: 'לא ניתן להעריך - אין מוצר/פריסט',
    };
  }
  
  // Calculate how many cycles the new project needs
  const newProjectCyclesNeeded = Math.ceil(newProject.quantityTarget / preset.unitsPerPlate);
  const newProjectHoursNeeded = newProjectCyclesNeeded * preset.cycleHours;
  
  console.log('[DeadlineGuard] New project requires:', {
    cycles: newProjectCyclesNeeded,
    hours: newProjectHoursNeeded,
    deadline: newProject.dueDate,
  });
  
  // Check each existing project
  const affectedProjects: DeadlineImpactResult['affectedProjects'] = [];
  
  for (const project of existingProjects) {
    if (!project.dueDate || project.status === 'completed') continue;
    
    const currentSlack = slackBefore.get(project.id) ?? 0;
    
    // If new project has earlier/same deadline, it might push this project later
    const newDeadline = new Date(newProject.dueDate);
    const existingDeadline = new Date(project.dueDate);
    
    // Simple heuristic: if new project deadline is before or same as existing,
    // and they share the same color (competing for printers), estimate impact
    const sameColor = normalizeColor(newProject.color) === normalizeColor(project.color);
    const newIsMoreUrgent = newDeadline <= existingDeadline;
    
    let estimatedSlackLoss = 0;
    if (sameColor && newIsMoreUrgent) {
      // New project likely takes printer time from this project
      // Rough estimate: proportional to hours needed
      estimatedSlackLoss = newProjectHoursNeeded * 0.5; // Conservative estimate
    } else if (newIsMoreUrgent) {
      // Different color but still competes for capacity
      estimatedSlackLoss = newProjectHoursNeeded * 0.2;
    }
    
    const newSlack = currentSlack - estimatedSlackLoss;
    const wouldMissDeadline = currentSlack > 0 && newSlack < 0;
    const slackDropped = currentSlack >= SLACK_THRESHOLD_HOURS && newSlack < SLACK_THRESHOLD_HOURS;
    
    if (wouldMissDeadline || slackDropped) {
      affectedProjects.push({
        projectId: project.id,
        projectName: project.name,
        currentSlack: Math.round(currentSlack * 10) / 10,
        newSlack: Math.round(newSlack * 10) / 10,
        wouldMissDeadline,
        slackDropped,
      });
    }
  }
  
  const safe = affectedProjects.filter(p => p.wouldMissDeadline).length === 0;
  
  const summary = affectedProjects.length === 0
    ? 'No deadline impact detected'
    : `${affectedProjects.filter(p => p.wouldMissDeadline).length} project(s) may miss deadline`;
  
  const summaryHe = affectedProjects.length === 0
    ? 'לא זוהתה פגיעה בדדליינים'
    : `${affectedProjects.filter(p => p.wouldMissDeadline).length} פרויקט(ים) עלולים לפספס דדליין`;
  
  console.log('[DeadlineGuard] Impact check result:', {
    safe,
    affectedCount: affectedProjects.length,
    affectedProjects: affectedProjects.map(p => ({
      name: p.projectName,
      currentSlack: p.currentSlack,
      newSlack: p.newSlack,
      wouldMiss: p.wouldMissDeadline,
    })),
  });
  
  return {
    safe,
    affectedProjects,
    summary,
    summaryHe,
  };
};

// ============= IDLE PRINTER DIAGNOSTIC REPORT =============

export type IdlePrinterReason = 
  | 'NO_WORK'           // No more work to schedule
  | 'NO_PLATES'         // All plates in use (night constraint)
  | 'COLOR_MISMATCH'    // Only different-color projects remain
  | 'AFTER_HOURS_BLOCK' // Printer not allowed for after-hours
  | 'MATERIAL_SHORTAGE' // Not enough material on spool
  | 'FILLED';           // Successfully filled

export interface IdlePrinterReport {
  printerId: string;
  printerName: string;
  freeWindowHours: number;
  reason: IdlePrinterReason;
  details: string;
  potentialCycles: number; // How many cycles could fit in the free window
  currentColor?: string;
}

/**
 * Generate diagnostic report for idle printers after V2 planning.
 * Does NOT modify any scheduling - purely diagnostic logging.
 */
export const generateIdlePrinterReport = (planResult: PlanningResult): IdlePrinterReport[] => {
  const printers = getActivePrinters();
  const settings = getFactorySettings();
  const projects = getActiveProjects();
  const products = getProducts();
  
  if (!settings) return [];
  
  const report: IdlePrinterReport[] = [];
  const today = new Date();
  const todaySchedule = getDayScheduleForDate(today, settings, []);
  
  if (!todaySchedule?.enabled) {
    console.log('[IdlePrinterReport] Today is not a workday, skipping report');
    return [];
  }
  
  const workEndTime = createDateWithTime(today, todaySchedule.endTime);
  const now = new Date();
  
  // For each printer, calculate free window for tonight
  for (const printer of printers) {
    const printerCycles = planResult.cycles
      .filter(c => c.printerId === printer.id)
      .filter(c => {
        const cycleDate = new Date(c.startTime);
        return formatDateString(cycleDate) === formatDateString(today);
      })
      .sort((a, b) => new Date(b.endTime).getTime() - new Date(a.endTime).getTime());
    
    // Find when this printer is free
    let freeFrom: Date;
    let currentColor: string | undefined;
    
    if (printerCycles.length > 0) {
      const lastCycle = printerCycles[0];
      freeFrom = new Date(lastCycle.endTime);
      currentColor = lastCycle.requiredColor;
    } else {
      freeFrom = now;
    }
    
    // Calculate free window until end of day (or end of extended hours)
    // If FULL_AUTOMATION, printers can work until next workday
    let effectiveEndTime = workEndTime;
    
    if (settings.afterHoursBehavior === 'FULL_AUTOMATION' && printer.canStartNewCyclesAfterHours) {
      // Can work overnight - calculate until next day start
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowSchedule = getDayScheduleForDate(tomorrow, settings, []);
      if (tomorrowSchedule?.enabled) {
        effectiveEndTime = createDateWithTime(tomorrow, tomorrowSchedule.startTime);
      } else {
        // Weekend - extend to Monday
        effectiveEndTime = new Date(workEndTime);
        effectiveEndTime.setHours(23, 59, 59); // End of today at minimum
      }
    }
    
    const freeWindowMs = Math.max(0, effectiveEndTime.getTime() - freeFrom.getTime());
    const freeWindowHours = freeWindowMs / (1000 * 60 * 60);
    
    // Determine why printer is idle
    let reason: IdlePrinterReason = 'FILLED';
    let details = '';
    let potentialCycles = 0;
    
    if (freeWindowHours < 1) {
      // Less than 1 hour free - effectively filled
      reason = 'FILLED';
      details = 'פחות משעה פנויה';
    } else {
      // Has free window - check why not filled
      const platesUsed = printerCycles.length;
      const platesAvailable = (printer.physicalPlateCapacity ?? 4) - platesUsed;
      
      // Check after-hours permission
      if (freeFrom >= workEndTime && !printer.canStartNewCyclesAfterHours) {
        reason = 'AFTER_HOURS_BLOCK';
        details = `מדפסת לא מורשית לעבודת לילה`;
        potentialCycles = 0;
      } else if (platesAvailable <= 0) {
        reason = 'NO_PLATES';
        details = `כל ${printer.physicalPlateCapacity ?? 4} הפלטות בשימוש`;
        potentialCycles = 0;
      } else {
        // Find remaining work
        const remainingProjects = projects.filter(p => {
          if (p.status === 'completed') return false;
          const remaining = p.quantityTarget - p.quantityGood;
          return remaining > 0 && p.includeInPlanning;
        });
        
        if (remainingProjects.length === 0) {
          reason = 'NO_WORK';
          details = 'אין עבודה נוספת לתזמן';
          potentialCycles = 0;
        } else {
          // Check if any project matches current color
          const sameColorProjects = remainingProjects.filter(p => 
            normalizeColor(p.color) === normalizeColor(currentColor || '')
          );
          
          if (currentColor && sameColorProjects.length === 0) {
            reason = 'COLOR_MISMATCH';
            details = `צבע נוכחי: ${currentColor}, פרויקטים שנותרו: ${remainingProjects.map(p => p.color).join(', ')}`;
            // Estimate how many cycles could fit
            const avgCycleHours = 2;
            potentialCycles = Math.min(platesAvailable, Math.floor(freeWindowHours / avgCycleHours));
          } else {
            // There IS work in same color but wasn't scheduled - might be V2's "minimum printer" behavior
            reason = 'NO_WORK'; // Actually "NOT_SCHEDULED_DUE_TO_V2"
            details = `V2 לא שיבץ - ${sameColorProjects.length} פרויקטים באותו צבע זמינים`;
            const avgCycleHours = 2;
            potentialCycles = Math.min(platesAvailable, Math.floor(freeWindowHours / avgCycleHours));
          }
        }
      }
    }
    
    report.push({
      printerId: printer.id,
      printerName: printer.name,
      freeWindowHours: Math.round(freeWindowHours * 10) / 10,
      reason,
      details,
      potentialCycles,
      currentColor,
    });
  }
  
  // Log the report
  console.log('[IdlePrinterReport] 📊 Idle Printer Diagnostic:');
  console.table(report.map(r => ({
    'מדפסת': r.printerName,
    'שעות פנויות': r.freeWindowHours,
    'סיבה': r.reason,
    'פרטים': r.details,
    'מחזורים פוטנציאליים': r.potentialCycles,
    'צבע נוכחי': r.currentColor || '-',
  })));
  
  // Summary
  const filledCount = report.filter(r => r.reason === 'FILLED').length;
  const idleCount = report.filter(r => r.reason !== 'FILLED').length;
  const totalPotentialCycles = report.reduce((sum, r) => sum + r.potentialCycles, 0);
  
  console.log('[IdlePrinterReport] Summary:', {
    totalPrinters: report.length,
    filled: filledCount,
    idle: idleCount,
    potentialCyclesLost: totalPotentialCycles,
    idleReasons: {
      NO_WORK: report.filter(r => r.reason === 'NO_WORK').length,
      NO_PLATES: report.filter(r => r.reason === 'NO_PLATES').length,
      COLOR_MISMATCH: report.filter(r => r.reason === 'COLOR_MISMATCH').length,
      AFTER_HOURS_BLOCK: report.filter(r => r.reason === 'AFTER_HOURS_BLOCK').length,
    },
  });
  
  return report;
};

export interface CapacityInfo {
  totalHoursAvailable: number;
  totalHoursScheduled: number;
  utilizationPercent: number;
  unitsCapacity: number;
  unitsScheduled: number;
}

export const calculateWeekCapacity = (startDate: Date = new Date()): CapacityInfo => {
  const settings = getFactorySettings();
  const printers = getActivePrinters();
  const cycles = getPlannedCycles();
  
  if (!settings || printers.length === 0) {
    return {
      totalHoursAvailable: 0,
      totalHoursScheduled: 0,
      utilizationPercent: 0,
      unitsCapacity: 0,
      unitsScheduled: 0,
    };
  }
  
  let totalHoursAvailable = 0;
  let totalHoursScheduled = 0;
  let unitsScheduled = 0;
  
  for (let i = 0; i < 7; i++) {
    const checkDate = new Date(startDate);
    checkDate.setDate(checkDate.getDate() + i);
    
    const schedule = getDayScheduleForDate(checkDate, settings, []);
    const dayHours = getWorkingHoursForDay(schedule);
    totalHoursAvailable += dayHours * printers.length;
    
    // Count scheduled cycles for this day
    const dateString = formatDateString(checkDate);
    const dayCycles = cycles.filter(c => {
      const cycleDate = formatDateString(new Date(c.startTime));
      return cycleDate === dateString && c.status !== 'completed' && c.status !== 'failed';
    });
    
    for (const cycle of dayCycles) {
      const start = new Date(cycle.startTime);
      const end = new Date(cycle.endTime);
      totalHoursScheduled += (end.getTime() - start.getTime()) / (1000 * 60 * 60);
      unitsScheduled += cycle.unitsPlanned;
    }
  }
  
  // Estimate units capacity (assuming 8 units/cycle and 2h/cycle average)
  const avgCycleHours = 2;
  const avgUnitsPerCycle = 8;
  const unitsCapacity = Math.floor(totalHoursAvailable / avgCycleHours) * avgUnitsPerCycle;
  
  return {
    totalHoursAvailable,
    totalHoursScheduled,
    utilizationPercent: totalHoursAvailable > 0 ? (totalHoursScheduled / totalHoursAvailable) * 100 : 0,
    unitsCapacity,
    unitsScheduled,
  };
};
