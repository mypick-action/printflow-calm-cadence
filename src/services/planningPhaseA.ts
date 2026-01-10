// ============= PLANNING PHASE A: DEADLINE ALLOCATION =============
// Calculates minimum printer allocation needed to meet project deadlines
// This phase runs BEFORE utilization fill to ensure deadline-critical projects are prioritized

import { 
  Project, 
  Product, 
  PlatePreset, 
  FactorySettings,
  getDayScheduleForDate,
} from './storage';
import { 
  advanceToNextWorkdayStart, 
  createDateWithTime,
  parseTime,
  getNightWindow,
} from './schedulingHelpers';

// ============= TYPES =============

export interface DeadlineAllocation {
  projectId: string;
  projectName: string;
  color: string;
  deadline: Date;
  
  // Units & capacity
  remainingUnits: number;
  unitsPerCycle: number;
  cycleHours: number;
  
  // Calculated requirements
  requiredCycles: number;
  requiredHours: number;
  
  // Available capacity
  availableHoursUntilDeadline: number;
  availableHoursPerPrinter: number;
  
  // Allocation result
  minPrintersNeeded: number;
  dailyTargetUnits: number;
  
  // Risk assessment
  marginHours: number;        // positive = buffer, negative = at risk
  riskLevel: 'ok' | 'tight' | 'at_risk' | 'impossible';
}

export interface PhaseAResult {
  allocations: DeadlineAllocation[];
  totalPrintersNeeded: number;
  criticalProjects: string[];  // Project IDs at risk
  warnings: string[];
}

// ============= CONSTANTS =============

// Risk thresholds (in hours of margin)
const TIGHT_MARGIN_HOURS = 8;    // Less than 8 hours margin = tight
const AT_RISK_MARGIN_HOURS = 0;  // No margin = at risk

// Maximum days to look ahead for capacity calculation
const MAX_PLANNING_DAYS = 14;

// ============= MAIN FUNCTION =============

/**
 * Phase A: Calculate deadline allocations for all active projects.
 * 
 * For each project:
 * 1. Calculate required cycles and hours to complete
 * 2. Calculate available hours until deadline
 * 3. Determine minimum printers needed to meet deadline
 * 4. Assess risk level
 * 
 * @param projects - Active projects to allocate
 * @param products - Products for preset lookup
 * @param printerCount - Total available printers
 * @param settings - Factory settings
 * @param planningStart - Planning start time (usually now)
 * @returns PhaseAResult with allocations and summary
 */
export function phaseA_calculateDeadlineAllocations(
  projects: Array<{ 
    project: Project; 
    product: Product; 
    preset: PlatePreset;
    remainingUnits: number;
  }>,
  printerCount: number,
  settings: FactorySettings,
  planningStart: Date
): PhaseAResult {
  const allocations: DeadlineAllocation[] = [];
  const criticalProjects: string[] = [];
  const warnings: string[] = [];
  
  for (const { project, product, preset, remainingUnits } of projects) {
    // Skip if no remaining units
    if (remainingUnits <= 0) continue;
    
    const deadline = new Date(project.dueDate);
    
    // Skip if deadline is in the past
    if (deadline <= planningStart) {
      warnings.push(`Project "${project.name}" has passed deadline`);
      criticalProjects.push(project.id);
      continue;
    }
    
    // Calculate required cycles and hours
    const unitsPerCycle = preset.unitsPerPlate;
    const cycleHours = project.customCycleHours ?? preset.cycleHours;
    const requiredCycles = Math.ceil(remainingUnits / unitsPerCycle);
    const requiredHours = requiredCycles * cycleHours;
    
    // Calculate available hours until deadline
    const availableHours = calculateAvailableHours(
      planningStart, 
      deadline, 
      settings
    );
    
    // Calculate available hours per printer (accounting for nights if enabled)
    const availableHoursPerPrinter = calculateHoursPerPrinter(
      planningStart,
      deadline,
      settings
    );
    
    // Calculate minimum printers needed
    let minPrintersNeeded = 1;
    if (availableHoursPerPrinter > 0) {
      minPrintersNeeded = Math.ceil(requiredHours / availableHoursPerPrinter);
    } else if (requiredHours > 0) {
      minPrintersNeeded = printerCount; // Use all if no time available
    }
    
    // Cap at available printers
    minPrintersNeeded = Math.min(minPrintersNeeded, printerCount);
    
    // Calculate margin (positive = buffer, negative = at risk)
    const marginHours = (availableHoursPerPrinter * minPrintersNeeded) - requiredHours;
    
    // Determine risk level
    let riskLevel: DeadlineAllocation['riskLevel'] = 'ok';
    if (marginHours < AT_RISK_MARGIN_HOURS) {
      riskLevel = requiredHours > (availableHours * printerCount) ? 'impossible' : 'at_risk';
    } else if (marginHours < TIGHT_MARGIN_HOURS) {
      riskLevel = 'tight';
    }
    
    if (riskLevel === 'at_risk' || riskLevel === 'impossible') {
      criticalProjects.push(project.id);
    }
    
    // Calculate daily target
    const daysUntilDeadline = Math.max(1, Math.ceil(
      (deadline.getTime() - planningStart.getTime()) / (1000 * 60 * 60 * 24)
    ));
    const dailyTargetUnits = Math.ceil(remainingUnits / daysUntilDeadline);
    
    allocations.push({
      projectId: project.id,
      projectName: project.name,
      color: project.color,
      deadline,
      remainingUnits,
      unitsPerCycle,
      cycleHours,
      requiredCycles,
      requiredHours,
      availableHoursUntilDeadline: availableHours,
      availableHoursPerPrinter,
      minPrintersNeeded,
      dailyTargetUnits,
      marginHours,
      riskLevel,
    });
  }
  
  // Sort by risk level (at_risk first) then by deadline
  allocations.sort((a, b) => {
    const riskOrder = { impossible: 0, at_risk: 1, tight: 2, ok: 3 };
    const riskDiff = riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
    if (riskDiff !== 0) return riskDiff;
    return a.deadline.getTime() - b.deadline.getTime();
  });
  
  // Calculate total printers needed (taking max from overlapping deadlines)
  const totalPrintersNeeded = calculateTotalPrintersNeeded(allocations);
  
  return {
    allocations,
    totalPrintersNeeded,
    criticalProjects,
    warnings,
  };
}

