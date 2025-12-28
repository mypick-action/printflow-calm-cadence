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
  ColorInventoryItem,
  getPlannedCycles,
  getSpools,
  getPrinters,
  getProjects,
  getProducts,
  getFactorySettings,
  getColorInventory,
  getTotalGrams,
} from './storage';
import { SAFETY_THRESHOLD_GRAMS } from './materialStatus';
import { normalizeColor } from './colorNormalization';

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

    // Normalize project color for consistent matching
    const colorKey = normalizeColor(project.color);
    if (!colorKey) continue;

    // Calculate remaining units needed (quantityGood = successfully produced)
    const unitsProduced = project.quantityGood || 0;
    const unitsRemaining = Math.max(0, project.quantityTarget - unitsProduced);
    
    if (unitsRemaining === 0) continue;

    // Calculate grams needed for remaining units (Product.gramsPerUnit)
    const gramsPerUnit = product.gramsPerUnit || 0;
    const gramsNeeded = unitsRemaining * gramsPerUnit;

    const existing = demandByColor.get(colorKey) || {
      totalGrams: 0,
      projectIds: [],
      projectNames: [],
    };

    existing.totalGrams += gramsNeeded;
    existing.projectIds.push(project.id);
    existing.projectNames.push(project.name);
    demandByColor.set(colorKey, existing);
  }

  return demandByColor;
};

/**
 * Calculate material shortages based on CURRENT inventory vs REMAINING project demand
 * This is the source of truth for material alerts - derived, not stored
 * Uses normalizeColor() for consistent matching between projects and spools
 */
const calculateMaterialShortages = (): MaterialShortage[] => {
  const colorInventory = getColorInventory();
  const demandByColor = calculateRemainingDemandByColor();
  const shortages: MaterialShortage[] = [];

  for (const [colorKey, demand] of demandByColor) {
    // Use ONLY ColorInventory model (not deprecated Spools model)
    const invItem = colorInventory.find((i: ColorInventoryItem) => normalizeColor(i.color) === colorKey);
    const availableGrams = invItem ? getTotalGrams(invItem) : 0;
    const colorExistsInInventory = invItem !== undefined;
    
    // Include safety threshold in the calculation
    const effectiveRequired = demand.totalGrams + SAFETY_THRESHOLD_GRAMS;
    
    // Report shortage if:
    // 1. Color doesn't exist at all in inventory (complete shortage)
    // 2. Available is less than required (partial shortage)
    if (!colorExistsInInventory || availableGrams < effectiveRequired) {
      const shortfall = Math.max(0, demand.totalGrams - availableGrams);
      
      // Create shortage alert if there's actual shortfall or color doesn't exist
      if (shortfall > 0 || !colorExistsInInventory) {
        console.log(`[calculateMaterialShortages] ${colorKey}: shortage! exists=${colorExistsInInventory}, available=${availableGrams}g, required=${demand.totalGrams}g, shortfall=${shortfall}g`);
        shortages.push({
          color: colorKey,
          requiredGrams: demand.totalGrams,
          availableGrams,
          shortfallGrams: !colorExistsInInventory ? demand.totalGrams : shortfall,
          affectedProjectIds: demand.projectIds,
          affectedProjectNames: demand.projectNames,
        });
      }
    }
  }

  return shortages;
};

/**
 * Check if a color has any material in inventory (open or closed spools)
 * Uses ONLY the ColorInventory model (not the deprecated Spools model)
 */
const hasColorInInventory = (colorKey: string): boolean => {
  const colorInventory = getColorInventory();
  const invItem = colorInventory.find((i: ColorInventoryItem) => normalizeColor(i.color) === colorKey);
  
  if (!invItem) {
    // Color doesn't exist in ColorInventory at all - no material
    console.log(`[hasColorInInventory] ${colorKey}: NOT FOUND in ColorInventory`);
    return false;
  }
  
  const total = getTotalGrams(invItem);
  const hasStock = total > 0 || invItem.closedCount > 0;
  console.log(`[hasColorInInventory] ${colorKey}: found, total=${total}g, closedCount=${invItem.closedCount}, hasStock=${hasStock}`);
  return hasStock;
};

