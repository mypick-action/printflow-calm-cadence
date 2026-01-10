// ============= NIGHT PRELOAD CALCULATOR =============
// Calculates how many plates each printer needs preloaded for night cycles.
// This is a PLANNING DECISION, not a hardware property.
//
// KEY CONSTRAINTS:
// 1. Per-printer hardware limit: physicalPlateCapacity (FIXED at 8)
// 2. Global factory limit: globalPlateInventory (default 50)
// 3. The sum of all allocations cannot exceed global inventory
// 4. Uses round-robin allocation for fairness across printers
//
// CRITICAL: Two-Pass Architecture
// - This calculator should receive CANDIDATE cycles from the planner
// - It does NOT read from storage (avoids chicken-and-egg problem)
// - Only cycles that PASS night eligibility checks count toward demand:
//   - Color matches physicalLockedColor (for non-AMS printers)
//   - Material is available
//   - Fits within night window
//   - Preset allows night cycle

import {
  PlannedCycle,
  Printer,
  FactorySettings,
  getPlannedCycles,
  getPrinters,
  getFactorySettings,
} from './storage';
import { getNightWindow, NightWindow } from './schedulingHelpers';
import { normalizeColor } from './colorNormalization';

// ============= TYPES =============

// Candidate night cycle (from planner, not storage)
export interface NightCycleCandidate {
  projectId: string;
  projectName: string;
  printerId: string;
  color: string;
  cycleHours: number;
  gramsNeeded: number;
  startTime: Date;
  endTime: Date;
  isEligible: boolean;  // Passed all night eligibility checks
  ineligibilityReason?: string;
}

export interface NightPreloadPlan {
  printerId: string;
  printerName: string;
  // Demand: how many ELIGIBLE cycles are planned for this printer tonight
  demandPlates: number;
  // Allocated: how many plates actually assigned (respects global limit)
  allocatedPlates: number;
  // Deferred: how many cycles could not be scheduled due to plate shortage
  deferredCycles: number;
  nightCycleCount: number;
  totalNightHours: number;
  nightWindow: NightWindow;
  // Color lock info for non-AMS printers
  physicalLockedColor?: string;
  hasAMS: boolean;
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
  // Totals
  totalPlatesNeeded: number;  // Sum of all demands (ELIGIBLE cycles only)
  totalPlatesAllocated: number;  // Sum of all allocations (respects global limit)
  totalCyclesDeferred: number;  // Cycles pushed to next day due to plate shortage
  // Global constraint info
  globalPlateInventory: number;
  globalPlateCapacity: number;  // Sum of all printer capacities
  hasNightWork: boolean;
  // Constraint warnings
  isGloballyConstrained: boolean;  // True if global limit caused deferrals
}

// Default global plate inventory
const DEFAULT_GLOBAL_PLATE_INVENTORY = 50;
// FIXED hardware capacity per printer - this is physical, not configurable
const FIXED_PLATE_CAPACITY_PER_PRINTER = 8;

// ============= ROUND-ROBIN ALLOCATION =============

/**
 * Allocate plates using round-robin algorithm.
 * This ensures fair distribution across printers when global inventory is limited.
 * 
 * @param demands - Map of printerId to number of plates demanded
 * @param capacities - Map of printerId to hardware capacity limit
 * @param globalLimit - Total plates available across all printers
 * @returns Map of printerId to allocated plates
 */
function allocatePlatesRoundRobin(
  demands: Map<string, number>,
  capacities: Map<string, number>,
  globalLimit: number
): Map<string, number> {
  const allocations = new Map<string, number>();
  const printerIds = Array.from(demands.keys());
  
  // Initialize all allocations to 0
  printerIds.forEach(id => allocations.set(id, 0));
  
  let totalAllocated = 0;
  let changed = true;
  
  // Round-robin: give each printer 1 plate per round until done
  while (changed && totalAllocated < globalLimit) {
    changed = false;
    
    for (const printerId of printerIds) {
      if (totalAllocated >= globalLimit) break;
      
      const demand = demands.get(printerId) ?? 0;
      const capacity = capacities.get(printerId) ?? FIXED_PLATE_CAPACITY_PER_PRINTER;
      const current = allocations.get(printerId) ?? 0;
      
      // Can we give this printer one more plate?
      if (current < demand && current < capacity) {
        allocations.set(printerId, current + 1);
        totalAllocated++;
        changed = true;
      }
    }
  }
  
  return allocations;
}

