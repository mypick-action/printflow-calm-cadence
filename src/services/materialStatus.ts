// ============= MATERIAL STATUS SERVICE =============
// Implements PRD material logic: 3-state status, spool ordering calculations, 150g threshold

import {
  getSpools,
  getProducts,
  getProduct,
  Project,
  Product,
  Spool,
  getColorInventory,
  getTotalGrams,
  ColorInventoryItem,
} from './storage';
import { normalizeColor } from './colorNormalization';

// ============= CONSTANTS (PRD-defined) =============

/** Safety threshold in grams - PRD mandates 150g */
export const SAFETY_THRESHOLD_GRAMS = 150;

/** Standard spool size in grams */
export const STANDARD_SPOOL_SIZE_GRAMS = 1000;

// ============= TYPES =============

/** 3-state material status as per PRD */
export type MaterialStatusType = 'full' | 'partial' | 'none';

export interface MaterialStatus {
  status: MaterialStatusType;
  requiredGrams: number;
  availableGrams: number;
  missingGrams: number;
  color: string;
  material?: string;
}

export interface SpoolOrderRecommendation {
  color: string;
  material?: string;
  requiredGrams: number;
  availableGrams: number;
  missingGrams: number;
  spoolsToOrder: number;
  reasoning: string;
  reasoningHe: string;
}

export interface ProjectMaterialStatus extends MaterialStatus {
  projectId: string;
  projectName: string;
  orderRecommendation?: SpoolOrderRecommendation;
}

// ============= CORE FUNCTIONS =============

/**
 * Calculate spools needed for a given amount of material.
 * Uses PRD logic with 150g safety threshold.
 * 
 * Rules:
 * - Don't auto-order "extra spool per color"
 * - Order extra spool ONLY if remaining < 150g after last spool
 * 
 * Examples from PRD:
 * - 850g → 1 spool (150g remaining >= threshold)
 * - 920g → 2 spools (80g remaining < threshold)
 * - 2500g → 3 spools (500g remaining >= threshold)
 * - 2950g → 4 spools (50g remaining < threshold)
 */
export const calculateSpoolsNeeded = (
  gramsNeeded: number,
  spoolSize: number = STANDARD_SPOOL_SIZE_GRAMS,
  safetyThreshold: number = SAFETY_THRESHOLD_GRAMS
): { spoolsNeeded: number; remainingAfterUse: number; needsExtraSpool: boolean } => {
  if (gramsNeeded <= 0) {
    return { spoolsNeeded: 0, remainingAfterUse: 0, needsExtraSpool: false };
  }

  // Base calculation: how many full spools would we use?
  const baseSpools = Math.ceil(gramsNeeded / spoolSize);
  
  // Calculate remaining grams after using baseSpools
  const totalFromBaseSpools = baseSpools * spoolSize;
  const remainingAfterUse = totalFromBaseSpools - gramsNeeded;
  
  // If remaining is below safety threshold, we need an extra spool
  const needsExtraSpool = remainingAfterUse < safetyThreshold;
  
  // Final spool count
  const spoolsNeeded = needsExtraSpool ? baseSpools + 1 : baseSpools;
  
  return { spoolsNeeded, remainingAfterUse, needsExtraSpool };
};

/**
 * Calculate how many additional spools to ORDER (not just need) based on current inventory.
 * 
 * Logic:
 * 1. Calculate total spools needed for the job
 * 2. Calculate how many spools-worth we already have in inventory
 * 3. Subtract to get how many to order
 */
export const calculateSpoolsToOrder = (
  gramsNeeded: number,
  availableGrams: number,
  spoolSize: number = STANDARD_SPOOL_SIZE_GRAMS,
  safetyThreshold: number = SAFETY_THRESHOLD_GRAMS
): SpoolOrderRecommendation['spoolsToOrder'] => {
  if (gramsNeeded <= availableGrams) {
    return 0; // No need to order
  }

  const missingGrams = gramsNeeded - availableGrams;
  const { spoolsNeeded } = calculateSpoolsNeeded(missingGrams, spoolSize, safetyThreshold);
  
  return spoolsNeeded;
};

