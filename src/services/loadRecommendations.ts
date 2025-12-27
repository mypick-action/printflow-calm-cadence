// Load Recommendations Service
// Per PRD: Generates explicit guidance on what spools to load on which printers
// CRITICAL: Material shortages are computed DIRECTLY from current inventory vs project demand
// NOT from planning snapshot - ensures alerts update immediately when inventory changes

import {
  PlannedCycle,
  LoadRecommendation,
  MaterialShortage,
  Spool,
  Printer,
  Project,
  getPlannedCycles,
  getSpools,
  getPrinters,
  getProjects,
  getProducts,
} from './storage';
import { SAFETY_THRESHOLD_GRAMS } from './materialStatus';

export interface LoadRecommendationsResult {
  recommendations: LoadRecommendation[];
  materialShortages: MaterialShortage[];
  summary: {
    cyclesReady: number;
    cyclesWaitingForSpool: number;
    cyclesBlockedInventory: number;
    totalCycles: number;
  };
}

const generateId = (): string => {
  return `rec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * Calculate remaining demand for each project (total needed - already produced)
 * This ensures material alerts reflect REMAINING need, not original need
 */
const calculateRemainingDemandByColor = (): Map<string, {
  totalGrams: number;
  projectIds: string[];
  projectNames: string[];
}> => {
  const projects = getProjects();
  const products = getProducts();
  const spools = getSpools();
  const demandByColor = new Map<string, {
    totalGrams: number;
    projectIds: string[];
    projectNames: string[];
  }>();

  for (const project of projects) {
    // Skip completed projects
    if (project.status === 'completed') continue;

    const product = products.find(p => p.id === project.productId);
    if (!product) continue;

    // Project.color is the source of truth for color
    const color = project.color?.toLowerCase();
    if (!color) continue;

    // Calculate remaining units needed (quantityGood = successfully produced)
    const unitsProduced = project.quantityGood || 0;
    const unitsRemaining = Math.max(0, project.quantityTarget - unitsProduced);
    
    if (unitsRemaining === 0) continue;

    // Calculate grams needed for remaining units (Product.gramsPerUnit)
    const gramsPerUnit = product.gramsPerUnit || 0;
    const gramsNeeded = unitsRemaining * gramsPerUnit;

    // DEBUG: Log for projects with "green" color to diagnose key mismatch
    if (color.includes('green') || color.includes('ירוק') || project.name.includes('מלפפון')) {
      const inventoryForColor = spools.filter(s => 
        s.color.toLowerCase() === color && 
        s.state !== 'empty' && 
        s.gramsRemainingEst > 0
      );
      const inventoryGrams = inventoryForColor.reduce((sum, s) => sum + s.gramsRemainingEst, 0);
      
      console.log(`[DEBUG Material Alert] Project: "${project.name}"`, {
        '1. project.color': project.color,
        '2. colorKey (lowercase)': color,
        '3. product.gramsPerUnit': gramsPerUnit,
        '4. unitsRemaining': unitsRemaining,
        '5. gramsNeeded': gramsNeeded,
        '6. inventorySpoolColors': spools.map(s => ({ color: s.color, colorLower: s.color.toLowerCase(), grams: s.gramsRemainingEst, state: s.state })),
        '7. matchingSpools': inventoryForColor.map(s => ({ id: s.id, color: s.color, grams: s.gramsRemainingEst })),
        '8. totalInventoryGrams': inventoryGrams,
      });
    }

    const existing = demandByColor.get(color) || {
      totalGrams: 0,
      projectIds: [],
      projectNames: [],
    };

    existing.totalGrams += gramsNeeded;
    existing.projectIds.push(project.id);
    existing.projectNames.push(project.name);
    demandByColor.set(color, existing);
  }

  return demandByColor;
};

/**
 * Calculate material shortages based on CURRENT inventory vs REMAINING project demand
 * This is the source of truth for material alerts - derived, not stored
 */
const calculateMaterialShortages = (): MaterialShortage[] => {
  const spools = getSpools();
  const demandByColor = calculateRemainingDemandByColor();
  const shortages: MaterialShortage[] = [];

  for (const [colorKey, demand] of demandByColor) {
    // Calculate available grams for this color
    const availableGrams = spools
      .filter(s => 
        s.color.toLowerCase() === colorKey && 
        s.state !== 'empty' && 
        s.gramsRemainingEst > 0
      )
      .reduce((sum, s) => sum + s.gramsRemainingEst, 0);

    // Include safety threshold in the calculation
    const effectiveRequired = demand.totalGrams + SAFETY_THRESHOLD_GRAMS;
    
    // Only report shortage if available is less than required (with safety)
    if (availableGrams < effectiveRequired) {
      const shortfall = Math.max(0, demand.totalGrams - availableGrams);
      
      // Only create shortage alert if there's actual shortfall (not just safety margin)
      if (shortfall > 0) {
        shortages.push({
          color: colorKey,
          requiredGrams: demand.totalGrams,
          availableGrams,
          shortfallGrams: shortfall,
          affectedProjectIds: demand.projectIds,
          affectedProjectNames: demand.projectNames,
        });
      }
    }
  }

  return shortages;
};

/**
 * Generate load recommendations based on planned cycles that need spool loading
 */
export const generateLoadRecommendations = (
  cycles?: PlannedCycle[],
  spools?: Spool[],
  printers?: Printer[],
  projects?: Project[]
): LoadRecommendationsResult => {
  const allCycles = cycles || getPlannedCycles();
  const allSpools = spools || getSpools();
  const allPrinters = printers || getPrinters();
  const allProjects = projects || getProjects();

  // Only consider planned cycles (not completed/failed)
  const activeCycles = allCycles.filter(c => 
    c.status === 'planned' || c.status === 'in_progress'
  );

  // Count by readiness state
  const cyclesReady = activeCycles.filter(c => c.readinessState === 'ready').length;
  const cyclesWaitingForSpool = activeCycles.filter(c => c.readinessState === 'waiting_for_spool').length;
  const cyclesBlockedInventory = activeCycles.filter(c => c.readinessState === 'blocked_inventory').length;

  // Group cycles needing spools by printer and color
  const needsByPrinterColor = new Map<string, {
    printerId: string;
    printerName: string;
    color: string;
    gramsNeeded: number;
    cycles: PlannedCycle[];
    projectNames: Set<string>;
  }>();

  for (const cycle of activeCycles) {
    if (cycle.readinessState !== 'waiting_for_spool') continue;

    const printer = allPrinters.find(p => p.id === cycle.printerId);
    if (!printer) continue;

    const color = cycle.requiredColor?.toLowerCase() || '';
    const key = `${cycle.printerId}:${color}`;

    const existing = needsByPrinterColor.get(key) || {
      printerId: cycle.printerId,
      printerName: printer.name,
      color: cycle.requiredColor || '',
      gramsNeeded: 0,
      cycles: [],
      projectNames: new Set<string>(),
    };

    existing.gramsNeeded += cycle.requiredGrams || cycle.gramsPlanned;
    existing.cycles.push(cycle);

    const project = allProjects.find(p => p.id === cycle.projectId);
    if (project) {
      existing.projectNames.add(project.name);
    }

    needsByPrinterColor.set(key, existing);
  }

  // Generate load recommendations
  const recommendations: LoadRecommendation[] = [];

  for (const [, need] of needsByPrinterColor) {
    // Find suitable spools from inventory
    const suitableSpools = allSpools.filter(s =>
      s.color.toLowerCase() === need.color.toLowerCase() &&
      s.state !== 'empty' &&
      s.location !== 'printer' && // Not already mounted
      s.gramsRemainingEst > 0
    );

    // Sort by grams remaining (prefer fuller spools)
    suitableSpools.sort((a, b) => b.gramsRemainingEst - a.gramsRemainingEst);

    const suggestedSpoolIds = suitableSpools.slice(0, 3).map(s => s.id);
    const projectNamesArr = Array.from(need.projectNames);

    recommendations.push({
      id: generateId(),
      printerId: need.printerId,
      printerName: need.printerName,
      action: 'load_spool',
      priority: need.cycles.length > 3 ? 'high' : need.cycles.length > 1 ? 'medium' : 'low',
      color: need.color,
      gramsNeeded: need.gramsNeeded,
      suggestedSpoolIds,
      affectedCycleIds: need.cycles.map(c => c.id),
      affectedProjectNames: projectNamesArr,
      message: `טען גליל ${need.color} על ${need.printerName} (נדרש ${Math.ceil(need.gramsNeeded)}g עבור ${need.cycles.length} מחזורים)`,
      messageEn: `Load ${need.color} spool on ${need.printerName} (need ${Math.ceil(need.gramsNeeded)}g for ${need.cycles.length} cycles)`,
    });
  }

  // Sort recommendations by priority
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  // Calculate material shortages from CURRENT state (not planning snapshot)
  // This ensures alerts disappear immediately when inventory is updated
  const materialShortages = calculateMaterialShortages();

  return {
    recommendations,
    materialShortages,
    summary: {
      cyclesReady,
      cyclesWaitingForSpool,
      cyclesBlockedInventory,
      totalCycles: activeCycles.length,
    },
  };
};

/**
 * Get a human-readable summary of what actions are needed
 */
export const getActionSummary = (result: LoadRecommendationsResult): {
  hasActions: boolean;
  message: string;
  messageEn: string;
} => {
  const { recommendations, materialShortages, summary } = result;

  if (summary.totalCycles === 0) {
    return {
      hasActions: false,
      message: 'אין מחזורים מתוכננים',
      messageEn: 'No cycles planned',
    };
  }

  if (summary.cyclesReady === summary.totalCycles) {
    return {
      hasActions: false,
      message: `כל ${summary.totalCycles} המחזורים מוכנים להפעלה`,
      messageEn: `All ${summary.totalCycles} cycles are ready to execute`,
    };
  }

  const parts: string[] = [];
  const partsEn: string[] = [];

  if (recommendations.length > 0) {
    parts.push(`${recommendations.length} פעולות טעינה נדרשות`);
    partsEn.push(`${recommendations.length} load actions required`);
  }

  if (materialShortages.length > 0) {
    const totalShortfall = materialShortages.reduce((sum, s) => sum + s.shortfallGrams, 0);
    parts.push(`חסר חומר: ${Math.ceil(totalShortfall)}g`);
    partsEn.push(`Material shortage: ${Math.ceil(totalShortfall)}g`);
  }

  return {
    hasActions: recommendations.length > 0 || materialShortages.length > 0,
    message: parts.join(' | ') || 'בדוק את פרטי התכנון',
    messageEn: partsEn.join(' | ') || 'Check planning details',
  };
};