// ============= CORE CALCULATOR =============

/**
 * Calculate how many plates need to be preloaded for each printer tonight.
 * This is called at end of workday to tell the operator what to prepare.
 * 
 * Logic:
 * - Count planned night cycles per printer (DEMAND)
 * - Apply round-robin allocation respecting:
 *   - Per-printer hardware limit (physicalPlateCapacity)
 *   - Global factory limit (globalPlateInventory)
 * - Returns allocation for each printer + deferred cycles count
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

  const globalPlateInventory = factorySettings?.globalPlateInventory ?? DEFAULT_GLOBAL_PLATE_INVENTORY;

  if (!factorySettings) {
    return {
      date: forDate,
      printers: [],
      totalPlatesNeeded: 0,
      totalPlatesAllocated: 0,
      totalCyclesDeferred: 0,
      globalPlateInventory,
      globalPlateCapacity: 0,
      hasNightWork: false,
      isGloballyConstrained: false,
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
      totalPlatesAllocated: 0,
      totalCyclesDeferred: 0,
      globalPlateInventory,
      globalPlateCapacity: allPrinters.reduce((sum, p) => sum + FIXED_PLATE_CAPACITY_PER_PRINTER, 0),
      hasNightWork: false,
      isGloballyConstrained: false,
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

  // Build demand and capacity maps
  const demands = new Map<string, number>();
  const capacities = new Map<string, number>();
  const printerMap = new Map<string, Printer>();
  
  allPrinters.forEach(printer => {
    const printerCycles = byPrinter.get(printer.id) || [];
    const demand = printerCycles.length;
    const capacity = FIXED_PLATE_CAPACITY_PER_PRINTER; // Fixed hardware limit
    
    if (demand > 0) {
      demands.set(printer.id, demand);
      capacities.set(printer.id, capacity);
      printerMap.set(printer.id, printer);
    }
  });

  // Allocate plates using round-robin with global constraint
  const allocations = allocatePlatesRoundRobin(demands, capacities, globalPlateInventory);

  // Calculate global capacity (sum of all hardware limits)
  const globalPlateCapacity = allPrinters.reduce(
    (sum, p) => sum + FIXED_PLATE_CAPACITY_PER_PRINTER, 
    0
  );

  // Build printer plans
  const printerPlans: NightPreloadPlan[] = [];
  let totalPlatesNeeded = 0;
  let totalPlatesAllocated = 0;
  let totalCyclesDeferred = 0;

  allPrinters.forEach(printer => {
    const printerCycles = byPrinter.get(printer.id) || [];
    
    if (printerCycles.length === 0) {
      // No night cycles for this printer
      return;
    }

    const demand = printerCycles.length;
    const allocated = allocations.get(printer.id) ?? 0;
    const deferred = demand - allocated;

    // Calculate total night hours for this printer
    const totalHours = printerCycles.slice(0, allocated).reduce((sum, c) => {
      if (c.startTime && c.endTime) {
        const start = new Date(c.startTime);
        const end = new Date(c.endTime);
        return sum + (end.getTime() - start.getTime()) / (1000 * 60 * 60);
      }
      return sum + 3; // Default estimate
    }, 0);

    // Build cycle details for operator display (only allocated cycles)
    const cycleDetails = printerCycles.slice(0, allocated).map(cycle => {
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
      demandPlates: demand,
      allocatedPlates: allocated,
      deferredCycles: deferred,
      nightCycleCount: allocated,  // Only the ones that will actually run
      totalNightHours: totalHours,
      nightWindow,
      physicalLockedColor: printer.mountedColor ?? printer.currentColor,
      hasAMS: printer.hasAMS === true,
      cycles: cycleDetails,
    });

    totalPlatesNeeded += demand;
    totalPlatesAllocated += allocated;
    totalCyclesDeferred += deferred;
  });

  // Debug log for allocation
  console.log('[NightPreload] 📦 Plate allocation calculated:', {
    date: forDate.toISOString(),
    globalPlateInventory,
    globalPlateCapacity,
    totalDemand: totalPlatesNeeded,
    totalAllocated: totalPlatesAllocated,
    totalDeferred: totalCyclesDeferred,
    isGloballyConstrained: totalPlatesNeeded > globalPlateInventory,
    printers: printerPlans.map(p => ({
      name: p.printerName,
      demand: p.demandPlates,
      allocated: p.allocatedPlates,
      deferred: p.deferredCycles,
      lockedColor: p.physicalLockedColor,
    })),
  });

  return {
    date: forDate,
    printers: printerPlans,
    totalPlatesNeeded,
    totalPlatesAllocated,
    totalCyclesDeferred,
    globalPlateInventory,
    globalPlateCapacity,
    hasNightWork: printerPlans.length > 0,
    isGloballyConstrained: totalPlatesNeeded > globalPlateInventory,
  };
}

/**
 * Get the preload count for a specific printer tonight.
 * Returns the ALLOCATED amount (not demand), respecting global limit.
 */