/**
 * Get material status for a specific color.
 * Returns one of: FULL, PARTIAL, NONE
 */
export const getMaterialStatusForColor = (
  color: string,
  requiredGrams: number,
  material?: string
): MaterialStatus => {
  const colorKey = normalizeColor(color);
  const colorInventory = getColorInventory();
  
  // Find matching inventory item using normalized color comparison
  const matchingItem = colorInventory.find((item: ColorInventoryItem) => 
    normalizeColor(item.color) === colorKey &&
    (!material || item.material.toLowerCase() === material.toLowerCase())
  );
  
  const availableGrams = matchingItem ? getTotalGrams(matchingItem) : 0;
  const missingGrams = Math.max(0, requiredGrams - availableGrams);
  
  let status: MaterialStatusType;
  if (availableGrams >= requiredGrams) {
    status = 'full';
  } else if (availableGrams > 0) {
    status = 'partial';
  } else {
    status = 'none';
  }
  
  return {
    status,
    requiredGrams,
    availableGrams,
    missingGrams,
    color,
    material,
  };
};

/**
 * Get complete material status for a project including order recommendations.
 */
export const getProjectMaterialStatus = (project: Project): ProjectMaterialStatus => {
  const product = getProduct(project.productId);
  
  if (!product || !product.gramsPerUnit || product.gramsPerUnit <= 0) {
    // Cannot calculate - treat as full (no material tracking)
    return {
      projectId: project.id,
      projectName: project.name,
      status: 'full',
      requiredGrams: 0,
      availableGrams: 0,
      missingGrams: 0,
      color: project.color,
    };
  }
  
  // Calculate remaining quantity to produce
  const remainingQuantity = Math.max(0, project.quantityTarget - project.quantityGood);
  const requiredGrams = product.gramsPerUnit * remainingQuantity;
  
  const materialStatus = getMaterialStatusForColor(project.color, requiredGrams);
  
  // Generate order recommendation if not full
  let orderRecommendation: SpoolOrderRecommendation | undefined;
  
  if (materialStatus.status !== 'full' && materialStatus.missingGrams > 0) {
    const spoolsToOrder = calculateSpoolsToOrder(
      requiredGrams,
      materialStatus.availableGrams
    );
    
    // Generate reasoning based on PRD logic
    let reasoning: string;
    let reasoningHe: string;
    
    if (spoolsToOrder === 0) {
      reasoning = 'Sufficient material available';
      reasoningHe = 'יש מספיק חומר במלאי';
    } else {
      const afterOrder = materialStatus.availableGrams + (spoolsToOrder * STANDARD_SPOOL_SIZE_GRAMS);
      const remainingAfter = afterOrder - requiredGrams;
      
      if (remainingAfter >= SAFETY_THRESHOLD_GRAMS) {
        reasoning = `${spoolsToOrder} spool(s) will leave ${Math.round(remainingAfter)}g remaining (above ${SAFETY_THRESHOLD_GRAMS}g safety threshold)`;
        reasoningHe = `${spoolsToOrder} גלילים ישאירו ${Math.round(remainingAfter)}g (מעל סף הביטחון של ${SAFETY_THRESHOLD_GRAMS}g)`;
      } else {
        reasoning = `${spoolsToOrder} spool(s) recommended. Less would leave insufficient buffer.`;
        reasoningHe = `מומלץ ${spoolsToOrder} גלילים. פחות לא ישאיר מרווח ביטחון מספיק.`;
      }
    }
    
    orderRecommendation = {
      color: project.color,
      requiredGrams,
      availableGrams: materialStatus.availableGrams,
      missingGrams: materialStatus.missingGrams,
      spoolsToOrder,
      reasoning,
      reasoningHe,
    };
  }
  
  return {
    projectId: project.id,
    projectName: project.name,
    ...materialStatus,
    orderRecommendation,
  };
};

/**
 * Get aggregate material status across all active projects.
 * Groups by color and calculates total needs.
 */
