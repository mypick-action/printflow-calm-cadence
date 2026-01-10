// ============= GRAMS CALCULATOR =============
// Single source of truth for gramsPlanned calculation
// All other code should use this function instead of calculating gramsPlanned directly

import { Product, PlatePreset } from './storage';

// ============= TYPES =============

export interface GramsCalculationParams {
  unitsPlanned: number;
  presetId?: string;
  productId?: string;
  projectId?: string;
}

export interface GramsCalculationResult {
  gramsPlanned: number;
  source: 'preset' | 'product' | 'fallback';
  gramsPerUnit: number;
}

// ============= CONSTANTS =============

// Default grams per unit if no product/preset found
const DEFAULT_GRAMS_PER_UNIT = 10;

// ============= MAIN FUNCTION =============

/**
 * Calculate gramsPlanned for a cycle.
 * 
 * Priority order:
 * 1. Preset gramsPerUnit (if preset found) - most accurate for specific preset
 * 2. Product gramsPerUnit (if product found) - fallback to product default
 * 3. Default value (10g) - last resort fallback
 * 
 * @param params - Parameters for calculation
 * @param products - Array of products to search
 * @param presets - Array of presets to search
 * @returns GramsCalculationResult with gramsPlanned, source, and gramsPerUnit
 */
export function getGramsForCycle(
  params: GramsCalculationParams,
  products: Product[],
  presets: PlatePreset[]
): GramsCalculationResult {
  const { unitsPlanned, presetId, productId } = params;
  
  // Ensure unitsPlanned is valid
  const units = Math.max(1, unitsPlanned || 1);
  
  // Try preset first (most accurate) - check if preset has its own grams_per_unit
  if (presetId) {
    const preset = presets.find(p => p.id === presetId);
    if (preset) {
      // Check if preset has grams_per_unit defined (from cloud DB)
      // Note: PlatePreset in local storage may have this from cloud sync
      const presetGramsPerUnit = (preset as any).gramsPerUnit ?? (preset as any).grams_per_unit;
      
      if (presetGramsPerUnit && presetGramsPerUnit > 0) {
        return {
          gramsPlanned: presetGramsPerUnit * units,
          source: 'preset',
          gramsPerUnit: presetGramsPerUnit,
        };
      }
      
      // Fallback: Find product that owns this preset
      const product = products.find(p => 
        p.platePresets?.some(pp => pp.id === presetId)
      );
      
      if (product) {
        return {
          gramsPlanned: product.gramsPerUnit * units,
          source: 'product',
          gramsPerUnit: product.gramsPerUnit,
        };
      }
    }
  }
  
  // Try product fallback
  if (productId) {
    const product = products.find(p => p.id === productId);
    if (product) {
      return {
        gramsPlanned: product.gramsPerUnit * units,
        source: 'product',
        gramsPerUnit: product.gramsPerUnit,
      };
    }
  }
  
  // Last resort: default value
  return {
    gramsPlanned: DEFAULT_GRAMS_PER_UNIT * units,
    source: 'fallback',
    gramsPerUnit: DEFAULT_GRAMS_PER_UNIT,
  };
}

/**
 * Simplified version for quick calculations when you have direct product reference
 * 
 * @param product - Product with gramsPerUnit
 * @param unitsPlanned - Number of units
 * @returns gramsPlanned number
 */
export function getGramsForCycleSimple(
  product: Product | null | undefined,
  unitsPlanned: number
): number {
  const units = Math.max(1, unitsPlanned || 1);
  const gramsPerUnit = product?.gramsPerUnit ?? DEFAULT_GRAMS_PER_UNIT;
  return gramsPerUnit * units;
}

/**
 * Calculate total grams for a sequence of cycles
 * 
 * @param cycles - Array of { unitsPlanned, presetId?, productId? }
 * @param products - Array of products
 * @param presets - Array of presets
 * @returns Total grams for all cycles
 */
export function getTotalGramsForSequence(
  cycles: Array<{ unitsPlanned: number; presetId?: string; productId?: string }>,
  products: Product[],
  presets: PlatePreset[]
): number {
  return cycles.reduce((total, cycle) => {
    const result = getGramsForCycle(
      { unitsPlanned: cycle.unitsPlanned, presetId: cycle.presetId, productId: cycle.productId },
      products,
      presets
    );
    return total + result.gramsPlanned;
  }, 0);
}
