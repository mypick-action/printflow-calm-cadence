// ============= PLANNING ENGINE =============
// Deterministic rules-based scheduler for PrintFlow
// NO AI, NO LLM, NO Cloud - Pure local constraint-based logic

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
} from './storage';

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
  const endMinutes = end.hours * 60 + end.minutes;
  
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

const formatDateString = (date: Date): string => {
  return date.toISOString().split('T')[0];
};

const getAvailableFilamentForColor = (color: string, spools: Spool[]): number => {
  return spools
    .filter(s => s.color.toLowerCase() === color.toLowerCase() && s.state !== 'empty')
    .reduce((sum, s) => sum + s.gramsRemainingEst, 0);
};

// ============= PROJECT PRIORITIZATION =============

const prioritizeProjects = (projects: Project[], products: Product[], fromDate: Date): ProjectPlanningState[] => {
  const projectStates: ProjectPlanningState[] = [];
  
  for (const project of projects) {
    // Skip completed projects
    if (project.status === 'completed') continue;
    
    const product = products.find(p => p.id === project.productId);
    if (!product) continue;
    
    // Get the preferred or recommended preset
    const preset = project.preferredPresetId 
      ? product.platePresets.find(p => p.id === project.preferredPresetId)
      : product.platePresets.find(p => p.isRecommended) || product.platePresets[0];
    
    if (!preset) continue;
    
    const remainingUnits = project.quantityTarget - project.quantityGood;
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
  
  // Calculate total material needed per color
  for (const state of projectStates) {
    const gramsNeeded = state.remainingUnits * state.product.gramsPerUnit;
    const color = state.project.color.toLowerCase();
    
    const existing = materialNeeds.get(color) || { needed: 0, projectIds: [] };
    existing.needed += gramsNeeded;
    existing.projectIds.push(state.project.id);
    materialNeeds.set(color, existing);
  }
  
  // Check against available material
  for (const [color, needs] of materialNeeds) {
    const available = getAvailableFilamentForColor(color, spools);
    
    if (available < needs.needed) {
      issues.push({
        type: 'insufficient_material',
        message: `חסר פילמנט ${color}: נדרשים ${Math.ceil(needs.needed)}g, זמינים ${Math.ceil(available)}g`,
        messageEn: `Insufficient ${color} filament: need ${Math.ceil(needs.needed)}g, have ${Math.ceil(available)}g`,
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
  spoolAssignmentTracker: Map<string, Set<string>> // NEW: tracks which spools are assigned to which printers
): { dayPlan: DayPlan; updatedProjectStates: ProjectPlanningState[]; updatedMaterialTracker: Map<string, number>; updatedSpoolAssignments: Map<string, Set<string>> } => {
  const dayStart = createDateWithTime(date, schedule.startTime);
  const dayEnd = createDateWithTime(date, schedule.endTime);
  const dateString = formatDateString(date);
  
  // Initialize printer time slots
  const printerSlots: PrinterTimeSlot[] = printers.map(p => ({
    printerId: p.id,
    printerName: p.name,
    currentTime: new Date(dayStart),
    endOfDayTime: new Date(dayEnd),
    cyclesScheduled: [],
  }));
  
  // Check for existing in-progress or locked cycles for this day
  const existingDayCycles = existingCycles.filter(c => {
    const cycleDate = new Date(c.startTime);
    return formatDateString(cycleDate) === dateString && 
           (c.status === 'in_progress' || c.status === 'completed');
  });
  
  // Adjust printer slots for existing cycles
  for (const existingCycle of existingDayCycles) {
    const slot = printerSlots.find(s => s.printerId === existingCycle.printerId);
    if (slot) {
      const cycleEnd = new Date(existingCycle.endTime);
      if (cycleEnd > slot.currentTime) {
        slot.currentTime = addHours(cycleEnd, settings.transitionMinutes / 60);
      }
    }
  }
  
  // Clone project states for modification
  let workingStates = projectStates.map(s => ({ ...s }));
  const workingMaterial = new Map(materialTracker);
  
  // Clone spool assignment tracker (color -> set of printer IDs using that color simultaneously)
  const workingSpoolAssignments = new Map<string, Set<string>>();
  for (const [color, printerSet] of spoolAssignmentTracker) {
    workingSpoolAssignments.set(color, new Set(printerSet));
  }
  
  // Schedule cycles until no more can be scheduled
  let moreToSchedule = true;
  while (moreToSchedule) {
    moreToSchedule = false;
    
    for (const slot of printerSlots) {
      // Find highest priority project that can be scheduled
      for (const state of workingStates) {
        if (state.remainingUnits <= 0) continue;
        
        const cycleHours = state.preset.cycleHours;
        const transitionMinutes = settings.transitionMinutes;
        const cycleEndTime = addHours(slot.currentTime, cycleHours);
        
        // Check if cycle fits in day
        if (cycleEndTime > slot.endOfDayTime) continue;
        
        // Calculate material needs
        const gramsNeeded = getGramsPerCycle(state.product, state.preset);
        const colorKey = state.project.color.toLowerCase();
        const availableMaterial = workingMaterial.get(colorKey) || 0;
        
        // Determine units for this cycle
        const unitsThisCycle = Math.min(state.preset.unitsPerPlate, state.remainingUnits);
        const gramsThisCycle = unitsThisCycle * state.product.gramsPerUnit;
        
        // ============= CRITICAL: SPOOL-LIMITED SCHEDULING (PRD RULE) =============
        // 1 physical spool = 1 printer at a time
        // Count available spools for this color
        const allSpools = getSpools();
        const availableSpoolsForColor = allSpools.filter(s => 
          s.color.toLowerCase() === colorKey && 
          s.state !== 'empty' &&
          s.gramsRemainingEst > 0
        );
        const totalSpoolCount = availableSpoolsForColor.length;
        
        // Get how many printers are ALREADY assigned to this color (in current time slot)
        const printersUsingColor = workingSpoolAssignments.get(colorKey) || new Set<string>();
        
        // Check if this printer already has this color assigned
        const thisPrinterHasColor = printersUsingColor.has(slot.printerId);
        
        // If printer doesn't have color and we've reached spool limit, skip
        if (!thisPrinterHasColor && printersUsingColor.size >= totalSpoolCount) {
          // Cannot assign - not enough physical spools for parallel operation
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
              s.color?.toLowerCase() === colorKey && !!s.spoolId
            );
          } else {
            isSpoolMounted = !!printer?.mountedSpoolId && 
              printer?.mountedColor?.toLowerCase() === colorKey;
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
        
        // Track this printer as using this color (for spool-limiting)
        if (!workingSpoolAssignments.has(colorKey)) {
          workingSpoolAssignments.set(colorKey, new Set());
        }
        workingSpoolAssignments.get(colorKey)!.add(slot.printerId);
        
        moreToSchedule = true;
        break; // Move to next printer slot
      }
    }
    
    // Remove completed projects
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
  const projects = getActiveProjects();
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
  const projectStates = prioritizeProjects(projects, products, startDate);
  
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
  
  // Initialize material tracker
  const materialTracker = new Map<string, number>();
  for (const spool of spools) {
    if (spool.state !== 'empty') {
      const colorKey = spool.color.toLowerCase();
      const current = materialTracker.get(colorKey) || 0;
      materialTracker.set(colorKey, current + spool.gramsRemainingEst);
    }
  }
  
  // Generate day-by-day plan
  const days: DayPlan[] = [];
  let workingProjectStates = [...projectStates];
  let workingMaterialTracker = new Map(materialTracker);
  // Track spool assignments per color -> set of printer IDs (for 1 spool = 1 printer rule)
  let workingSpoolAssignments = new Map<string, Set<string>>();
  
  for (let dayOffset = 0; dayOffset < daysToPlane; dayOffset++) {
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
    const { dayPlan, updatedProjectStates, updatedMaterialTracker, updatedSpoolAssignments } = scheduleCyclesForDay(
      planDate,
      schedule,
      printers,
      workingProjectStates,
      settings,
      workingMaterialTracker,
      existingCycles,
      workingSpoolAssignments
    );
    
    days.push(dayPlan);
    workingProjectStates = updatedProjectStates;
    workingMaterialTracker = updatedMaterialTracker;
    workingSpoolAssignments = updatedSpoolAssignments;
    
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