export const getAggregatedMaterialStatus = (projects: Project[]): Map<string, {
  status: MaterialStatusType;
  requiredGrams: number;
  availableGrams: number;
  missingGrams: number;
  spoolsToOrder: number;
  projectCount: number;
  projectNames: string[];
}> => {
  const products = getProducts();
  const aggregated = new Map<string, {
    status: MaterialStatusType;
    requiredGrams: number;
    availableGrams: number;
    missingGrams: number;
    spoolsToOrder: number;
    projectCount: number;
    projectNames: string[];
  }>();
  
  for (const project of projects) {
    if (project.status === 'completed') continue;
    
    const product = products.find(p => p.id === project.productId);
    if (!product || !product.gramsPerUnit) continue;
    
    // FIXED: Use normalizeColor for consistent matching
    const colorKey = normalizeColor(project.color);
    const remainingQty = Math.max(0, project.quantityTarget - project.quantityGood);
    const gramsNeeded = product.gramsPerUnit * remainingQty;
    
    const existing = aggregated.get(colorKey);
    if (existing) {
      existing.requiredGrams += gramsNeeded;
      existing.projectCount++;
      existing.projectNames.push(project.name);
    } else {
      aggregated.set(colorKey, {
        status: 'full', // Will be recalculated
        requiredGrams: gramsNeeded,
        availableGrams: 0, // Will be calculated
        missingGrams: 0, // Will be calculated
        spoolsToOrder: 0, // Will be calculated
        projectCount: 1,
        projectNames: [project.name],
      });
    }
  }
  
  // Now calculate availability for each color
  const spools = getSpools();
  
  for (const [colorKey, data] of aggregated) {
    // FIXED: Use normalizeColor for consistent matching with spools
    const matchingSpools = spools.filter(s =>
      normalizeColor(s.color) === colorKey &&
      s.state !== 'empty' &&
      s.gramsRemainingEst > 0
    );
    
    data.availableGrams = matchingSpools.reduce((sum, s) => sum + s.gramsRemainingEst, 0);
    data.missingGrams = Math.max(0, data.requiredGrams - data.availableGrams);
    
    // Determine status
    if (data.availableGrams >= data.requiredGrams) {
      data.status = 'full';
    } else if (data.availableGrams > 0) {
      data.status = 'partial';
    } else {
      data.status = 'none';
    }
    
    // Calculate spools to order if needed
    if (data.missingGrams > 0) {
      data.spoolsToOrder = calculateSpoolsToOrder(data.requiredGrams, data.availableGrams);
    }
  }
  
  return aggregated;
};

/**
 * Format material status for display.
 */
export const formatMaterialStatus = (
  status: MaterialStatusType,
  language: 'he' | 'en'
): { label: string; className: string } => {
  switch (status) {
    case 'full':
      return {
        label: language === 'he' ? 'חומר מלא' : 'Full Material',
        className: 'bg-success/10 text-success border-success/20',
      };
    case 'partial':
      return {
        label: language === 'he' ? 'חומר חלקי' : 'Partial Material',
        className: 'bg-warning/10 text-warning border-warning/20',
      };
    case 'none':
      return {
        label: language === 'he' ? 'אין חומר' : 'No Material',
        className: 'bg-error/10 text-error border-error/20',
      };
  }
};

/**
 * Generate order recommendation text.
 */
export const generateOrderRecommendationText = (
  recommendation: SpoolOrderRecommendation,
  language: 'he' | 'en'
): string => {
  if (recommendation.spoolsToOrder === 0) {
    return language === 'he' ? 'אין צורך להזמין' : 'No order needed';
  }
  
  const spoolText = recommendation.spoolsToOrder === 1 
    ? (language === 'he' ? 'גליל אחד' : '1 spool')
    : (language === 'he' ? `${recommendation.spoolsToOrder} גלילים` : `${recommendation.spoolsToOrder} spools`);
  
  return language === 'he'
    ? `הזמן ${spoolText} של ${recommendation.color}`
    : `Order ${spoolText} of ${recommendation.color}`;
};
