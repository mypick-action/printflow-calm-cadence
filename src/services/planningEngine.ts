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
} from './storage';
import { normalizeColor } from './colorNormalization';
import { getAvailableGramsByColor } from './materialAdapter';
import { formatDateStringLocal } from './dateUtils';
import { logCycleBlock } from './cycleBlockLogger';

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
  readinessState: 'ready' | 'waiting_for_spool' | 'blocked_inventory';
  readinessDetails?: string;
  requiredColor: string;
  requiredGrams: number;
  suggestedSpoolIds?: string[];
  // Preset selection fields
  presetId?: string;
  presetName?: string;
  presetSelectionReason?: string;
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
 */
export const selectOptimalPreset = (
  product: Product,
  remainingUnits: number,
  availableHours: number,
  availableGrams: number,
  isNightSlot: boolean,
  preferredPresetId?: string
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

interface PrinterTimeSlot {
  printerId: string;
  printerName: string;
  currentTime: Date;
  endOfDayTime: Date;
  cyclesScheduled: ScheduledCycle[];
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
  planningStartTime?: Date // NEW: When replanning starts (from recalculatePlan)
): { dayPlan: DayPlan; updatedProjectStates: ProjectPlanningState[]; updatedMaterialTracker: Map<string, number>; updatedSpoolAssignments: Map<string, Set<string>> } => {
  const dayStart = createDateWithTime(date, schedule.startTime);
  let dayEnd = createDateWithTime(date, schedule.endTime);
  
  // Handle cross-midnight shifts (e.g., 17:30 -> 02:00 next day)
  // If endTime < startTime, it means the shift crosses midnight
  const startMinutes = parseTime(schedule.startTime).hours * 60 + parseTime(schedule.startTime).minutes;
  const endMinutes = parseTime(schedule.endTime).hours * 60 + parseTime(schedule.endTime).minutes;
  
  if (endMinutes < startMinutes || allowCrossMidnight) {
    // Shift crosses midnight - add 1 day to end time
    dayEnd = addHours(dayEnd, 24);
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
    
    return {
      printerId: p.id,
      printerName: p.name,
      currentTime: new Date(startTime),
      endOfDayTime: new Date(dayEnd),
      cyclesScheduled: [],
    };
  });
  
  dbgStart('SlotsStartTimes', printerSlots.map(s => ({
    printer: s.printerName,
    printerId: s.printerId,
    slotStart: s.currentTime.toISOString(),
  })));
  
  // Clone project states for modification
  let workingStates = projectStates.map(s => ({ ...s }));
  const workingMaterial = new Map(materialTracker);
  
  // Clone spool assignment tracker (color -> set of printer IDs using that color simultaneously)
  const workingSpoolAssignments = new Map<string, Set<string>>();
  for (const [color, printerSet] of spoolAssignmentTracker) {
    workingSpoolAssignments.set(color, new Set(printerSet));
  }
  
  // Schedule cycles until no more can be scheduled
  // FIXED: Fill each printer to capacity before moving to next day
  let moreToSchedule = true;
  while (moreToSchedule) {
    moreToSchedule = false;
    
    // Try to schedule on each printer
    for (const slot of printerSlots) {
      // Keep scheduling on THIS printer until it's full
      let scheduledOnThisPrinter = true;
      while (scheduledOnThisPrinter) {
        scheduledOnThisPrinter = false;
        
        // Find highest priority project that can be scheduled
        for (const state of workingStates) {
          if (state.remainingUnits <= 0) continue;
          
          // ============= DYNAMIC PRESET SELECTION =============
          // Calculate available time in slot
          const availableSlotHours = (slot.endOfDayTime.getTime() - slot.currentTime.getTime()) / (1000 * 60 * 60);
          
          // Check if it's a night slot (after end of day)
          const isNightSlot = slot.currentTime >= slot.endOfDayTime;
          
          // Get available material for this color
          const colorKey = normalizeColor(state.project.color);
          const availableMaterial = workingMaterial.get(colorKey) || 0;
          
          // Select optimal preset dynamically
          const presetSelection = selectOptimalPreset(
            state.product,
            state.remainingUnits,
            availableSlotHours > 0 ? availableSlotHours : 24, // If night slot, use full day
            availableMaterial,
            isNightSlot,
            state.project.preferredPresetId
          );
          
          // Use dynamically selected preset or fall back to state.preset
          const activePreset = presetSelection?.preset || state.preset;
          const presetReason = presetSelection?.reason || 'Default preset';
          
          // Use custom cycle hours if set (for recovery projects), otherwise use preset default
          const cycleHours = state.project.customCycleHours ?? activePreset.cycleHours;
          const transitionMinutes = settings.transitionMinutes;
          const cycleEndTime = addHours(slot.currentTime, cycleHours);
          
          // ============= RULE B: Night scheduling with 3-level control =============
          // Level 1: Factory - afterHoursBehavior === 'FULL_AUTOMATION' enables night work
          // Level 2: Printer - canStartNewCyclesAfterHours allows this specific printer to start new cycles
          // Level 3: Preset - allowedForNightCycle allows this specific job type at night (safe vs risky)
          // 
          // A cycle can always START during operating hours and RUN past closing time
          // Starting NEW cycles after hours requires all 3 conditions to be true
          const printer = printers.find(p => p.id === slot.printerId);
          const canStartAtNight = 
            settings.afterHoursBehavior === 'FULL_AUTOMATION' &&
            printer?.canStartNewCyclesAfterHours === true &&
            activePreset.allowedForNightCycle !== false; // Default true if not explicitly set to false
          
          if (slot.currentTime >= slot.endOfDayTime && !canStartAtNight) {
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
          
          if (!hasMaterial) {
            // Not enough material - log and skip this project
            logCycleBlock({
              reason: 'material_insufficient',
              projectId: state.project.id,
              projectName: state.project.name,
              printerId: slot.printerId,
              printerName: slot.printerName,
              presetId: activePreset.id,
              presetName: activePreset.name,
              details: `Need ${gramsThisCycle}g of ${state.project.color}, available: ${Math.floor(availableMaterial)}g`,
              scheduledDate: dateString,
              cycleHours: cycleHours,
              gramsRequired: gramsThisCycle,
              gramsAvailable: availableMaterial,
            });
            continue;
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
          
          // If printer doesn't have color and we've reached spool limit for concurrent use, skip
          // But allow if this is a SEQUENTIAL cycle on the same printer (no new spool needed)
          if (!thisPrinterHasColor && printersUsingColor.size >= totalSpoolCount) {
            // Cannot assign - not enough physical spools for parallel operation
            logCycleBlock({
              reason: 'spool_parallel_limit',
              projectId: state.project.id,
              projectName: state.project.name,
              printerId: slot.printerId,
              printerName: slot.printerName,
              presetId: activePreset.id,
              presetName: activePreset.name,
              details: `Color ${state.project.color}: ${printersUsingColor.size} printers already using, only ${totalSpoolCount} spools available`,
              scheduledDate: dateString,
              cycleHours: cycleHours,
            });
            continue;
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
          
          if (!hasEnoughInventory) {
            // Not enough material in inventory - this is a blocking issue
            readinessState = 'blocked_inventory';
            readinessDetails = `Insufficient ${state.project.color} material: need ${gramsThisCycle}g, available ${Math.floor(availableMaterial)}g`;
          } else {
            // Material exists in inventory - find suitable spools to suggest
            const matchingSpools = availableSpoolsForColor.filter(s => s.gramsRemainingEst >= gramsThisCycle);
            
            // Check if a spool is already mounted on this printer
            const allPrinters = getPrinters();
            const printer = allPrinters.find(p => p.id === slot.printerId);
            
            let isSpoolMounted = false;
            if (printer?.hasAMS && printer.amsSlotStates) {
              isSpoolMounted = printer.amsSlotStates.some(s => 
                normalizeColor(s.color) === colorKey && !!s.spoolId
              );
            } else {
              isSpoolMounted = !!printer?.mountedSpoolId && 
                normalizeColor(printer?.mountedColor) === colorKey;
            }
            
            if (isSpoolMounted) {
              readinessState = 'ready';
              readinessDetails = undefined;
            } else {
              readinessState = 'waiting_for_spool';
              readinessDetails = `Load ${state.project.color} spool on ${slot.printerName}`;
              
              for (const spool of matchingSpools.slice(0, 3)) {
                suggestedSpoolIds.push(spool.id);
              }
            }
          }
          
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
          };
          
          // Update slot
          slot.cyclesScheduled.push(scheduledCycle);
          slot.currentTime = addHours(cycleEndTime, transitionMinutes / 60);
          
          // Update project state
          state.remainingUnits -= unitsThisCycle;
          
          // Only deduct material if we have it (for tracking purposes)
          if (hasEnoughInventory) {
            workingMaterial.set(colorKey, availableMaterial - gramsThisCycle);
          }
          
          // Track this printer as using this color (for spool-limiting concurrent access)
          if (!workingSpoolAssignments.has(colorKey)) {
            workingSpoolAssignments.set(colorKey, new Set());
          }
          workingSpoolAssignments.get(colorKey)!.add(slot.printerId);
          
          scheduledOnThisPrinter = true;
          moreToSchedule = true;
          break; // Found a project for this printer, restart the project search
        }
        
        // Remove completed projects
        workingStates = workingStates.filter(s => s.remainingUnits > 0);
        if (workingStates.length === 0) break;
      }
      
      if (workingStates.length === 0) break;
    }
    
    // If we went through all printers and couldn't schedule anything, stop
    if (!moreToSchedule) break;
    
    // Remove completed projects before next iteration
    workingStates = workingStates.filter(s => s.remainingUnits > 0);
    if (workingStates.length === 0) break;
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
  
  for (let dayOffset = 0; dayOffset < daysToPlane; dayOffset++) {
    // CRITICAL FIX: Reset spool assignments at the START of each day
    // This ensures sequential cycles on same printer are allowed
    // Spool-limit only restricts CONCURRENT usage across printers, not across time
    const workingSpoolAssignments = new Map<string, Set<string>>();
    const planDate = new Date(startDate);
    planDate.setDate(planDate.getDate() + dayOffset);
    planDate.setHours(0, 0, 0, 0);
    
    const schedule = getDayScheduleForDate(planDate, settings, []);
    
    if (!schedule || !schedule.enabled) {
      // Non-working day
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
    
    // Schedule cycles for this day
    // Pass spool assignment tracker to enforce 1 spool = 1 printer rule
    // Pass startDate as planningStartTime to prevent scheduling in the past
    const { dayPlan, updatedProjectStates, updatedMaterialTracker, updatedSpoolAssignments } = scheduleCyclesForDay(
      planDate,
      schedule,
      printers,
      workingProjectStates,
      settings,
      workingMaterialTracker,
      existingCycles,
      workingSpoolAssignments,
      false,      // allowCrossMidnight
      startDate   // planningStartTime - prevents scheduling before this time
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
        });
      }
    }
  }
  
  // Calculate totals
  const totalUnitsPlanned = days.reduce((sum, d) => sum + d.totalUnits, 0);
  const totalCyclesPlanned = days.reduce((sum, d) => sum + d.totalCycles, 0);
  const unusedCapacityHours = days.reduce((sum, d) => sum + d.unusedCapacityHours, 0);
  
  return {
    success: blockingIssues.length === 0,
    days,
    totalUnitsPlanned,
    totalCyclesPlanned,
    unusedCapacityHours,
    warnings,
    blockingIssues,
    cycles: allCycles,
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
  
  // Check for cycles on non-working days
  for (const cycle of cycles) {
    if (cycle.status === 'completed' || cycle.status === 'failed') continue;
    
    const cycleDate = new Date(cycle.startTime);
    const schedule = getDayScheduleForDate(cycleDate, settings, []);
    
    if (!schedule || !schedule.enabled) {
      issues.push(`מחזור מתוכנן ביום לא פעיל: ${cycleDate.toLocaleDateString('he-IL')}`);
      issuesEn.push(`Cycle scheduled on non-working day: ${cycleDate.toLocaleDateString('en-US')}`);
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
