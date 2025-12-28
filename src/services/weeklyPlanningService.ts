/**
 * Weekly Planning Service
 * Provides utilities for weekly planning view and dashboard calculations
 */

import { 
  getPlannedCycles, 
  getProjects, 
  getFactorySettings, 
  getPrinters,
  PlannedCycle, 
  Project,
  getDayScheduleForDate,
  getTemporaryOverrides
} from './storage';
import { getLastReplanInfo } from './planningLogger';

// ============= TYPES =============

export interface DayInfo {
  date: Date;
  dateStr: string; // YYYY-MM-DD
  dayName: string;
  dayNameHe: string;
  isToday: boolean;
}

export interface CycleRisk {
  crossesDeadline: boolean;
  requiresOvernight: boolean;
  isRecovery: boolean; // parentProjectId exists
  projectDueDate?: string;
}

export interface CycleWithDetails extends PlannedCycle {
  projectName: string;
  printerName: string;
  color: string;
  risk: CycleRisk;
}

export interface ProjectCoverage {
  projectId: string;
  projectName: string;
  productName: string;
  color: string;
  dueDate: string;
  quantityTarget: number;
  quantityGood: number;
  quantityScrap: number;
  remainingUnits: number; // target - good
  plannedUnits: number; // sum of units in future planned cycles
  uncoveredUnits: number; // remaining - planned (gap)
  status: 'on_track' | 'at_risk' | 'unscheduled';
  isRecovery: boolean;
}

export interface WeeklyStats {
  totalCycles: number;
  totalUnits: number;
  atRiskProjects: number;
  cyclesCrossingDeadline: number;
  overnightCycles: number;
  unscheduledProjects: number;
  lastReplan: {
    timestamp: string;
    cyclesChanged: number;
    warnings: number;
    durationMs: number;
  } | null;
}

// ============= WEEK RANGE =============

const DAY_NAMES_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_NAMES_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/**
 * Get array of 7 days starting from today
 */
export function getWeekRange(startDate: Date = new Date()): DayInfo[] {
  const days: DayInfo[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  for (let i = 0; i < 7; i++) {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + i);
    date.setHours(0, 0, 0, 0);
    
    const dayOfWeek = date.getDay();
    
    days.push({
      date,
      dateStr: date.toISOString().split('T')[0],
      dayName: DAY_NAMES_EN[dayOfWeek],
      dayNameHe: DAY_NAMES_HE[dayOfWeek],
      isToday: date.getTime() === today.getTime(),
    });
  }
  
  return days;
}

// ============= CYCLE FILTERING =============

/**
 * Get planned cycles for a date range, optionally filtered by printer
 */
export function getPlannedCyclesForWeek(
  startDate: string,
  endDate: string,
  printerId?: string
): PlannedCycle[] {
  const cycles = getPlannedCycles();
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);
  
  return cycles.filter(c => {
    const cycleStart = new Date(c.startTime);
    const matchesDateRange = cycleStart >= start && cycleStart <= end;
    const matchesPrinter = !printerId || c.printerId === printerId;
    return matchesDateRange && matchesPrinter;
  });
}

/**
 * Check if a cycle requires overnight (outside work hours)
 */
export function isOvernightCycle(cycle: PlannedCycle): boolean {
  const settings = getFactorySettings();
  if (!settings) return false;
  
  const cycleStart = new Date(cycle.startTime);
  const cycleEnd = new Date(cycle.endTime);
  const overrides = getTemporaryOverrides();
  
  // Check if end time is outside work hours
  const daySchedule = getDayScheduleForDate(cycleEnd, settings, overrides);
  if (!daySchedule || !daySchedule.enabled) {
    return true; // Running on a non-work day
  }
  
  const [endHour, endMin] = daySchedule.endTime.split(':').map(Number);
  const workEndMinutes = endHour * 60 + endMin;
  const cycleEndMinutes = cycleEnd.getHours() * 60 + cycleEnd.getMinutes();
  
  return cycleEndMinutes > workEndMinutes;
}

/**
 * Check if a cycle crosses project deadline
 */
export function crossesDeadline(cycle: PlannedCycle, project: Project | undefined): boolean {
  if (!project?.dueDate) return false;
  
  const cycleEnd = new Date(cycle.endTime);
  const dueDate = new Date(project.dueDate);
  dueDate.setHours(23, 59, 59, 999); // End of due date
  
  return cycleEnd > dueDate;
}

/**
 * Get cycle with all details for display
 */
export function getCycleWithDetails(cycle: PlannedCycle): CycleWithDetails {
  const projects = getProjects();
  const printers = getPrinters();
  
  const project = projects.find(p => p.id === cycle.projectId);
  const printer = printers.find(p => p.id === cycle.printerId);
  
  return {
    ...cycle,
    projectName: project?.name || 'Unknown Project',
    printerName: printer?.name || 'Unknown Printer',
    color: project?.color || cycle.requiredColor || '',
    risk: {
      crossesDeadline: crossesDeadline(cycle, project),
      requiresOvernight: isOvernightCycle(cycle),
      isRecovery: !!project?.parentProjectId,
      projectDueDate: project?.dueDate,
    },
  };
}

// ============= PROJECT COVERAGE =============

