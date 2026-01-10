/**
 * Weekly Planning Service
 * Provides utilities for weekly planning view and dashboard calculations
 */

import { 
  getPlannedCycles, 
  getProjectsSync, 
  getFactorySettings, 
  getPrinters,
  findProjectById,
  PlannedCycle, 
  Project,
  getDayScheduleForDate,
  getTemporaryOverrides
} from './storage';
import { getLastReplanInfo } from './planningLogger';
import { formatDateStringLocal } from './dateUtils';

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
  plannedUnits: number; // sum of units in future planned + in_progress cycles
  plannedUnitsOnly: number; // only planned status cycles
  inProgressUnits: number; // only in_progress status cycles
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
      dateStr: formatDateStringLocal(date),
      dayName: DAY_NAMES_EN[dayOfWeek],
      dayNameHe: DAY_NAMES_HE[dayOfWeek],
      isToday: formatDateStringLocal(date) === formatDateStringLocal(today),
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
 * Checks both start and end times, and both days
 */
export function isOvernightCycle(cycle: PlannedCycle): boolean {
  const settings = getFactorySettings();
  if (!settings) return false;
  
  const cycleStart = new Date(cycle.startTime);
  const cycleEnd = new Date(cycle.endTime);
  const overrides = getTemporaryOverrides();
  
  // Check if start day is a non-work day
  const startDaySchedule = getDayScheduleForDate(cycleStart, settings, overrides);
  if (!startDaySchedule || !startDaySchedule.enabled) {
    return true; // Starting on a non-work day
  }
  
  // Check if end day is a non-work day
  const endDaySchedule = getDayScheduleForDate(cycleEnd, settings, overrides);
  if (!endDaySchedule || !endDaySchedule.enabled) {
    return true; // Ending on a non-work day
  }
  
  // Check if start time is before work start
  const [startWorkHour, startWorkMin] = startDaySchedule.startTime.split(':').map(Number);
  const workStartMinutes = startWorkHour * 60 + startWorkMin;
  const cycleStartMinutes = cycleStart.getHours() * 60 + cycleStart.getMinutes();
  if (cycleStartMinutes < workStartMinutes) {
    return true; // Starting before work hours
  }
  
  // Check if end time is after work end
  const [endWorkHour, endWorkMin] = endDaySchedule.endTime.split(':').map(Number);
  const workEndMinutes = endWorkHour * 60 + endWorkMin;
  const cycleEndMinutes = cycleEnd.getHours() * 60 + cycleEnd.getMinutes();
  if (cycleEndMinutes > workEndMinutes) {
    return true; // Ending after work hours
  }
  
  return false;
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
  const projects = getProjectsSync();
  const printers = getPrinters();
  
  const project = findProjectById(projects, cycle.projectId, cycle.projectUuid);
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
  const projects = getProjectsSync().filter(p => p.status !== 'completed');
  const cycles = getPlannedCycles();
  
  // Get future planned cycles (not completed/failed)
  const futureCycles = cycles.filter(c => 
    c.status === 'planned' || c.status === 'in_progress'
  );
  
  // Group planned units by project - separate by status
  const plannedOnlyByProject = new Map<string, number>();
  const inProgressByProject = new Map<string, number>();
  
  for (const cycle of futureCycles) {
    if (cycle.status === 'planned') {
      const current = plannedOnlyByProject.get(cycle.projectId) || 0;
      plannedOnlyByProject.set(cycle.projectId, current + cycle.unitsPlanned);
    } else if (cycle.status === 'in_progress') {
      const current = inProgressByProject.get(cycle.projectId) || 0;
      inProgressByProject.set(cycle.projectId, current + cycle.unitsPlanned);
    }
  }
  
  return projects.map(project => {
    const remainingUnits = project.quantityTarget - project.quantityGood;
    const plannedUnitsOnly = plannedOnlyByProject.get(project.id) || 0;
    const inProgressUnits = inProgressByProject.get(project.id) || 0;
    const plannedUnits = plannedUnitsOnly + inProgressUnits; // Total coverage
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
      plannedUnitsOnly,
      inProgressUnits,
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
  const projects = getProjectsSync();
  const coverage = computeProjectCoverage();
  
  // Count risk cycles
  let cyclesCrossingDeadline = 0;
  let overnightCycles = 0;
  let totalUnits = 0;
  
  for (const cycle of cycles) {
    if (cycle.status === 'completed' || cycle.status === 'failed') continue;
    
    totalUnits += cycle.unitsPlanned;
    
    const project = findProjectById(projects, cycle.projectId, cycle.projectUuid);
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

// ============= PRODUCT SUMMARY =============

export interface ProductWeeklySummary {
  productId: string;
  productName: string;
  color: string;
  material: string;
  totalUnitsPlanned: number;
  cycleCount: number;
}

/**
 * Get summary of products planned for the week
 */
export function getWeeklyProductSummary(): ProductWeeklySummary[] {
  const weekDays = getWeekRange();
  const startDate = weekDays[0].dateStr;
  const endDate = weekDays[6].dateStr;
  
  const cycles = getPlannedCyclesForWeek(startDate, endDate);
  const projects = getProjectsSync();
  
  // Group by product
  const productMap = new Map<string, ProductWeeklySummary>();
  
  for (const cycle of cycles) {
    if (cycle.status === 'completed' || cycle.status === 'failed') continue;
    
    const project = findProjectById(projects, cycle.projectId, cycle.projectUuid);
    if (!project) continue;
    
    // Use product name as key (or productId if available)
    const key = project.productId || project.productName || project.name;
    const existing = productMap.get(key);
    
    if (existing) {
      existing.totalUnitsPlanned += cycle.unitsPlanned;
      existing.cycleCount += 1;
    } else {
      productMap.set(key, {
        productId: project.productId || key,
        productName: project.productName || project.name,
        color: project.color || '',
        material: 'PLA',
        totalUnitsPlanned: cycle.unitsPlanned,
        cycleCount: 1,
      });
    }
  }
  
  // Convert to array and sort by units (descending)
  return Array.from(productMap.values())
    .sort((a, b) => b.totalUnitsPlanned - a.totalUnitsPlanned);
}

// ============= CYCLES BY DAY/PRINTER =============

export interface CyclesByDayAndPrinter {
  [printerId: string]: {
    [dateStr: string]: CycleWithDetails[];
  };
}

/**
 * Get cycles organized by printer and day for the grid view
 * IMPORTANT: Uses deduplication to prevent duplicate cycles from appearing
 */
export function getCyclesByDayAndPrinter(): CyclesByDayAndPrinter {
  const weekDays = getWeekRange();
  const startDate = weekDays[0].dateStr;
  const endDate = weekDays[6].dateStr;
  
  const allCycles = getPlannedCyclesForWeek(startDate, endDate);
  const printers = getPrinters();
  
  // DEDUPLICATION: Remove duplicate cycles by printerId + startTime
  // Priority: in_progress > planned > scheduled > completed
  const cyclesByKey = new Map<string, PlannedCycle>();
  
  for (const cycle of allCycles) {
    // Use printerId + startTime as key (ignore projectId - it can differ due to UUID/legacy mismatch)
    const key = `${cycle.printerId}-${cycle.startTime}`;
    const existing = cyclesByKey.get(key);
    
    if (!existing) {
      cyclesByKey.set(key, cycle);
    } else {
      // Priority: in_progress > planned > scheduled > other
      const statusPriority = (s: string) => {
        if (s === 'in_progress') return 0;
        if (s === 'planned') return 1;
        if (s === 'scheduled') return 2;
        return 3; // completed, failed, cancelled
      };
      
      if (statusPriority(cycle.status) < statusPriority(existing.status)) {
        console.log(`[WeeklyPlanning] Replacing ${existing.status} with ${cycle.status} for key: ${key}`);
        cyclesByKey.set(key, cycle);
      }
    }
  }
  
  const cycles = Array.from(cyclesByKey.values());
  console.log(`[WeeklyPlanning] Deduplicated: ${allCycles.length} → ${cycles.length} cycles`);
  
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
    // Use scheduledDate (business day) instead of startTime date for grid placement
    // This ensures night cycles that start at 23:00 on Saturday appear under Sunday
    const cycleDate = cycle.scheduledDate || formatDateStringLocal(new Date(cycle.startTime));
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
