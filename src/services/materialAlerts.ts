// ============= MATERIAL ALERTS SERVICE =============
// Generates alerts for material-related issues

import {
  getSpools,
  getPrinters,
  getPlannedCycles,
  getProjectsSync,
  getProducts,
  getFactorySettings,
  findProjectById,
  Spool,
  Printer,
  PlannedCycle,
} from './storage';
import { getAvailableGramsByColor, getMaterialNeedsByColor } from './materialAdapter';

export interface MaterialAlert {
  id: string;
  type: 'low_material' | 'insufficient_for_jobs' | 'no_matching_spools';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  titleHe: string;
  message: string;
  messageHe: string;
  color?: string;
  material?: string;
  printerId?: string;
  printerName?: string;
  affectedProjectIds?: string[];
  affectedCycleIds?: string[];
  requiredGrams?: number;
  availableGrams?: number;
  threshold?: number;
}

// Import from materialStatus service for consistency - PRD mandates 150g
import { SAFETY_THRESHOLD_GRAMS } from './materialStatus';

const LOW_MATERIAL_THRESHOLD_GRAMS = SAFETY_THRESHOLD_GRAMS; // PRD: 150g threshold

/**
 * Generate all material-related alerts
 */
export const generateMaterialAlerts = (): MaterialAlert[] => {
  const alerts: MaterialAlert[] = [];
  
  alerts.push(...checkLowMaterialAlerts());
  alerts.push(...checkInsufficientForJobsAlerts());
  alerts.push(...checkNoMatchingSpoolsAlerts());
  // printer_needs_spool alerts removed - spool loading now happens at print start
  
  return alerts;
};

/**
 * Check for spools with low remaining material
 */
const checkLowMaterialAlerts = (): MaterialAlert[] => {
  const spools = getSpools();
  const alerts: MaterialAlert[] = [];
  
  for (const spool of spools) {
    if (spool.state === 'empty') continue;
    
    if (spool.gramsRemainingEst > 0 && spool.gramsRemainingEst < LOW_MATERIAL_THRESHOLD_GRAMS) {
      alerts.push({
        id: `low_material_${spool.id}`,
        type: 'low_material',
        severity: 'warning',
        title: `Low ${spool.color} ${spool.material || 'PLA'}`,
        titleHe: `מעט ${spool.color} ${spool.material || 'PLA'}`,
        message: `Spool has only ${Math.round(spool.gramsRemainingEst)}g remaining`,
        messageHe: `בגליל נותרו רק ${Math.round(spool.gramsRemainingEst)}g`,
        color: spool.color,
        material: spool.material,
        availableGrams: spool.gramsRemainingEst,
        threshold: LOW_MATERIAL_THRESHOLD_GRAMS,
      });
    }
  }
  
  return alerts;
};

/**
 * Check for insufficient material for scheduled jobs
 * Uses centralized materialAdapter for availability checks
 */
const checkInsufficientForJobsAlerts = (): MaterialAlert[] => {
  const allProjects = getProjectsSync();
  const alerts: MaterialAlert[] = [];
  
  // Use centralized adapter for material needs calculation
  const activeProjects = allProjects.filter(p => p.status !== 'completed');
  const materialNeeds = getMaterialNeedsByColor(activeProjects);
  
  // Check each color's availability vs needs
  for (const [colorKey, needs] of materialNeeds) {
    if (needs.available < needs.needed) {
      const shortfall = needs.needed - needs.available;
      const projectNames = needs.projectIds
        .map(id => findProjectById(allProjects, id)?.name || id)
        .join(', ');
      
      alerts.push({
        id: `insufficient_${colorKey}`,
        type: 'insufficient_for_jobs',
        severity: 'critical',
        title: `Insufficient ${colorKey} material`,
        titleHe: `חסר חומר ${colorKey}`,
        message: `Need ${Math.round(needs.needed)}g but only ${Math.round(needs.available)}g available. Shortfall: ${Math.round(shortfall)}g. Affects: ${projectNames}`,
        messageHe: `נדרשים ${Math.round(needs.needed)}g אבל זמינים רק ${Math.round(needs.available)}g. חסר: ${Math.round(shortfall)}g. משפיע על: ${projectNames}`,
        color: colorKey,
        requiredGrams: needs.needed,
        availableGrams: needs.available,
        affectedProjectIds: needs.projectIds,
      });
    }
  }
  
  return alerts;
};

/**
 * Check for printers restricted to colors with no matching material available
 * Uses centralized adapter for availability checks
 */
const checkNoMatchingSpoolsAlerts = (): MaterialAlert[] => {
  const printers = getPrinters().filter(p => p.status === 'active');
  const cycles = getPlannedCycles();
  const alerts: MaterialAlert[] = [];
  
  for (const printer of printers) {
    // Check if printer has cycles that need specific colors
    const printerCycles = cycles.filter(c => 
      c.printerId === printer.id && 
      c.status === 'planned' &&
      c.requiredColor
    );
    
    if (printerCycles.length === 0) continue;
    
    for (const cycle of printerCycles) {
      if (!cycle.requiredColor) continue;
      
      // Use centralized adapter to check material availability
      const availableGrams = getAvailableGramsByColor(cycle.requiredColor);
      
      if (availableGrams <= 0) {
        alerts.push({
          id: `no_spools_${printer.id}_${cycle.requiredColor.toLowerCase()}`,
          type: 'no_matching_spools',
          severity: 'critical',
          title: `No ${cycle.requiredColor} material available`,
          titleHe: `אין חומר ${cycle.requiredColor} זמין`,
          message: `Printer ${printer.name} needs ${cycle.requiredColor} but no material is available in inventory`,
          messageHe: `מדפסת ${printer.name} צריכה ${cycle.requiredColor} אבל אין חומר זמין במלאי`,
          color: cycle.requiredColor,
          printerId: printer.id,
          printerName: printer.name,
          affectedCycleIds: [cycle.id],
        });
        
        // Only alert once per printer+color combination
        break;
      }
    }
  }
  
  return alerts;
};
// checkPrintersNeedingSpoolAlerts removed - spool loading now happens automatically at print start

/**
 * Get critical alerts only
 */
export const getCriticalAlerts = (): MaterialAlert[] => {
  return generateMaterialAlerts().filter(a => a.severity === 'critical');
};

/**
 * Get alert count by severity
 */
export const getAlertCounts = (): { info: number; warning: number; critical: number; total: number } => {
  const alerts = generateMaterialAlerts();
  return {
    info: alerts.filter(a => a.severity === 'info').length,
    warning: alerts.filter(a => a.severity === 'warning').length,
    critical: alerts.filter(a => a.severity === 'critical').length,
    total: alerts.length,
  };
};
