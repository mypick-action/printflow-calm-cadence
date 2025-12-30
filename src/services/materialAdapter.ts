// ============= MATERIAL ADAPTER =============
// Centralized material availability layer
// Single source of truth: ColorInventory
// All material checks and consumption go through here

import {
  getColorInventory,
  getColorInventoryItem,
  getTotalGrams,
  consumeFromColorInventory,
  Project,
  getProduct,
  getProject,
  getPrinters,
  getPrinter,
  getPlannedCycles,
  getFactorySettings,
  getPrintersHoldingColor,
  getShelfOpenSpoolsFree,
} from './storage';
import { normalizeColor } from './colorNormalization';
import { parseISO, addHours } from 'date-fns';

// ============= CORE FUNCTIONS =============

/**
 * Get total available grams for a color/material combination
 * PRIMARY SOURCE: ColorInventory only
 * This is the single source of truth for all material availability checks
 */
export const getAvailableGrams = (color: string, material: string = 'PLA'): number => {
  const item = getColorInventoryItem(color, material);
  if (!item) return 0;
  return getTotalGrams(item);
};

/**
 * Get available grams by color only (sums all materials)
 * Useful when material type is not specified
 */
export const getAvailableGramsByColor = (color: string): number => {
  const inventory = getColorInventory();
  const colorKey = normalizeColor(color);
  
  return inventory
    .filter(item => normalizeColor(item.color) === colorKey)
    .reduce((sum, item) => sum + getTotalGrams(item), 0);
};

/**
 * Get open total grams for a color (not including closed spools)
 */
export const getOpenTotalGrams = (color: string, material: string = 'PLA'): number => {
  const item = getColorInventoryItem(color, material);
  if (!item) return 0;
  return item.openTotalGrams;
};

/**
 * Get the effective color key for a cycle
 * Falls back to project color if requiredColor is not set
 */
const getCycleColorKey = (cycle: { requiredColor?: string; projectId: string }): string => {
  // 1) Prefer requiredColor if exists
  if (cycle.requiredColor) return normalizeColor(cycle.requiredColor);

  // 2) Fallback to project.color
  const project = getProject(cycle.projectId);
  if (project?.color) return normalizeColor(project.color);

  // 3) Last resort: empty
  return '';
};

/**
 * Get reserved grams by color based on CYCLES (not printer estimates!)
 * This is the correct source of truth for material reservation.
 * 
 * Rules:
 * - in_progress cycles: ALWAYS count as reserved
 * - planned cycles: count only if startTime is within horizonHours
 * 
 * @param color - The color to check
 * @param horizonHours - Planning horizon (default from settings or 24h)
 */
export const getReservedGramsByColor = (color: string, horizonHours?: number): number => {
  const settings = getFactorySettings();
  const horizon = horizonHours ?? settings?.planningHorizonHours ?? 24;
  const colorKey = normalizeColor(color);
  const cycles = getPlannedCycles();
  const now = new Date();
  const horizonEnd = addHours(now, horizon);
  
  let reservedGrams = 0;
  
  for (const cycle of cycles) {
    // Get cycle color with fallback to project
    const cycleColorKey = getCycleColorKey(cycle);
    if (!cycleColorKey || cycleColorKey !== colorKey) continue;
    
    // in_progress ALWAYS counts (regardless of time)
    if (cycle.status === 'in_progress') {
      reservedGrams += cycle.gramsPlanned || 0;
      continue;
    }
    
    // planned cycles only count if within horizon
    if (cycle.status === 'planned') {
      try {
        const cycleStart = parseISO(cycle.startTime);
        if (cycleStart >= now && cycleStart <= horizonEnd) {
          reservedGrams += cycle.gramsPlanned || 0;
        }
      } catch {
        // If can't parse time, don't count it
      }
    }
  }
  
  return reservedGrams;
};

/**
 * Get grams available for allocation (after reservations)
 */
export const getGramsAvailableForAllocation = (color: string, horizonHours?: number): number => {
  const openGrams = getOpenTotalGrams(color);
  const reserved = getReservedGramsByColor(color, horizonHours);
  return Math.max(0, openGrams - reserved);
};

/**
 * Check if a printer's spool is available for new jobs
 * 
 * Rules:
 * - mountState 'reserved' or 'in_use' => NOT available
 * - in_progress cycle on printer => NOT available (regardless of time)
 * - planned cycle within horizon => NOT available
 */
