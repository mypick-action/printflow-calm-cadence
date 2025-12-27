// ============= MATERIAL ALERTS SERVICE =============
// Generates alerts for material-related issues

import {
  getSpools,
  getPrinters,
  getPlannedCycles,
  getProjects,
  getProducts,
  getFactorySettings,
  Spool,
  Printer,
  PlannedCycle,
} from './storage';

export interface MaterialAlert {
  id: string;
  type: 'low_material' | 'insufficient_for_jobs' | 'no_matching_spools' | 'printer_needs_spool';
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

const LOW_MATERIAL_THRESHOLD_GRAMS = 200; // Alert when spool has less than 200g

/**
 * Generate all material-related alerts
 */
export const generateMaterialAlerts = (): MaterialAlert[] => {
  const alerts: MaterialAlert[] = [];
  
  alerts.push(...checkLowMaterialAlerts());
  alerts.push(...checkInsufficientForJobsAlerts());
  alerts.push(...checkNoMatchingSpoolsAlerts());
  alerts.push(...checkPrintersNeedingSpoolAlerts());
  
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
 */
const checkInsufficientForJobsAlerts = (): MaterialAlert[] => {
  const cycles = getPlannedCycles();
  const spools = getSpools();
  const projects = getProjects();
  const alerts: MaterialAlert[] = [];
  
  // Group cycles by color to check total material needs
  const materialNeeds = new Map<string, { 
    totalGrams: number; 
    cycleIds: string[]; 
    projectIds: Set<string>;
  }>();
  
  for (const cycle of cycles) {
    if (cycle.status === 'completed' || cycle.status === 'failed') continue;
    if (!cycle.requiredColor || !cycle.requiredGrams) continue;
    
    const colorKey = cycle.requiredColor.toLowerCase();
    const existing = materialNeeds.get(colorKey) || { 
      totalGrams: 0, 
      cycleIds: [], 
      projectIds: new Set() 
    };
    
    existing.totalGrams += cycle.requiredGrams;
    existing.cycleIds.push(cycle.id);
    existing.projectIds.add(cycle.projectId);
    
    materialNeeds.set(colorKey, existing);
  }
  
  // Check available material for each color
  for (const [colorKey, needs] of materialNeeds) {
    const availableGrams = spools
      .filter(s => 
        s.color.toLowerCase() === colorKey && 
        s.state !== 'empty' && 
        s.gramsRemainingEst > 0
      )
      .reduce((sum, s) => sum + s.gramsRemainingEst, 0);
    
    if (availableGrams < needs.totalGrams) {
      const shortfall = needs.totalGrams - availableGrams;
      const projectNames = Array.from(needs.projectIds)
        .map(id => projects.find(p => p.id === id)?.name || id)
        .join(', ');
      
      alerts.push({
        id: `insufficient_${colorKey}`,
        type: 'insufficient_for_jobs',
        severity: 'critical',
        title: `Insufficient ${colorKey} material`,
        titleHe: `חסר חומר ${colorKey}`,
        message: `Need ${Math.round(needs.totalGrams)}g but only ${Math.round(availableGrams)}g available. Shortfall: ${Math.round(shortfall)}g. Affects: ${projectNames}`,
        messageHe: `נדרשים ${Math.round(needs.totalGrams)}g אבל זמינים רק ${Math.round(availableGrams)}g. חסר: ${Math.round(shortfall)}g. משפיע על: ${projectNames}`,
        color: colorKey,
        requiredGrams: needs.totalGrams,
        availableGrams,
        affectedCycleIds: needs.cycleIds,
        affectedProjectIds: Array.from(needs.projectIds),
      });
    }
  }
  
  return alerts;
};

/**
 * Check for printers restricted to colors with no matching spools available
 */
const checkNoMatchingSpoolsAlerts = (): MaterialAlert[] => {
  const printers = getPrinters().filter(p => p.status === 'active');
  const spools = getSpools();
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
      
      const colorKey = cycle.requiredColor.toLowerCase();
      const matchingSpools = spools.filter(s =>
        s.color.toLowerCase() === colorKey &&
        s.state !== 'empty' &&
        s.gramsRemainingEst > 0
      );
      
      if (matchingSpools.length === 0) {
        alerts.push({
          id: `no_spools_${printer.id}_${colorKey}`,
          type: 'no_matching_spools',
          severity: 'critical',
          title: `No ${cycle.requiredColor} spools available`,
          titleHe: `אין גלילי ${cycle.requiredColor} זמינים`,
          message: `Printer ${printer.name} needs ${cycle.requiredColor} but no spools are available in inventory`,
          messageHe: `מדפסת ${printer.name} צריכה ${cycle.requiredColor} אבל אין גלילים זמינים במלאי`,
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

/**
 * Check for printers that need spool selection (color without spoolId)
 */
const checkPrintersNeedingSpoolAlerts = (): MaterialAlert[] => {
  const printers = getPrinters().filter(p => p.status === 'active');
  const alerts: MaterialAlert[] = [];
  
  for (const printer of printers) {
    if (!printer.hasAMS) {
      // Non-AMS: check if has color but no spoolId
      if (printer.mountedColor && !printer.mountedSpoolId) {
        alerts.push({
          id: `needs_spool_${printer.id}`,
          type: 'printer_needs_spool',
          severity: 'warning',
          title: `Select spool for ${printer.name}`,
          titleHe: `בחר גליל ל${printer.name}`,
          message: `Printer has ${printer.mountedColor} color set but no spool selected from inventory`,
          messageHe: `למדפסת מוגדר צבע ${printer.mountedColor} אבל לא נבחר גליל מהמלאי`,
          color: printer.mountedColor,
          printerId: printer.id,
          printerName: printer.name,
        });
      }
    } else {
      // AMS: check each slot
      if (printer.amsSlotStates) {
        for (const slot of printer.amsSlotStates) {
          if (slot.color && !slot.spoolId) {
            alerts.push({
              id: `needs_spool_${printer.id}_slot_${slot.slotIndex}`,
              type: 'printer_needs_spool',
              severity: 'warning',
              title: `Select spool for ${printer.name} Slot ${slot.slotIndex + 1}`,
              titleHe: `בחר גליל ל${printer.name} חריץ ${slot.slotIndex + 1}`,
              message: `AMS slot has ${slot.color} color set but no spool selected from inventory`,
              messageHe: `לחריץ ה-AMS מוגדר צבע ${slot.color} אבל לא נבחר גליל מהמלאי`,
              color: slot.color,
              printerId: printer.id,
              printerName: printer.name,
            });
          }
        }
      }
    }
  }
  
  return alerts;
};

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
