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
  const spools = getSpools();
  const demandByColor = calculateRemainingDemandByColor();
  const shortages: MaterialShortage[] = [];

  for (const [colorKey, demand] of demandByColor) {
    // Calculate available grams using normalized color matching
    const availableGrams = spools
      .filter(s => 
        normalizeColor(s.color) === colorKey && 
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
 * CRITICAL: Only show the NEXT actionable load per printer (not future queue)
 * This ensures the panel is an operational checklist, not a roadmap
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
  // 1. If printer has an in_progress cycle, do NOT show any recommendation (printer is busy)
  // 2. Only show the first waiting_for_spool cycle per printer
  // 3. If next cycle uses same color as currently mounted, skip (no action needed)
  
  // Find printers that are currently running a cycle
  const printersWithRunningCycle = new Set<string>();
  for (const cycle of sortedActiveCycles) {
    if (cycle.status === 'in_progress') {
      printersWithRunningCycle.add(cycle.printerId);
    }
  }

  // Track which printers we've already added a recommendation for
  const printersWithRecommendation = new Set<string>();
  const recommendations: LoadRecommendation[] = [];

  for (const cycle of sortedActiveCycles) {
    const printerId = cycle.printerId;
    
    // RULE A.1: Skip if printer is currently running a cycle (not actionable now)
    if (printersWithRunningCycle.has(printerId)) continue;
    
    // Skip if we already have a recommendation for this printer (ONE per printer max)
    if (printersWithRecommendation.has(printerId)) continue;

    // Only process cycles that need a spool action
    if (cycle.readinessState === 'ready') continue;
    if (cycle.status !== 'planned') continue; // Only planned, not in_progress

    const printer = allPrinters.find(p => p.id === printerId);
    if (!printer) continue;

    const colorKey = normalizeColor(cycle.requiredColor);
    const color = cycle.requiredColor || '';

    // RULE A.3: Check if same color spool is already mounted (no change needed)
    let isSameColorMounted = false;
    if (printer.hasAMS && printer.amsSlotStates) {
      isSameColorMounted = printer.amsSlotStates.some(s => 
        normalizeColor(s.color) === colorKey && !!s.spoolId
      );
    } else if (printer.mountedSpoolId) {
      isSameColorMounted = normalizeColor(printer.mountedColor) === colorKey;
    }
    
    // If same color is mounted, no action needed - mark printer as handled and skip
    if (isSameColorMounted) {
      printersWithRecommendation.add(printerId); // No more recommendations for this printer
      continue;
    }

    // Find suitable spools from inventory using normalized color matching
    const suitableSpools = allSpools.filter(s =>
      normalizeColor(s.color) === colorKey &&
      s.state !== 'empty' &&
      s.location !== 'printer' && // Not already mounted
      s.gramsRemainingEst > 0
    );

    // Sort by grams remaining (prefer fuller spools)
    suitableSpools.sort((a, b) => b.gramsRemainingEst - a.gramsRemainingEst);

    const suggestedSpoolIds = suitableSpools.slice(0, 3).map(s => s.id);
    
    const project = allProjects.find(p => p.id === cycle.projectId);
    const projectName = project?.name || 'Unknown';

    // Create recommendation for just this ONE cycle (the next actionable one)
    recommendations.push({
      id: generateId(),
      printerId: cycle.printerId,
      printerName: printer.name,
      action: 'load_spool',
      priority: 'high', // First cycle is always high priority
      color,
      gramsNeeded: cycle.requiredGrams || cycle.gramsPlanned,
      suggestedSpoolIds,
      affectedCycleIds: [cycle.id], // Only this cycle
      affectedProjectNames: [projectName],
      message: `טען גליל ${color} על ${printer.name} (${projectName})`,
      messageEn: `Load ${color} spool on ${printer.name} (${projectName})`,
    });

    // Mark this printer as having a recommendation - no more for this printer
    printersWithRecommendation.add(printerId);
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
