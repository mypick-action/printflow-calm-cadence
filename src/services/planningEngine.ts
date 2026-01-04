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
import { logCycleBlock } from './cycleBlockLogger';
import { isFeatureEnabled } from './featureFlags';

// ============= TYPES =============

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
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
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

interface PlateReleaseInfo {
  releaseTime: Date;  // When this plate becomes available again
  cycleId: string;    // Which cycle is using this plate
}

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
  lastScheduledColor?: string;    // For non-AMS printers: locked color after hours
  hasAMS: boolean;                // Cache of printer.hasAMS
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
  isAutonomousDay: boolean = false // true for non-working days with FULL_AUTOMATION
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
    // NEW MODEL: Plates are a parallel resource (capacity = 4)
    // - During work hours: plates recycle after cycle ends + 10min cleanup
    // - Outside work hours: plates don't recycle, hard stop after capacity exhausted
    // Default to 4 if not set, or if set to 999 (legacy "unlimited")
    const rawCapacity = p.physicalPlateCapacity ?? 4;
    const plateCapacity = rawCapacity >= 999 ? 4 : rawCapacity; // Treat 999 as "use default 4"
    
    // Initialize plates in use from locked cycles
    // Each locked cycle "holds" a plate until its end time + cleanup delay
    const lockedCyclesForPrinter = lockedCyclesForDay.filter(c => c.printerId === p.id);
    const PLATE_CLEANUP_MINUTES = 10;
    const platesInUse: PlateReleaseInfo[] = lockedCyclesForPrinter.map(c => ({
      releaseTime: new Date(new Date(c.endTime).getTime() + PLATE_CLEANUP_MINUTES * 60_000),
      cycleId: c.id,
    }));
    
    // Get the last scheduled color from locked cycles (for non-AMS color lock)
    const lastLockedCycle = lockedCyclesForPrinter
      .sort((a, b) => new Date(b.endTime).getTime() - new Date(a.endTime).getTime())[0];
    const lastScheduledColor = lastLockedCycle?.requiredColor;
    
    return {
      printerId: p.id,
      printerName: p.name,
      currentTime: new Date(startTime),
      endOfDayTime: new Date(dayEnd),
      endOfWorkHours: new Date(endOfRegularWorkday),
      workDayStart: new Date(dayStart),
      cyclesScheduled: [],
      // Plate constraint fields
      physicalPlateCapacity: plateCapacity,
      platesInUse,
      lastScheduledColor,
      hasAMS: p.hasAMS ?? false,
    };
  });
  
  dbgStart('SlotsStartTimes', printerSlots.map(s => ({
    printer: s.printerName,
    printerId: s.printerId,
    slotStart: s.currentTime.toISOString(),
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
  
  // ============= ROUND-ROBIN SCHEDULING ALGORITHM =============
  // Distribute cycles across ALL printers evenly, not greedy per-printer
  // Each iteration: try to schedule ONE cycle on EACH printer, then repeat
  // This ensures all 10 printers get work, not just the first one
  
  let moreToSchedule = true;
  let iterationCount = 0;
  const maxIterations = 1000; // Safety limit
  
  while (moreToSchedule && iterationCount < maxIterations) {
    iterationCount++;
    moreToSchedule = false;
    
    // Round-robin: try to schedule ONE cycle on EACH printer per iteration
    for (const slot of printerSlots) {
      // Check if this printer still has time available
      if (slot.currentTime >= slot.endOfDayTime) continue;
      
      // ============= PLATE CONSTRAINT CHECK =============
      // NEW MODEL: Plates recycle during work hours, but NOT outside
      // - Release plates that have finished recycling (during work hours only)
      // - Check if all plates are in use
      // - If no plates available outside work hours: advance to next work day start
      
      const PLATE_CLEANUP_MINUTES = 10;
      const isWithinWorkHours = slot.currentTime >= slot.workDayStart && slot.currentTime < slot.endOfWorkHours;
      
      // During work hours: release plates whose cleanup time has passed
      if (isWithinWorkHours) {
        slot.platesInUse = slot.platesInUse.filter(p => p.releaseTime > slot.currentTime);
      }
      // Outside work hours: plates are never released (no cleanup possible)
      
      const platesAvailable = slot.physicalPlateCapacity - slot.platesInUse.length;
      
      if (platesAvailable <= 0) {
        // All plates in use - check if we can wait for one to be released
        if (isWithinWorkHours) {
          // During work hours: wait for nearest plate release
          const nearestRelease = slot.platesInUse
            .map(p => p.releaseTime.getTime())
            .sort((a, b) => a - b)[0];
          
          if (nearestRelease && nearestRelease < slot.endOfWorkHours.getTime()) {
            console.log('[PlateConstraint] ⏳ Waiting for plate cleanup during work hours:', {
              printer: slot.printerName,
              currentTime: slot.currentTime.toISOString(),
              nearestRelease: new Date(nearestRelease).toISOString(),
            });
            slot.currentTime = new Date(nearestRelease);
            // Re-release plates after advancing time
            slot.platesInUse = slot.platesInUse.filter(p => p.releaseTime > slot.currentTime);
            // Continue with scheduling attempt (don't skip)
          } else {
            // Work hours end before plate releases - advance to next day
            const nextWorkDayStart = findNextWorkDayStart(date, settings, 7);
            console.log('[PlateConstraint] 🛑 No plate release before work ends:', {
              printer: slot.printerName,
              currentTime: slot.currentTime.toISOString(),
              endOfWorkHours: slot.endOfWorkHours.toISOString(),
              nextWorkDayStart: nextWorkDayStart?.toISOString(),
            });
            slot.currentTime = new Date(slot.endOfDayTime); // Mark exhausted for this day
            continue;
          }
        } else {
          // Outside work hours: no plate cleanup possible
          // Advance to next work day start
          const nextWorkDayStart = findNextWorkDayStart(date, settings, 7);
          
          if (nextWorkDayStart) {
            console.log('[PlateConstraint] 🛑 Plates exhausted outside work hours - advancing to next work day:', {
              printer: slot.printerName,
              platesInUse: slot.platesInUse.length,
              currentTime: slot.currentTime.toISOString(),
              nextWorkDayStart: nextWorkDayStart.toISOString(),
            });
            slot.currentTime = new Date(slot.endOfDayTime); // Mark exhausted for this day's window
          } else {
            console.log('[PlateConstraint] 🛑 No next work day found within 7 days:', {
              printer: slot.printerName,
            });
            slot.currentTime = new Date(slot.endOfDayTime);
          }
          continue; // Skip to next printer
        }
      }
      
      // Find highest priority project that can be scheduled on THIS printer
      for (const state of workingStates) {
        if (state.remainingUnits <= 0) continue;
        
        // ============= DYNAMIC PRESET SELECTION =============
        // Calculate available time in slot
        const availableSlotHours = (slot.endOfDayTime.getTime() - slot.currentTime.getTime()) / (1000 * 60 * 60);
        
        // Check if it's a night slot (after end of work hours, NOT end of planning window)
        const isNightSlot = slot.currentTime >= slot.endOfWorkHours;
        
        // ============= NON-AMS COLOR LOCK CONSTRAINT =============
        // Non-AMS printers can ONLY switch colors:
        // 1. During work hours (manual spool change possible)
        // 2. At the start of a new work day (reload point)
        // Color lock is SEPARATE from plate reload - you can reload plates but not change color overnight
        const projectColorKey = normalizeColor(state.project.color);
        const lastColorKey = slot.lastScheduledColor ? normalizeColor(slot.lastScheduledColor) : undefined;
        
        // Check if we're at the very start of work day (allows color change)
        const isAtWorkDayStart = slot.currentTime.getTime() === dayStart.getTime();
        const canChangeColor = !isNightSlot || isAtWorkDayStart;
        
        if (!slot.hasAMS && !canChangeColor && lastColorKey && lastColorKey !== projectColorKey) {
          // Non-AMS printer is locked to previous color during night/weekend
          console.log('[ColorLock] 🔒 Non-AMS printer color locked:', {
            printer: slot.printerName,
            lockedColor: slot.lastScheduledColor,
            requestedColor: state.project.color,
            isNightSlot,
            isAtWorkDayStart,
            canChangeColor,
          });
          continue; // Skip this project for this printer
        }
        
        // Get available material for this color
        const colorKey = projectColorKey;
        const availableMaterial = workingMaterial.get(colorKey) || 0;
        
        // ============= WEEKEND OPTIMIZATION DETECTION =============
        // Check if this is Thursday afternoon going into weekend
        // Goal: prefer long cycles when cycle will run into Fri/Sat/Sun
        const dayOfWeek = date.getDay(); // 0=Sun, 4=Thu, 5=Fri, 6=Sat
        const isThursday = dayOfWeek === 4;
        const currentHour = slot.currentTime.getHours();
        const isAfternoon = currentHour >= 14; // After 14:00
        const isPreWeekend = isThursday && isAfternoon;
        
        // Select optimal preset dynamically
        const presetSelection = selectOptimalPreset(
          state.product,
          state.remainingUnits,
          availableSlotHours > 0 ? availableSlotHours : 24, // If night slot, use full day
          availableMaterial,
          isNightSlot,
          state.project.preferredPresetId,
          isPreWeekend // Pass weekend optimization flag
        );
        
        // Use dynamically selected preset or fall back to state.preset
        const activePreset = presetSelection?.preset || state.preset;
        const presetReason = presetSelection?.reason || 'Default preset';
        
        // Use custom cycle hours if set (for recovery projects), otherwise use preset default
        const cycleHours = state.project.customCycleHours ?? activePreset.cycleHours;
        const transitionMinutes = settings.transitionMinutes;
        const cycleEndTime = addHours(slot.currentTime, cycleHours);
        
        // ============= RULE B: Night scheduling with 3-level control =============
        const printer = printers.find(p => p.id === slot.printerId);
        const canStartAtNight = 
          settings.afterHoursBehavior === 'FULL_AUTOMATION' &&
          printer?.canStartNewCyclesAfterHours === true &&
          activePreset.allowedForNightCycle !== false;
        
        // ============= DEBUG: Night permission check =============
        if (isNightSlot) {
          console.log('[NightScheduling] 🌙 Night slot permission check:', {
            printer: slot.printerName,
            printerId: slot.printerId,
            currentTime: slot.currentTime.toISOString(),
            endOfWorkHours: slot.endOfWorkHours.toISOString(),
            isNightSlot,
            canStartAtNight,
            conditions: {
              afterHoursBehavior: settings.afterHoursBehavior,
              isFULL_AUTOMATION: settings.afterHoursBehavior === 'FULL_AUTOMATION',
              printerCanStartNewCyclesAfterHours: printer?.canStartNewCyclesAfterHours,
              presetAllowedForNightCycle: activePreset.allowedForNightCycle,
            },
          });
        }
        
        // Use endOfWorkHours for the night check (not endOfDayTime which is extended)
        if (isNightSlot && !canStartAtNight) {
          // Log block reason
          const blockReason = !activePreset.allowedForNightCycle 
            ? 'no_night_preset' 
            : 'after_hours_policy';
          logCycleBlock({
            reason: blockReason,
            projectId: state.project.id,
            projectName: state.project.name,
            printerId: slot.printerId,
            printerName: slot.printerName,
            presetId: activePreset.id,
            presetName: activePreset.name,
            details: blockReason === 'no_night_preset'
              ? `Preset "${activePreset.name}" not allowed for night cycle`
              : `After hours policy prevents start (behavior: ${settings.afterHoursBehavior}, printer night: ${printer?.canStartNewCyclesAfterHours})`,
            scheduledDate: dateString,
            cycleHours: cycleHours,
          });
          continue;
        }
        
        // Calculate material needs using the active preset
        const gramsNeeded = getGramsPerCycle(state.product, activePreset);
        
        // Determine units for this cycle
        const unitsThisCycle = Math.min(activePreset.unitsPerPlate, state.remainingUnits);
        const gramsThisCycle = unitsThisCycle * state.product.gramsPerUnit;
        
        // ============= CRITICAL: SPOOL-LIMITED SCHEDULING (PRD RULE) =============
        // Check ColorInventory for material availability (primary source)
        // Physical spools only used for parallel printer limit calculation
        
        // Get available material from ColorInventory (single source of truth)
        const hasMaterial = availableMaterial >= gramsThisCycle;
        
        // ============= SOFT CONSTRAINT: Material availability =============
        // DON'T block cycle creation - mark readiness state instead
        // Planning creates cycles, execution handles material assignment
        if (!hasMaterial) {
          console.log('[Planning] Material insufficient - cycle will be created with blocked_inventory state', {
            project: state.project.name,
            color: state.project.color,
            needed: gramsThisCycle,
            available: Math.floor(availableMaterial)
          });
        }
        
        // For parallel scheduling, limit by REAL spool count (openSpoolCount + closedCount)
        // NO virtual spool calculation - use actual physical spools
        const colorItem = getColorInventoryItem(state.project.color, 'PLA');
        const openSpoolCount = colorItem?.openSpoolCount || 0;
        const closedSpoolCount = colorItem?.closedCount || 0;
        
        // Parallel capacity = existing open spools + closed spools we can open
        const totalSpoolCount = openSpoolCount + closedSpoolCount;
        
        // Keep spools list for spool suggestions later
        const allSpools = getSpools();
        const availableSpoolsForColor = allSpools.filter(s => 
          normalizeColor(s.color) === colorKey && 
          s.state !== 'empty' &&
          s.gramsRemainingEst > 0
        );
        
        // Get how many DIFFERENT printers are assigned to this color currently
        // Note: Same printer can do multiple sequential cycles with same color
        const printersUsingColor = workingSpoolAssignments.get(colorKey) || new Set<string>();
        
        // Check if this printer already has this color assigned
        const thisPrinterHasColor = printersUsingColor.has(slot.printerId);
        
        // ============= SOFT CONSTRAINT: Spool parallel limit =============
        // Track capacity but DON'T block - at most a warning in readiness
        const hasSpoolCapacity = thisPrinterHasColor || printersUsingColor.size < totalSpoolCount;
        if (!hasSpoolCapacity) {
          console.log('[Planning] Spool capacity exceeded - cycle will be created with warning', {
            project: state.project.name,
            color: state.project.color,
            printersUsing: printersUsingColor.size,
            totalSpools: totalSpoolCount
          });
        }
        
        // Determine plate type
        let plateType: 'full' | 'reduced' | 'closeout' = 'full';
        if (unitsThisCycle < state.preset.unitsPerPlate) {
          plateType = state.remainingUnits <= unitsThisCycle ? 'closeout' : 'reduced';
        }
        
        // Check if this is an end-of-day cycle
        const remainingDayHours = (slot.endOfDayTime.getTime() - cycleEndTime.getTime()) / (1000 * 60 * 60);
        const isEndOfDayCycle = remainingDayHours < 2;
        
        // Determine readiness state based on material availability and spool mounting
        let readinessState: 'ready' | 'waiting_for_spool' | 'blocked_inventory' = 'waiting_for_spool';
        let readinessDetails: string | undefined;
        const suggestedSpoolIds: string[] = [];
        
        // Check if material is available in inventory at all
        const hasEnoughInventory = availableMaterial >= gramsThisCycle;
        
        // Use existing printer variable from line 773 for mounted spool check
        // (printer is already defined in this scope)
        
        // Check what color is currently mounted on this printer
        let currentMountedColor: string | undefined;
        let isCorrectColorMounted = false;
        
        if (printer?.hasAMS && printer.amsSlotStates) {
          const matchingSlot = printer.amsSlotStates.find(s => 
            normalizeColor(s.color) === colorKey && !!s.spoolId
          );
          isCorrectColorMounted = !!matchingSlot;
          // Get first mounted color for display
          const firstMounted = printer.amsSlotStates.find(s => !!s.spoolId && s.color);
          currentMountedColor = firstMounted?.color;
        } else {
          isCorrectColorMounted = !!printer?.mountedSpoolId && 
            normalizeColor(printer?.mountedColor) === colorKey;
          currentMountedColor = printer?.mountedColor;
        }
        
        // ============= DETERMINE READINESS STATE =============
        // Priority order:
        // 1. blocked_inventory - ONLY for real material shortage (grams)
        // 2. waiting_for_spool - for spool issues (no spools, parallel limit, need to load)
        // 3. ready - correct color already mounted
        
        if (!hasEnoughInventory) {
          // REAL material shortage - blocked_inventory (will be filtered from Today dashboard)
          readinessState = 'blocked_inventory';
          readinessDetails = `חסר ${state.project.color}: צריך ${gramsThisCycle}g, זמין ${Math.floor(availableMaterial)}g`;
        } else if (isCorrectColorMounted) {
          // Correct color already mounted - ready to print
          readinessState = 'ready';
          readinessDetails = undefined;
        } else {
          // Need to load spool - this is always waiting_for_spool (SOFT constraint)
          readinessState = 'waiting_for_spool';
          
          // Build detailed message based on situation
          if (totalSpoolCount === 0) {
            // No spools registered for this color at all - soft, not blocking
            readinessDetails = `אין גלילים רשומים ל-${state.project.color} - הוסף גלילים למלאי`;
          } else if (!hasSpoolCapacity) {
            // All spools of this color are in use on other printers (soft warning)
            readinessDetails = `כל ${totalSpoolCount} הגלילים ל-${state.project.color} בשימוש. המתן לפינוי או הוסף גליל.`;
          } else if (currentMountedColor && normalizeColor(currentMountedColor) !== colorKey) {
            readinessDetails = `טען גליל ${state.project.color} על ${slot.printerName} (כרגע: ${currentMountedColor})`;
          } else {
            readinessDetails = `טען גליל ${state.project.color} על ${slot.printerName}`;
          }
          
          // Suggest matching spools
          const matchingSpools = availableSpoolsForColor.filter(s => s.gramsRemainingEst >= gramsThisCycle);
          for (const spool of matchingSpools.slice(0, 3)) {
            suggestedSpoolIds.push(spool.id);
          }
        }
        
        // ============= CALCULATE PLATE INDEX BEFORE CREATING CYCLE =============
        const PLATE_CLEANUP_MINUTES = 10;
        const plateReleaseTime = new Date(cycleEndTime.getTime() + PLATE_CLEANUP_MINUTES * 60_000);
        const plateIndex = slot.platesInUse.length + 1; // 1-based for display
        
        // Create the scheduled cycle (ALWAYS create it, per PRD - planning is separate from execution)
        const scheduledCycle: ScheduledCycle = {
          id: generateId(),
          projectId: state.project.id,
          printerId: slot.printerId,
          unitsPlanned: unitsThisCycle,
          gramsPlanned: gramsThisCycle,
          startTime: new Date(slot.currentTime),
          endTime: cycleEndTime,
          plateType,
          shift: isEndOfDayCycle ? 'end_of_day' : 'day',
          isEndOfDayCycle,
          readinessState,
          readinessDetails,
          requiredColor: state.project.color,
          requiredGrams: gramsThisCycle,
          suggestedSpoolIds: suggestedSpoolIds.length > 0 ? suggestedSpoolIds : undefined,
          // Preset selection fields
          presetId: activePreset.id,
          presetName: activePreset.name,
          presetSelectionReason: presetReason,
          // Plate constraint fields
          plateIndex,
          plateReleaseTime,
        };
        
        // Update slot
        slot.cyclesScheduled.push(scheduledCycle);
        slot.currentTime = addHours(cycleEndTime, transitionMinutes / 60);
        
        // ============= PLATE CONSTRAINT: ADD PLATE TO IN-USE LIST =============
        slot.platesInUse.push({
          releaseTime: plateReleaseTime,
          cycleId: scheduledCycle.id,
        });
        slot.lastScheduledColor = state.project.color; // Track for non-AMS color lock
        
        const platesRemaining = slot.physicalPlateCapacity - slot.platesInUse.length;
        
        console.log('[PlateConstraint] 📋 Plate used:', {
          printer: slot.printerName,
          plateIndex: `${plateIndex}/${slot.physicalPlateCapacity}`,
          platesRemaining,
          color: state.project.color,
          cycleEnd: cycleEndTime.toISOString(),
          plateReleaseTime: plateReleaseTime.toISOString(),
          isNightSlot,
          isWithinWorkHours: slot.currentTime >= slot.workDayStart && slot.currentTime < slot.endOfWorkHours,
        });
        
        // Update project state
        state.remainingUnits -= unitsThisCycle;
        
        // ============= NO MATERIAL DEDUCTION IN PLANNING =============
        // Material is deducted ONLY at execution time in StartPrintModal
        // Planning tracks estimates but never changes actual inventory
        // workingMaterial remains unchanged - cycles may overlap on same material
        
        // Track this printer as using this color (for spool-limiting concurrent access)
        if (!workingSpoolAssignments.has(colorKey)) {
          workingSpoolAssignments.set(colorKey, new Set());
        }
        workingSpoolAssignments.get(colorKey)!.add(slot.printerId);
        
        moreToSchedule = true;
        break; // Scheduled ONE cycle on this printer, move to next printer (round-robin)
      }
      
      // Remove completed projects between printers
      workingStates = workingStates.filter(s => s.remainingUnits > 0);
      if (workingStates.length === 0) break;
    }
    
    // Remove completed projects before next round
    workingStates = workingStates.filter(s => s.remainingUnits > 0);
    if (workingStates.length === 0) break;
  }
  
  if (iterationCount >= maxIterations) {
    console.warn('[Planning] Hit max iteration limit - possible infinite loop prevented');
  }
  
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
  
  // ============= FIX: Track planning window coverage to prevent duplicates =============
  // When a working day's night window extends into subsequent non-working days,
  // those days are already "covered" and should not be planned separately.
  // E.g., Thursday 17:30 → Sunday 08:30 covers Friday and Saturday entirely.
  let coveredUntil: Date | null = null;
  
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
    
    // ============= FIX: Skip days already covered by previous planning window =============
    // If a previous day's night window already covers this day, don't plan it again
    if (coveredUntil && planDate < coveredUntil) {
      console.log('[Plan] ⏭️ Skipping day already covered by previous planning window:', {
        date: formatDateString(planDate),
        isNonWorkingDay,
        coveredUntil: coveredUntil.toISOString(),
      });
      
      // Add empty day plan to maintain structure
      days.push({
        date: planDate,
        dateString: formatDateString(planDate),
        isWorkday: !isNonWorkingDay,
        workStart: schedule?.startTime ?? '',
        workEnd: schedule?.endTime ?? '',
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
    
    // ============= Calculate dayEnd to update coveredUntil =============
    // This mirrors the logic in scheduleCyclesForDay to know when this day's window ends
    let dayEndForCoverage: Date;
    if (isNonWorkingDay) {
      // Autonomous day: window extends until next working day start
      const nextWorkDayStart = findNextWorkDayStart(planDate, settings, 7);
      dayEndForCoverage = nextWorkDayStart ?? addDays(planDate, 1);
    } else if (settings.afterHoursBehavior === 'FULL_AUTOMATION') {
      // Working day with FULL_AUTOMATION: extends to next working day's start
      const nextWorkDayStart = findNextWorkDayStart(planDate, settings, 7);
      dayEndForCoverage = nextWorkDayStart ?? addDays(planDate, 1);
    } else {
      // Normal working day: ends at work hours end
      dayEndForCoverage = createDateWithTime(planDate, schedule!.endTime);
    }
    
    console.log('[Plan] 📅 Planning day:', {
      date: formatDateString(planDate),
      isNonWorkingDay,
      shouldPlanAutonomous,
      dayEndForCoverage: dayEndForCoverage.toISOString(),
      previousCoveredUntil: coveredUntil?.toISOString() ?? 'none',
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
      shouldPlanAutonomous  // isAutonomousDay - indicates this is a non-working day with FULL_AUTOMATION
    );
    
    days.push(dayPlan);
    workingProjectStates = updatedProjectStates;
    workingMaterialTracker = updatedMaterialTracker;
    // NOTE: workingSpoolAssignments NOT carried over - reset fresh each day (line 709)
    
    // ============= FIX: Update coveredUntil to prevent duplicate planning =============
    if (!coveredUntil || dayEndForCoverage > coveredUntil) {
      coveredUntil = dayEndForCoverage;
    }
    
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

// ============= CAPACITY CALCULATION =============

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
