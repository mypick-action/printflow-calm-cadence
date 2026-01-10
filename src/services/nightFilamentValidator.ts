// ============= NIGHT FILAMENT VALIDATOR =============
// Hard gate validation for night/after-hours filament requirements
// Ensures no night cycles are planned without sufficient filament

import { PlannedCycle, ColorInventoryItem, FactorySettings, getTotalGrams } from './storage';
import { NightWindow } from './schedulingHelpers';

// ============= TYPES =============

export interface NightValidationResult {
  canPlanNight: boolean;       // Hard gate - yes or no
  reason: string;              // Why yes/no (for logging/UI)
  gramsRequired: number;       // Total grams needed for night sequence
  gramsAvailable: number;      // Total grams in inventory for color
  bufferGrams: number;         // Safety buffer applied
  shortfall: number;           // 0 if valid, positive if short
  mode: 'none' | 'one_cycle' | 'full';  // Night mode from settings
}

// ============= CONSTANTS =============

// Fixed buffer for one_cycle mode (single cycle after work hours)
const ONE_CYCLE_BUFFER_GRAMS = 50;

// Minimum buffer for full automation mode
const FULL_MODE_MIN_BUFFER_GRAMS = 100;

// Buffer percentage for full automation mode
const FULL_MODE_BUFFER_PERCENT = 0.10; // 10%

// ============= MAIN VALIDATION FUNCTION =============

/**
 * Validate if night cycles can be planned based on filament availability.
 * This is a HARD GATE - if it fails, no night cycles should be planned.
 * 
 * Behavior by mode:
 * - 'none': No night cycles allowed at all
 * - 'one_cycle': Only validates first cycle with fixed 50g buffer
 * - 'full': Validates sum of all night cycles with max(10%, 100g) buffer
 */
export function validateNightFilamentBudget(
  plannedNightCycles: PlannedCycle[],
  colorInventory: ColorInventoryItem | null,
  nightWindow: NightWindow,
  settings: FactorySettings
): NightValidationResult {
  const mode = nightWindow.mode;
  
  // Get available grams from inventory using helper
  const gramsAvailable = colorInventory ? getTotalGrams(colorInventory) : 0;
  
  // MODE: NONE - No after-hours work configured
  if (mode === 'none') {
    return {
      canPlanNight: false,
      reason: 'no_after_hours_configured',
      gramsRequired: 0,
      gramsAvailable,
      bufferGrams: 0,
      shortfall: 0,
      mode,
    };
  }
  
  // No cycles to validate = night is "valid" (nothing to plan)
  if (!plannedNightCycles || plannedNightCycles.length === 0) {
    return {
      canPlanNight: true,
      reason: 'no_cycles_to_validate',
      gramsRequired: 0,
      gramsAvailable,
      bufferGrams: 0,
      shortfall: 0,
      mode,
    };
  }
  
  // MODE: ONE_CYCLE - Only one cycle allowed after hours
  if (mode === 'one_cycle') {
    const firstCycle = plannedNightCycles[0];
    const singleCycleGrams = firstCycle?.gramsPlanned ?? 0;
    const buffer = ONE_CYCLE_BUFFER_GRAMS;
    const gramsRequired = singleCycleGrams + buffer;
    const canPlanNight = gramsAvailable >= gramsRequired;
    
    return {
      canPlanNight,
      reason: canPlanNight ? 'sufficient_for_one_cycle' : 'insufficient_filament_one_cycle',
      gramsRequired,
      gramsAvailable,
      bufferGrams: buffer,
      shortfall: canPlanNight ? 0 : gramsRequired - gramsAvailable,
      mode,
    };
  }
  
  // MODE: FULL - Validate entire night sequence
  const totalGrams = plannedNightCycles.reduce(
    (sum, cycle) => sum + (cycle.gramsPlanned ?? 0), 
    0
  );
  
  // Buffer = max(10%, 100g)
  const buffer = Math.max(totalGrams * FULL_MODE_BUFFER_PERCENT, FULL_MODE_MIN_BUFFER_GRAMS);
  const gramsRequired = totalGrams + buffer;
  const canPlanNight = gramsAvailable >= gramsRequired;
  
  return {
    canPlanNight,
    reason: canPlanNight ? 'sufficient_for_full_night' : 'insufficient_filament_full_night',
    gramsRequired,
    gramsAvailable,
    bufferGrams: buffer,
    shortfall: canPlanNight ? 0 : gramsRequired - gramsAvailable,
    mode,
  };
}

// ============= HELPER FUNCTIONS =============

/**
 * Check if a specific color has enough filament for a night sequence
 */
export function hasEnoughFilamentForNight(
  color: string,
  totalUnits: number,
  gramsPerUnit: number,
  colorInventory: ColorInventoryItem | null,
  mode: 'none' | 'one_cycle' | 'full'
): boolean {
  if (mode === 'none') return false;
  
  const gramsAvailable = colorInventory ? getTotalGrams(colorInventory) : 0;
  const totalGrams = totalUnits * gramsPerUnit;
  
  if (mode === 'one_cycle') {
    return gramsAvailable >= totalGrams + ONE_CYCLE_BUFFER_GRAMS;
  }
  
  // Full mode
  const buffer = Math.max(totalGrams * FULL_MODE_BUFFER_PERCENT, FULL_MODE_MIN_BUFFER_GRAMS);
  return gramsAvailable >= totalGrams + buffer;
}

/**
 * Calculate how many cycles can fit in a night window given filament constraints
 */
export function maxNightCyclesForFilament(
  gramsPerCycle: number,
  gramsAvailable: number,
  mode: 'none' | 'one_cycle' | 'full'
): number {
  if (mode === 'none') return 0;
  if (mode === 'one_cycle') return 1;
  if (gramsPerCycle <= 0) return 0;
  
  let maxCycles = Math.floor(gramsAvailable / gramsPerCycle);
  
  while (maxCycles > 0) {
    const totalGrams = maxCycles * gramsPerCycle;
    const buffer = Math.max(totalGrams * FULL_MODE_BUFFER_PERCENT, FULL_MODE_MIN_BUFFER_GRAMS);
    
    if (gramsAvailable >= totalGrams + buffer) {
      return maxCycles;
    }
    maxCycles--;
  }
  
  return 0;
}
