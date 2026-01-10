// ============= NIGHT PRELOAD CALCULATOR =============
// Calculates how many plates each printer needs preloaded for night cycles.
// This is a PLANNING DECISION, not a hardware property.

import {
  PlannedCycle,
  Printer,
  FactorySettings,
  getPlannedCycles,
  getPrinters,
  getFactorySettings,
} from './storage';
import { getNightWindow, NightWindow } from './schedulingHelpers';

// ============= TYPES =============

export interface NightPreloadPlan {
  printerId: string;
  printerName: string;
  requiredPlates: number;
  nightCycleCount: number;
  totalNightHours: number;
  nightWindow: NightWindow;
  // Cycle details for the operator
  cycles: Array<{
    projectName: string;
    cycleHours: number;
    color: string;
  }>;
}

export interface NightPreloadSummary {
  date: Date;
  printers: NightPreloadPlan[];
  totalPlatesNeeded: number;
  hasNightWork: boolean;
}

// ============= CORE CALCULATOR =============

/**
 * Calculate how many plates need to be preloaded for each printer tonight.
 * This is called at end of workday to tell the operator what to prepare.
 * 
 * Logic:
 * - Count planned night cycles per printer
 * - Each cycle = 1 plate needed
 * - Capped by physicalPlateCapacity (can't preload more than printer can hold)
 * - Returns 0 for printers with no night cycles
 */
export function calculateNightPreload(
  forDate: Date,
  cycles?: PlannedCycle[],
  printers?: Printer[],
  settings?: FactorySettings
): NightPreloadSummary {
  const allCycles = cycles ?? getPlannedCycles();
  const allPrinters = printers ?? getPrinters().filter(p => p.status === 'active');
  const factorySettings = settings ?? getFactorySettings();

  if (!factorySettings) {
    return {
      date: forDate,
      printers: [],
      totalPlatesNeeded: 0,
      hasNightWork: false,
    };
  }

  // Get the night window for this date
  const nightWindow = getNightWindow(forDate, factorySettings);
  
  // If no night work allowed, return empty
  if (nightWindow.mode === 'none') {
    return {
      date: forDate,
      printers: [],
      totalPlatesNeeded: 0,
      hasNightWork: false,
    };
  }

  // Find all cycles that will run in tonight's night window
  const nightStart = nightWindow.start;
  const nightEnd = nightWindow.end;
  
  const nightCycles = allCycles.filter(cycle => {
    if (!cycle.startTime) return false;
    const startTime = new Date(cycle.startTime);
    // Cycle is a night cycle if it starts within the night window
    return startTime >= nightStart && startTime < nightEnd;
  });

  // Group by printer
  const byPrinter = new Map<string, PlannedCycle[]>();
  nightCycles.forEach(cycle => {
    const list = byPrinter.get(cycle.printerId) || [];
    list.push(cycle);
    byPrinter.set(cycle.printerId, list);
  });

  // Calculate preload for each printer
  const printerPlans: NightPreloadPlan[] = [];
  let totalPlatesNeeded = 0;

  allPrinters.forEach(printer => {
    const printerCycles = byPrinter.get(printer.id) || [];
    
    if (printerCycles.length === 0) {
      // No night cycles for this printer
      return;
    }

    // Each cycle needs 1 plate
    // Cap by physical capacity (can't preload more than printer can hold)
    const capacity = printer.physicalPlateCapacity ?? 5;
    const requiredPlates = Math.min(printerCycles.length, capacity);

    // Calculate total night hours for this printer
    const totalHours = printerCycles.reduce((sum, c) => {
      // Try to get cycle hours from the cycle or estimate from start/end times
      if (c.startTime && c.endTime) {
        const start = new Date(c.startTime);
        const end = new Date(c.endTime);
        return sum + (end.getTime() - start.getTime()) / (1000 * 60 * 60);
      }
      return sum + 3; // Default estimate
    }, 0);

    // Build cycle details for operator display
    const cycleDetails = printerCycles.map(cycle => {
      let cycleHours = 3; // Default
      if (cycle.startTime && cycle.endTime) {
        const start = new Date(cycle.startTime);
        const end = new Date(cycle.endTime);
        cycleHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
      }
      return {
        projectName: cycle.projectId, // Will be resolved to name in UI
        cycleHours,
        color: '', // Will be resolved from project in UI
      };
    });

    printerPlans.push({
      printerId: printer.id,
      printerName: printer.name,
      requiredPlates,
      nightCycleCount: printerCycles.length,
      totalNightHours: totalHours,
      nightWindow,
      cycles: cycleDetails,
    });

    totalPlatesNeeded += requiredPlates;
  });

  return {
    date: forDate,
    printers: printerPlans,
    totalPlatesNeeded,
    hasNightWork: printerPlans.length > 0,
  };
}

/**
 * Get the preload count for a specific printer tonight.
 * Used by the planning engine when setting up night slots.
 */
export function getPreloadForPrinter(
  printerId: string,
  forDate: Date,
  allCycles?: PlannedCycle[],
  settings?: FactorySettings
): number {
  const summary = calculateNightPreload(forDate, allCycles, undefined, settings);
  const plan = summary.printers.find(p => p.printerId === printerId);
  return plan?.requiredPlates ?? 0;
}

/**
 * Check if the night window has already been calculated for today.
 * Used to avoid recalculating during the planning phase.
 */
export function isNightPreloadTime(settings: FactorySettings): boolean {
  const now = new Date();
  const nightWindow = getNightWindow(now, settings);
  
  // We're in "preload time" if:
  // - Night mode is enabled (not 'none')
  // - Current time is within 2 hours of night start, OR already in night window
  const hoursUntilNight = (nightWindow.start.getTime() - now.getTime()) / (1000 * 60 * 60);
  
  return nightWindow.mode !== 'none' && (hoursUntilNight <= 2 || now >= nightWindow.start);
}