/**
 * Compute coverage for all active projects
 */
export function computeProjectCoverage(): ProjectCoverage[] {
  const projects = getProjects().filter(p => p.status !== 'completed');
  const cycles = getPlannedCycles();
  const now = new Date();
  
  // Get future planned cycles (not completed/failed)
  const futureCycles = cycles.filter(c => 
    c.status === 'planned' || c.status === 'in_progress'
  );
  
  // Group planned units by project
  const plannedByProject = new Map<string, number>();
  for (const cycle of futureCycles) {
    const current = plannedByProject.get(cycle.projectId) || 0;
    plannedByProject.set(cycle.projectId, current + cycle.unitsPlanned);
  }
  
  return projects.map(project => {
    const remainingUnits = project.quantityTarget - project.quantityGood;
    const plannedUnits = plannedByProject.get(project.id) || 0;
    const uncoveredUnits = Math.max(0, remainingUnits - plannedUnits);
    
    // Determine status
    let status: ProjectCoverage['status'] = 'on_track';
    if (uncoveredUnits > 0 && plannedUnits === 0) {
      status = 'unscheduled';
    } else if (uncoveredUnits > 0) {
      status = 'at_risk';
    }
    
    // Check if any planned cycle crosses deadline
    const projectCycles = futureCycles.filter(c => c.projectId === project.id);
    const hasCrossingCycle = projectCycles.some(c => crossesDeadline(c, project));
    if (hasCrossingCycle) {
      status = 'at_risk';
    }
    
    return {
      projectId: project.id,
      projectName: project.name,
      productName: project.productName,
      color: project.color,
      dueDate: project.dueDate,
      quantityTarget: project.quantityTarget,
      quantityGood: project.quantityGood,
      quantityScrap: project.quantityScrap,
      remainingUnits,
      plannedUnits,
      uncoveredUnits,
      status,
      isRecovery: !!project.parentProjectId,
    };
  });
}

// ============= WEEKLY STATS =============

/**
 * Compute dashboard stats for the week
 */
export function computeWeeklyStats(): WeeklyStats {
  const weekDays = getWeekRange();
  const startDate = weekDays[0].dateStr;
  const endDate = weekDays[6].dateStr;
  
  const cycles = getPlannedCyclesForWeek(startDate, endDate);
  const projects = getProjects();
  const coverage = computeProjectCoverage();
  
  // Count risk cycles
  let cyclesCrossingDeadline = 0;
  let overnightCycles = 0;
  let totalUnits = 0;
  
  for (const cycle of cycles) {
    if (cycle.status === 'completed' || cycle.status === 'failed') continue;
    
    totalUnits += cycle.unitsPlanned;
    
    const project = projects.find(p => p.id === cycle.projectId);
    if (crossesDeadline(cycle, project)) {
      cyclesCrossingDeadline++;
    }
    if (isOvernightCycle(cycle)) {
      overnightCycles++;
    }
  }
  
  // Count project statuses
  const atRiskProjects = coverage.filter(c => c.status === 'at_risk').length;
  const unscheduledProjects = coverage.filter(c => c.status === 'unscheduled').length;
  
  // Get last replan info
  const replanInfo = getLastReplanInfo();
  
  return {
    totalCycles: cycles.filter(c => c.status === 'planned' || c.status === 'in_progress').length,
    totalUnits,
    atRiskProjects,
    cyclesCrossingDeadline,
    overnightCycles,
    unscheduledProjects,
    lastReplan: replanInfo.lastReplanAt ? {
      timestamp: replanInfo.lastReplanAt,
      cyclesChanged: replanInfo.lastReplanResult?.cyclesCreated || 0,
      warnings: replanInfo.lastReplanResult?.warningsCount || 0,
      durationMs: 0, // Not tracked in current logger
    } : null,
  };
}

// ============= CYCLES BY DAY/PRINTER =============

export interface CyclesByDayAndPrinter {
  [printerId: string]: {
    [dateStr: string]: CycleWithDetails[];
  };
}

/**
 * Get cycles organized by printer and day for the grid view
 */
export function getCyclesByDayAndPrinter(): CyclesByDayAndPrinter {
  const weekDays = getWeekRange();
  const startDate = weekDays[0].dateStr;
  const endDate = weekDays[6].dateStr;
  
  const cycles = getPlannedCyclesForWeek(startDate, endDate);
  const printers = getPrinters();
  
  const result: CyclesByDayAndPrinter = {};
  
  // Initialize all printers with empty days
  for (const printer of printers) {
    result[printer.id] = {};
    for (const day of weekDays) {
      result[printer.id][day.dateStr] = [];
    }
  }
  
  // Populate with cycles
  for (const cycle of cycles) {
    const cycleDate = new Date(cycle.startTime).toISOString().split('T')[0];
    const cycleWithDetails = getCycleWithDetails(cycle);
    
    if (result[cycle.printerId] && result[cycle.printerId][cycleDate]) {
      result[cycle.printerId][cycleDate].push(cycleWithDetails);
    }
  }
  
  // Sort cycles within each day by start time
  for (const printerId in result) {
    for (const dateStr in result[printerId]) {
      result[printerId][dateStr].sort((a, b) => 
        new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
      );
    }
  }
  
  return result;
}