export const isPrinterSpoolAvailable = (printerId: string, horizonHours?: number): boolean => {
  const printer = getPrinter(printerId);
  if (!printer || !printer.mountedColor) return false;
  
  const settings = getFactorySettings();
  const horizon = horizonHours ?? settings?.planningHorizonHours ?? 24;
  
  // If mountState is reserved or in_use - NOT available
  if (printer.mountState === 'reserved' || printer.mountState === 'in_use') {
    return false;
  }
  
  const cycles = getPlannedCycles().filter(c => c.printerId === printerId);
  const now = new Date();
  const horizonEnd = addHours(now, horizon);
  
  // in_progress cycles ALWAYS block (regardless of time)
  const hasInProgress = cycles.some(c => c.status === 'in_progress');
  if (hasInProgress) return false;
  
  // planned cycles only block if within horizon
  const hasPlannedInHorizon = cycles.some(c => {
    if (c.status !== 'planned') return false;
    try {
      const cycleStart = parseISO(c.startTime);
      return cycleStart >= now && cycleStart <= horizonEnd;
    } catch {
      return false;
    }
  });
  
  return !hasPlannedInHorizon;
};

// ============= ALLOCATION RESULT TYPES =============

export interface AllocationSuggestion {
  type: 'use_idle_printer' | 'wait_for_spool' | 'order_material';
  printerId?: string;
  message: string;
}

export interface AllocationResult {
  canAllocate: boolean;
  source: 'mounted' | 'open_spool' | 'closed_spool' | 'none';
  estimatedGrams?: number;
  blockReason?: 'no_grams' | 'no_spool' | 'waiting_for_spool';
  suggestions?: AllocationSuggestion[];
}

/**
 * Check if material can be allocated for a job
 * 
 * Priority order:
 * 1. Target printer already has this color and is available
 * 2. Open spool available on shelf
 * 3. Closed spool available to open
 * 4. Grams exist but no physical spool available => waiting_for_spool
 * 5. No grams => no_grams
 */
export const canAllocateMaterial = (
  targetPrinterId: string,
  color: string,
  gramsNeeded: number,
  horizonHours?: number
): AllocationResult => {
  const settings = getFactorySettings();
  const horizon = horizonHours ?? settings?.planningHorizonHours ?? 24;
  
  const targetPrinter = getPrinter(targetPrinterId);
  const gramsAvailable = getGramsAvailableForAllocation(color, horizon);
  const shelfSpoolsFree = getShelfOpenSpoolsFree(color);
  const item = getColorInventoryItem(color, 'PLA');
  
  // Check if enough grams exist at all
  if (gramsAvailable < gramsNeeded) {
    const shortfall = gramsNeeded - gramsAvailable;
    return { 
      canAllocate: false, 
      source: 'none',
      blockReason: 'no_grams',
      suggestions: [{ 
        type: 'order_material', 
        message: `חסרים ${shortfall}g של ${color}` 
      }]
    };
  }
  
  // Case 1: Target printer already has this color and is available
  const colorKey = normalizeColor(color);
  if (targetPrinter && 
      normalizeColor(targetPrinter.mountedColor || '') === colorKey &&
      isPrinterSpoolAvailable(targetPrinterId, horizon)) {
    return { 
      canAllocate: true, 
      source: 'mounted',
      estimatedGrams: targetPrinter.loadedGramsEstimate
    };
  }
  
  // Case 2: Need a spool from shelf - check if available
  if (shelfSpoolsFree > 0) {
    return { canAllocate: true, source: 'open_spool' };
  }
  
  // Case 3: No open spools on shelf - check closed spools
  if (item && item.closedCount > 0) {
    return { canAllocate: true, source: 'closed_spool' };
  }
  
  // Case 4: Grams exist but no physical spool available
  // (all open spools are on printers, no closed spools)
  const suggestions: AllocationSuggestion[] = [];
  
  // Suggest idle printers with this color
  const { printerIds } = getPrintersHoldingColor(color);
  const idlePrinters = printerIds.filter(id => isPrinterSpoolAvailable(id, horizon));
  if (idlePrinters.length > 0) {
    const idlePrinter = getPrinter(idlePrinters[0]);
    suggestions.push({
      type: 'use_idle_printer',
      printerId: idlePrinters[0],
      message: `מדפסת ${idlePrinter?.name} פנויה עם ${color}`
    });
  }
  
  suggestions.push({
    type: 'wait_for_spool',
    message: `יש גרמים אבל כל הגלילים תפוסים על מדפסות`
  });
  
  return { 
    canAllocate: false, 
    source: 'none',
    blockReason: 'waiting_for_spool',
    suggestions 
  };
};

// ============= PROJECT-LEVEL FUNCTIONS =============

/**
 * Check material availability for a specific project
 * Returns detailed status including what's needed and available
 */
export interface MaterialAvailabilityResult {
  isAvailable: boolean;
  status: 'full' | 'partial' | 'none';
  neededGrams: number;
  availableGrams: number;
  shortfallGrams: number;
  spoolsToOrder: number;
  color: string;
  material: string;
}

