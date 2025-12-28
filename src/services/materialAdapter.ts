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
  Product,
  getProduct,
} from './storage';
import { normalizeColor } from './colorNormalization';

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
  isBelowReorderPoint: boolean;
}

export const getMaterialSummary = (): ColorMaterialSummary[] => {
  const inventory = getColorInventory();
  
  return inventory.map(item => ({
    color: item.color,
    material: item.material,
    totalGrams: getTotalGrams(item),
    closedSpools: item.closedCount,
    openGrams: item.openTotalGrams,
    isBelowReorderPoint: getTotalGrams(item) < (item.reorderPointGrams || 0),
  }));
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