// ============= HELPER FUNCTIONS =============

/**
 * Calculate total available work hours between two dates.
 * Considers work schedule and night automation settings.
 */
function calculateAvailableHours(
  start: Date,
  end: Date,
  settings: FactorySettings
): number {
  let totalHours = 0;
  const current = new Date(start);
  let daysChecked = 0;
  
  while (current < end && daysChecked < MAX_PLANNING_DAYS) {
    const schedule = getDayScheduleForDate(current, settings, []);
    
    if (schedule?.enabled) {
      // Calculate work hours for this day
      const workStart = createDateWithTime(current, schedule.startTime);
      const workEnd = createDateWithTime(current, schedule.endTime);
      
      // Handle cross-midnight
      let effectiveEnd = workEnd;
      const startMinutes = parseTime(schedule.startTime).hours * 60 + parseTime(schedule.startTime).minutes;
      const endMinutes = parseTime(schedule.endTime).hours * 60 + parseTime(schedule.endTime).minutes;
      if (endMinutes < startMinutes) {
        effectiveEnd = new Date(workEnd.getTime() + 24 * 60 * 60 * 1000);
      }
      
      // Clamp to our window
      const dayStart = current > start ? workStart : new Date(Math.max(workStart.getTime(), start.getTime()));
      const dayEnd = effectiveEnd < end ? effectiveEnd : new Date(Math.min(effectiveEnd.getTime(), end.getTime()));
      
      if (dayEnd > dayStart) {
        let dayHours = (dayEnd.getTime() - dayStart.getTime()) / (1000 * 60 * 60);
        
        // Add night hours if FULL_AUTOMATION
        if (settings.afterHoursBehavior === 'FULL_AUTOMATION') {
          const nightWindow = getNightWindow(current, settings);
          if (nightWindow && nightWindow.mode === 'full') {
            dayHours += nightWindow.totalHours;
          }
        }
        
        totalHours += dayHours;
      }
    }
    
    // Move to next day
    current.setDate(current.getDate() + 1);
    current.setHours(0, 0, 0, 0);
    daysChecked++;
  }
  
  return totalHours;
}

/**
 * Calculate effective hours per printer per day.
 * Used for capacity planning.
 */
function calculateHoursPerPrinter(
  start: Date,
  end: Date,
  settings: FactorySettings
): number {
  const totalHours = calculateAvailableHours(start, end, settings);
  const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
  
  // Average hours per day, capped to realistic maximum (24h)
  return Math.min(totalHours / days * days, totalHours);
}

/**
 * Calculate total printers needed across all projects.
 * Takes into account overlapping deadlines.
 */
function calculateTotalPrintersNeeded(allocations: DeadlineAllocation[]): number {
  if (allocations.length === 0) return 0;
  
  // Simple approach: sum of minPrintersNeeded for at_risk/impossible projects
  // For ok/tight projects, we can share printers
  
  let criticalPrinters = 0;
  let normalPrinters = 0;
  
  for (const alloc of allocations) {
    if (alloc.riskLevel === 'at_risk' || alloc.riskLevel === 'impossible') {
      criticalPrinters += alloc.minPrintersNeeded;
    } else {
      normalPrinters = Math.max(normalPrinters, alloc.minPrintersNeeded);
    }
  }
  
  return criticalPrinters + normalPrinters;
}