export const checkMaterialAvailabilityForProject = (project: Project): MaterialAvailabilityResult => {
  const product = getProduct(project.productId);
  const material = 'PLA'; // Default material
  const color = project.color;
  
  // If no product or no grams per unit, assume available
  if (!product || !product.gramsPerUnit || product.gramsPerUnit <= 0) {
    return {
      isAvailable: true,
      status: 'full',
      neededGrams: 0,
      availableGrams: 0,
      shortfallGrams: 0,
      spoolsToOrder: 0,
      color,
      material,
    };
  }
  
  const remainingUnits = project.quantityTarget - project.quantityGood;
  const neededGrams = product.gramsPerUnit * remainingUnits;
  const availableGrams = getAvailableGramsByColor(color);
  
  // Determine status
  let status: 'full' | 'partial' | 'none';
  if (availableGrams >= neededGrams) {
    status = 'full';
  } else if (availableGrams > 0) {
    status = 'partial';
  } else {
    status = 'none';
  }
  
  // Calculate spools to order using PRD logic (150g safety threshold)
  const SAFETY_THRESHOLD = 150;
  const SPOOL_SIZE = 1000;
  const shortfallGrams = Math.max(0, neededGrams - availableGrams);
  
  let spoolsToOrder = 0;
  if (shortfallGrams > 0) {
    const baseSpools = Math.ceil(shortfallGrams / SPOOL_SIZE);
    const remainingAfterOrder = (baseSpools * SPOOL_SIZE) - shortfallGrams;
    const needsExtra = remainingAfterOrder < SAFETY_THRESHOLD;
    spoolsToOrder = needsExtra ? baseSpools + 1 : baseSpools;
  }
  
  return {
    isAvailable: status === 'full',
    status,
    neededGrams,
    availableGrams,
    shortfallGrams,
    spoolsToOrder,
    color,
    material,
  };
};

/**
 * Consume material from inventory after cycle completion
 * Only consumes from ColorInventory (single source)
 */
export const consumeMaterial = (
  color: string, 
  material: string, 
  grams: number
): { success: boolean; consumed: number; remaining: number } => {
  return consumeFromColorInventory(color, material, grams);
};

/**
 * Check if there's enough material for a single cycle
 */
export const hasMaterialForCycle = (color: string, gramsNeeded: number): boolean => {
  const available = getAvailableGramsByColor(color);
  return available >= gramsNeeded;
};

/**
 * Get material status summary for all colors
 */
export interface ColorMaterialSummary {
  color: string;
  material: string;
  totalGrams: number;
  closedSpools: number;
  openGrams: number;
  openSpoolCount: number;
  shelfSpoolsFree: number;
  reservedGrams: number;
  availableForAllocation: number;
  isBelowReorderPoint: boolean;
}

export const getMaterialSummary = (): ColorMaterialSummary[] => {
  const inventory = getColorInventory();
  
  return inventory.map(item => {
    const shelfFree = getShelfOpenSpoolsFree(item.color, item.material);
    const reserved = getReservedGramsByColor(item.color);
    const availableForAllocation = Math.max(0, item.openTotalGrams - reserved);
    
    return {
      color: item.color,
      material: item.material,
      totalGrams: getTotalGrams(item),
      closedSpools: item.closedCount,
      openGrams: item.openTotalGrams,
      openSpoolCount: item.openSpoolCount || 0,
      shelfSpoolsFree: shelfFree,
      reservedGrams: reserved,
      availableForAllocation,
      isBelowReorderPoint: getTotalGrams(item) < (item.reorderPointGrams || 0),
    };
  });
};

/**
 * Check material availability for multiple projects at once
 * Returns a map of projectId -> availability result
 */
export const checkMaterialForProjects = (projects: Project[]): Map<string, MaterialAvailabilityResult> => {
  const results = new Map<string, MaterialAvailabilityResult>();
  
  for (const project of projects) {
    results.set(project.id, checkMaterialAvailabilityForProject(project));
  }
  
  return results;
};

/**
 * Get total material needed for a list of projects grouped by color
 */
export const getMaterialNeedsByColor = (projects: Project[]): Map<string, { needed: number; available: number; projectIds: string[] }> => {
  const needs = new Map<string, { needed: number; available: number; projectIds: string[] }>();
  
  for (const project of projects) {
    const product = getProduct(project.productId);
    if (!product) continue;
    
    const remainingUnits = project.quantityTarget - project.quantityGood;
    const gramsNeeded = product.gramsPerUnit * remainingUnits;
    const colorKey = normalizeColor(project.color);
    
    const existing = needs.get(colorKey) || { 
      needed: 0, 
      available: getAvailableGramsByColor(project.color),
      projectIds: [] 
    };
    existing.needed += gramsNeeded;
    existing.projectIds.push(project.id);
    needs.set(colorKey, existing);
  }
  
  return needs;
};

// Re-export helper functions from storage for convenience
export { getPrintersHoldingColor, getShelfOpenSpoolsFree } from './storage';