export function getPreloadForPrinter(
  printerId: string,
  forDate: Date,
  allCycles?: PlannedCycle[],
  settings?: FactorySettings
): number {
  const summary = calculateNightPreload(forDate, allCycles, undefined, settings);
  const plan = summary.printers.find(p => p.printerId === printerId);
  return plan?.allocatedPlates ?? 0;
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

// ============= TWO-PASS ALLOCATION SYSTEM =============
// This is called at the START of planning, before any cycles are created.
// It calculates how many plates each printer CAN use tonight based on:
// 1. Night window duration (how many ~3h cycles fit)
// 2. Color lock constraints (for non-AMS printers)
// 3. Global plate inventory limit (50)
// 4. Hardware capacity per printer (8)

export interface NightAllocationInput {
  printerId: string;
  printerName: string;
  hasAMS: boolean;
  physicalLockedColor?: string;  // The color locked on the printer (for non-AMS)
  canStartNewCyclesAfterHours: boolean;
}

export interface NightAllocationResult {
  allocations: Map<string, number>;  // printerId -> allocated plates
  totalAllocated: number;
  globalLimit: number;
  isConstrained: boolean;
  details: Array<{
    printerId: string;
    printerName: string;
    maxPossible: number;  // Based on time window
    allocated: number;
    physicalLockedColor?: string;
  }>;
}

/**
 * Pre-calculate night plate allocations at the START of planning.
 * This avoids chicken-and-egg: we estimate demand BEFORE cycles exist.
 * 
 * For each printer:
 * - If canStartNewCyclesAfterHours is false → 0 plates
 * - Otherwise, estimate cycles that fit in night window (~3h each)
 * - Cap at hardware limit (8 per printer)
 * - Distribute using round-robin to respect global limit (50)
 * 
 * @param forDate The date for which to calculate
 * @param printerInputs Array of printer info with color locks
 * @param settings Factory settings with global inventory
 */
export function preCalculateNightAllocations(
  forDate: Date,
  printerInputs: NightAllocationInput[],
  settings: FactorySettings
): NightAllocationResult {
  const globalPlateInventory = settings.globalPlateInventory ?? DEFAULT_GLOBAL_PLATE_INVENTORY;
  const nightWindow = getNightWindow(forDate, settings);
  
  // If no night work allowed, return empty allocations
  if (nightWindow.mode === 'none') {
    return {
      allocations: new Map(),
      totalAllocated: 0,
      globalLimit: globalPlateInventory,
      isConstrained: false,
      details: [],
    };
  }
  
  // Estimate how many cycles fit in the night window
  // Assume average cycle is ~3 hours
  const AVG_CYCLE_HOURS = 3;
  const maxCyclesFromTime = Math.floor(nightWindow.totalHours / AVG_CYCLE_HOURS);
  
  // Build demand map: each eligible printer's max possible cycles
  const demands = new Map<string, number>();
  const capacities = new Map<string, number>();
  const printerDetails = new Map<string, { name: string; maxPossible: number; lockedColor?: string }>();
  
  for (const input of printerInputs) {
    // Check if printer can run at night
    if (!input.canStartNewCyclesAfterHours) {
      printerDetails.set(input.printerId, { 
        name: input.printerName, 
        maxPossible: 0,
        lockedColor: input.physicalLockedColor,
      });
      continue;
    }
    
    // Calculate max possible plates for this printer
    // Limited by: time window AND hardware capacity
    const maxPossible = Math.min(maxCyclesFromTime, FIXED_PLATE_CAPACITY_PER_PRINTER);
    
    if (maxPossible > 0) {
      demands.set(input.printerId, maxPossible);
      capacities.set(input.printerId, FIXED_PLATE_CAPACITY_PER_PRINTER);
    }
    
    printerDetails.set(input.printerId, { 
      name: input.printerName, 
      maxPossible,
      lockedColor: input.physicalLockedColor,
    });
  }
  
  // Allocate using round-robin with global constraint
  const allocations = allocatePlatesRoundRobin(demands, capacities, globalPlateInventory);
  
  // Calculate totals
  let totalAllocated = 0;
  for (const alloc of allocations.values()) {
    totalAllocated += alloc;
  }
  
  // Build details array
  const details = printerInputs.map(input => {
    const detail = printerDetails.get(input.printerId);
    return {
      printerId: input.printerId,
      printerName: input.printerName,
      maxPossible: detail?.maxPossible ?? 0,
      allocated: allocations.get(input.printerId) ?? 0,
      physicalLockedColor: input.physicalLockedColor,
    };
  });
  
  console.log('[NightPreload] 📊 Pre-calculated night allocations:', {
    date: forDate.toISOString(),
    nightWindow: `${nightWindow.start.toISOString()} - ${nightWindow.end.toISOString()}`,
    nightHours: nightWindow.totalHours.toFixed(1),
    maxCyclesFromTime,
    globalPlateInventory,
    totalAllocated,
    isConstrained: totalAllocated >= globalPlateInventory,
    printers: details.map(d => ({
      name: d.printerName,
      maxPossible: d.maxPossible,
      allocated: d.allocated,
      lockedColor: d.physicalLockedColor ?? 'none',
    })),
  });
  
  return {
    allocations,
    totalAllocated,
    globalLimit: globalPlateInventory,
    isConstrained: totalAllocated >= globalPlateInventory,
    details,
  };
}

/**
 * Get allocation summary for dashboard display.
 * Shows what happened with global constraint.
 */
export function getAllocationSummary(
  forDate: Date,
  cycles?: PlannedCycle[],
  printers?: Printer[],
  settings?: FactorySettings
): {
  globalInventory: number;
  totalDemand: number;
  totalAllocated: number;
  utilizationPercent: number;
  isConstrained: boolean;
  constraintMessage?: string;
} {
  const summary = calculateNightPreload(forDate, cycles, printers, settings);
  
  const utilizationPercent = summary.globalPlateInventory > 0 
    ? Math.round((summary.totalPlatesAllocated / summary.globalPlateInventory) * 100)
    : 0;
  
  let constraintMessage: string | undefined;
  if (summary.isGloballyConstrained) {
    constraintMessage = `מגבלת פלטות גלובלית: ${summary.totalCyclesDeferred} מחזורים נדחו ליום הבא`;
  }
  
  return {
    globalInventory: summary.globalPlateInventory,
    totalDemand: summary.totalPlatesNeeded,
    totalAllocated: summary.totalPlatesAllocated,
    utilizationPercent,
    isConstrained: summary.isGloballyConstrained,
    constraintMessage,
  };
}