/**
 * Generate load recommendations based on planned cycles that need spool loading
 * CRITICAL: Only show the NEXT actionable load per printer (not future queue)
 * CRITICAL: Only show recommendations for colors that EXIST in inventory
 * If color doesn't exist in inventory, it should only appear in materialShortages, not as a load recommendation
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

  // CRITICAL: Sort by start time to process in chronological order
  const sortedActiveCycles = [...activeCycles].sort((a, b) => {
    const aTime = new Date(a.startTime).getTime();
    const bTime = new Date(b.startTime).getTime();
    return aTime - bTime;
  });

  // ============= RULE A: Only show NEXT actionable load per printer =============
  // CRITICAL FIX: Check the FIRST cycle per printer, not just cycles with waiting_for_spool
  // The readinessState is cached from planning and may not reflect current printer state
  
  // 1. If printer has an in_progress cycle, do NOT show any recommendation (printer is busy)
  // 2. For each printer, check only the FIRST planned cycle
  // 3. If that first cycle's color matches loaded color, no action needed (skip printer entirely)
  // 4. If color doesn't match, show recommendation for that first cycle only
  
  // Find printers that are currently running a cycle
  const printersWithRunningCycle = new Set<string>();
  for (const cycle of sortedActiveCycles) {
    if (cycle.status === 'in_progress') {
      printersWithRunningCycle.add(cycle.printerId);
    }
  }

  // Group cycles by printer and find the FIRST cycle for each
  const firstCycleByPrinter = new Map<string, PlannedCycle>();
  for (const cycle of sortedActiveCycles) {
    if (cycle.status !== 'planned') continue;
    if (!firstCycleByPrinter.has(cycle.printerId)) {
      firstCycleByPrinter.set(cycle.printerId, cycle);
    }
  }

  const recommendations: LoadRecommendation[] = [];

  // For each printer, check only its FIRST cycle
  for (const [printerId, cycle] of firstCycleByPrinter.entries()) {
    // RULE A.1: Skip if printer is currently running a cycle (not actionable now)
    if (printersWithRunningCycle.has(printerId)) continue;

    const printer = allPrinters.find(p => p.id === printerId);
    if (!printer) continue;

    const colorKey = normalizeColor(cycle.requiredColor);
    const color = cycle.requiredColor || '';

    // RULE A.3: Check if same color spool is already mounted for the FIRST cycle
    // Ignore cached readinessState - check current printer state directly
    let isSameColorMounted = false;
    if (printer.hasAMS && printer.amsSlotStates && printer.amsSlotStates.length > 0) {
      // For AMS: check if any slot has the required color
      isSameColorMounted = printer.amsSlotStates.some(s => {
        if (!s.color) return false;
        return normalizeColor(s.color) === colorKey;
      });
    } else {
      // For non-AMS: check mountedColor OR currentColor
      const printerColor = printer.mountedColor || printer.currentColor;
      if (printerColor) {
        isSameColorMounted = normalizeColor(printerColor) === colorKey;
      }
    }
    
    // If same color is mounted for the FIRST cycle, no action needed - skip this printer
    if (isSameColorMounted) {
      continue;
    }

    // CRITICAL: Only show load recommendations for colors that EXIST in inventory
    // If no inventory for this color, it will appear in materialShortages instead
    if (!hasColorInInventory(colorKey)) {
      continue;
    }

    // Find ALL sequential same-color cycles for this printer
    const sequentialSameColorCycles: PlannedCycle[] = [cycle];
    let totalGramsForSequence = cycle.requiredGrams || cycle.gramsPlanned;
    
    // Look for following cycles with the same color on this printer
    for (const otherCycle of sortedActiveCycles) {
      if (otherCycle.printerId !== printerId) continue;
      if (otherCycle.id === cycle.id) continue;
      if (otherCycle.status !== 'planned') continue;
      
      const otherColorKey = normalizeColor(otherCycle.requiredColor);
      if (otherColorKey !== colorKey) break; // Stop at first different color
      
      sequentialSameColorCycles.push(otherCycle);
      totalGramsForSequence += otherCycle.requiredGrams || otherCycle.gramsPlanned;
    }

    // Find suitable spools from inventory using normalized color matching
    const suitableSpools = allSpools.filter(s =>
      normalizeColor(s.color) === colorKey &&
      s.state !== 'empty' &&
      s.location !== 'printer' && // Not already mounted
      s.gramsRemainingEst > 0
    );

    // Sort by grams remaining (prefer fuller spools for sorting)
    suitableSpools.sort((a, b) => b.gramsRemainingEst - a.gramsRemainingEst);

    // Analyze partial vs full spool recommendation
    const currentCycleGrams = cycle.requiredGrams || cycle.gramsPlanned;
    const partialSpools = suitableSpools.filter(s => s.gramsRemainingEst < 900); // Less than ~90% full
    const fullSpools = suitableSpools.filter(s => s.gramsRemainingEst >= 900);
    
    // Can a partial spool cover just this job?
    const partialThatCoversJob = partialSpools.find(s => s.gramsRemainingEst >= currentCycleGrams + 50); // +50g safety margin
    
    let partialSpoolRecommendation: 'use_partial' | 'use_full' | 'either' = 'either';
    let canUsePartialSpool = false;
    
    if (partialThatCoversJob) {
      canUsePartialSpool = true;
      // If there's only 1 cycle or sequence is short, prefer partial to finish it
      if (sequentialSameColorCycles.length === 1 || totalGramsForSequence <= partialThatCoversJob.gramsRemainingEst) {
        partialSpoolRecommendation = 'use_partial';
      } else {
        partialSpoolRecommendation = 'either'; // User can decide based on whether they'll be around to swap
      }
    } else if (fullSpools.length > 0) {
      partialSpoolRecommendation = 'use_full';
    }

    // Prioritize suggestion order based on recommendation
    let suggestedSpoolIds: string[];
    if (partialSpoolRecommendation === 'use_partial' && partialThatCoversJob) {
      suggestedSpoolIds = [partialThatCoversJob.id, ...suitableSpools.filter(s => s.id !== partialThatCoversJob.id).slice(0, 2).map(s => s.id)];
    } else {
      suggestedSpoolIds = suitableSpools.slice(0, 3).map(s => s.id);
    }
    
    const project = allProjects.find(p => p.id === cycle.projectId);
    const projectName = project?.name || 'Unknown';

    // Create recommendation with enhanced info
    recommendations.push({
      id: generateId(),
      printerId: cycle.printerId,
      printerName: printer.name,
      action: 'load_spool',
      priority: 'high', // First cycle is always high priority
      color,
      gramsNeeded: currentCycleGrams,
      totalGramsForSequence,
      sequentialCyclesCount: sequentialSameColorCycles.length,
      canUsePartialSpool,
      partialSpoolRecommendation,
      suggestedSpoolIds,
      affectedCycleIds: [cycle.id], // Only this cycle
      affectedProjectNames: [projectName],
      message: `טען גליל ${color} על ${printer.name} (${projectName})`,
      messageEn: `Load ${color} spool on ${printer.name} (${projectName})`,
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
