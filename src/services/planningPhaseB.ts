// ============= PLANNING PHASE B: UTILIZATION FILL =============
// Fills available printer capacity while respecting deadline allocations and night constraints
// This phase runs AFTER Phase A to maximize utilization without violating deadlines

import { 
  PlannedCycle, 
  FactorySettings,
  ColorInventoryItem,
} from './storage';
import { 
  PrinterTimeSlot, 
  getNightWindow,
  NightWindow,
} from './schedulingHelpers';
import { DeadlineAllocation } from './planningPhaseA';
import { validateNightFilamentBudget, NightValidationResult } from './nightFilamentValidator';

// ============= TYPES =============

export interface PhaseBInput {
  allocations: DeadlineAllocation[];
  printerSlots: PrinterTimeSlot[];
  existingCycles: PlannedCycle[];
  settings: FactorySettings;
  colorInventory: Map<string, ColorInventoryItem>;
  planningStart: Date;
}

export interface PhaseBResult {
  cycles: PlannedCycle[];
  nightValidations: Map<string, NightValidationResult>;  // printerId → validation
  skippedNights: Array<{
    printerId: string;
    printerName: string;
    reason: string;
    color: string;
  }>;
  warnings: string[];
}

export interface NightCycleGroup {
  printerId: string;
  printerName: string;
  color: string;
  cycles: PlannedCycle[];
  nightWindow: NightWindow;
}

// ============= MAIN FUNCTION =============

/**
 * Phase B: Fill utilization while respecting constraints.
 * 
 * Algorithm:
 * 1. Collect all planned cycles from planning engine
 * 2. Group night cycles by printer and color
 * 3. Validate each night group with filament validator
 * 4. Remove cycles from nights that fail validation
 * 
 * This function is meant to be called AFTER the main planning engine
 * generates cycles, to apply night filament constraints.
 * 
 * @param input - PhaseBInput with cycles and constraints
 * @returns PhaseBResult with validated cycles and warnings
 */
export function phaseB_validateNightCycles(input: PhaseBInput): PhaseBResult {
  const { 
    existingCycles, 
    printerSlots, 
    settings, 
    colorInventory,
    planningStart,
  } = input;
  
  const validatedCycles: PlannedCycle[] = [];
  const nightValidations = new Map<string, NightValidationResult>();
  const skippedNights: PhaseBResult['skippedNights'] = [];
  const warnings: string[] = [];
  
  // Group cycles by printer
  const cyclesByPrinter = new Map<string, PlannedCycle[]>();
  for (const cycle of existingCycles) {
    const existing = cyclesByPrinter.get(cycle.printerId) || [];
    existing.push(cycle);
    cyclesByPrinter.set(cycle.printerId, existing);
  }
  
  // Process each printer
  for (const slot of printerSlots) {
    const printerCycles = cyclesByPrinter.get(slot.printerId) || [];
    if (printerCycles.length === 0) continue;
    
    // Separate day cycles from night cycles
    // IMPORTANT: Get night window for EACH cycle's date, not planningStart
    const dayCycles: PlannedCycle[] = [];
    const nightCyclesByDate = new Map<string, PlannedCycle[]>();
    
    for (const cycle of printerCycles) {
      if (!cycle.startTime) {
        dayCycles.push(cycle);
        continue;
      }
      
      const startTime = new Date(cycle.startTime);
      const cycleDate = new Date(startTime);
      cycleDate.setHours(0, 0, 0, 0);
      const dateKey = cycleDate.toISOString().split('T')[0];
      
      // Get night window for THIS cycle's date (not planningStart)
      const nightWindow = getNightWindow(cycleDate, settings);
      
      // Check if cycle starts during night window
      if (nightWindow && isInNightWindow(startTime, nightWindow)) {
        const existing = nightCyclesByDate.get(dateKey) || [];
        existing.push(cycle);
        nightCyclesByDate.set(dateKey, existing);
      } else {
        dayCycles.push(cycle);
      }
    }
    
    // Always keep day cycles
    validatedCycles.push(...dayCycles);
    
    // Validate night cycles for each date separately
    for (const [dateKey, nightCycles] of nightCyclesByDate) {
      if (nightCycles.length === 0) continue;
      
      // Get night window for this specific date
      const cycleDate = new Date(dateKey);
      const nightWindow = getNightWindow(cycleDate, settings);
      
      if (!nightWindow || nightWindow.mode === 'none') {
        // No night window - skip all night cycles for this date
        for (const cycle of nightCycles) {
          skippedNights.push({
            printerId: slot.printerId,
            printerName: slot.printerName,
            reason: 'no_night_mode',
            color: cycle.requiredColor || '',
          });
        }
        continue;
      }
      
      // Get color from first night cycle
      const nightColor = nightCycles[0].requiredColor || '';
      const inventory = colorInventory.get(nightColor) || null;
      
      // Apply night mode constraint for ONE_CYCLE_END_OF_DAY
      let cyclesToValidate = nightCycles;
      if (nightWindow.mode === 'one_cycle' && nightCycles.length > 1) {
        cyclesToValidate = [nightCycles[0]];
        warnings.push(
          `Printer ${slot.printerName} (${dateKey}): Limited to 1 night cycle (ONE_CYCLE_END_OF_DAY mode)`
        );
      }
      
      // Validate filament
      const validation = validateNightFilamentBudget(
        cyclesToValidate,
        inventory,
        nightWindow,
        settings
      );
      
      nightValidations.set(`${slot.printerId}_${dateKey}`, validation);
      
      if (validation.canPlanNight) {
        validatedCycles.push(...cyclesToValidate);
        
        if (cyclesToValidate.length < nightCycles.length) {
          for (let i = 1; i < nightCycles.length; i++) {
            skippedNights.push({
              printerId: slot.printerId,
              printerName: slot.printerName,
              reason: 'one_cycle_mode_limit',
              color: nightColor,
            });
          }
        }
      } else {
        for (const cycle of nightCycles) {
          skippedNights.push({
            printerId: slot.printerId,
            printerName: slot.printerName,
            reason: validation.reason,
            color: nightColor,
          });
        }
        
        warnings.push(
          `Printer ${slot.printerName} (${dateKey}): Night cycles skipped - ${validation.reason} ` +
          `(need ${validation.gramsRequired}g, have ${validation.gramsAvailable}g)`
        );
      }
    }
  }
  
  return {
    cycles: validatedCycles,
    nightValidations,
    skippedNights,
    warnings,
  };
}

// ============= HELPER FUNCTIONS =============

/**
 * Check if a time falls within a night window
 */
function isInNightWindow(time: Date, nightWindow: NightWindow): boolean {
  return time >= nightWindow.start && time < nightWindow.end;
}

/**
 * Get the dominant color for a printer's night cycles
 * (For color batching - all night cycles should be same color)
 */
export function getNightColor(cycles: PlannedCycle[]): string | null {
  if (cycles.length === 0) return null;
  
  // Count colors
  const colorCounts = new Map<string, number>();
  for (const cycle of cycles) {
    const color = cycle.requiredColor || '';
    colorCounts.set(color, (colorCounts.get(color) || 0) + 1);
  }
  
  // Return most common color
  let maxCount = 0;
  let maxColor: string | null = null;
  for (const [color, count] of colorCounts) {
    if (count > maxCount) {
      maxCount = count;
      maxColor = color;
    }
  }
  
  return maxColor;
}

/**
 * Filter cycles to only include those matching a specific color
 * (For enforcing single color per night)
 */
export function filterByColor(cycles: PlannedCycle[], color: string): PlannedCycle[] {
  return cycles.filter(c => (c.requiredColor || '') === color);
}
