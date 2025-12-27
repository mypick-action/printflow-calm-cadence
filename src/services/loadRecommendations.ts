// Load Recommendations Service
// Per PRD: Generates explicit guidance on what spools to load on which printers

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
} from './storage';

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

  // Calculate material shortages
  const shortagesByColor = new Map<string, MaterialShortage>();

  for (const cycle of activeCycles) {
    if (cycle.readinessState !== 'blocked_inventory') continue;

    const color = cycle.requiredColor?.toLowerCase() || '';
    const project = allProjects.find(p => p.id === cycle.projectId);

    const existing = shortagesByColor.get(color) || {
      color: cycle.requiredColor || '',
      requiredGrams: 0,
      availableGrams: 0,
      shortfallGrams: 0,
      affectedProjectIds: [],
      affectedProjectNames: [],
    };

    existing.requiredGrams += cycle.requiredGrams || cycle.gramsPlanned;
    
    if (project && !existing.affectedProjectIds.includes(project.id)) {
      existing.affectedProjectIds.push(project.id);
      existing.affectedProjectNames.push(project.name);
    }

    shortagesByColor.set(color, existing);
  }

  // Calculate actual available material and shortfall
  const materialShortages: MaterialShortage[] = [];
  for (const [colorKey, shortage] of shortagesByColor) {
    const availableGrams = allSpools
      .filter(s => s.color.toLowerCase() === colorKey && s.state !== 'empty')
      .reduce((sum, s) => sum + s.gramsRemainingEst, 0);

    shortage.availableGrams = availableGrams;
    shortage.shortfallGrams = Math.max(0, shortage.requiredGrams - availableGrams);
    materialShortages.push(shortage);
  }

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
