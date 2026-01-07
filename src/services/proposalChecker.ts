/**
 * Proposal Feasibility Checker
 * 
 * This module provides a HEURISTIC-based feasibility check for new orders.
 * It does NOT create any projects or modify data - it's read-only.
 * 
 * IMPORTANT: All estimates are CONSERVATIVE (prefers false-positive over false-negative).
 * The UI must clearly mark results as "Estimated" / "הערכה".
 */

import { 
  getProducts, 
  getPrinters, 
  getActiveProjects, 
  getFactorySettings,
  Product,
  Project,
  Printer,
  FactorySettings,
} from './storage';
import { normalizeColor } from './colorNormalization';

// ============= TYPES =============

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface AffectedProject {
  projectId: string;
  projectName: string;
  currentSlackHours: number;
  estimatedSlackAfter: number;
  wouldMissDeadline: boolean;
  reason: string;
  reasonHe: string;
}

export interface ProposalNote {
  type: 'info' | 'warning' | 'error';
  text: string;
  textHe: string;
}

export interface ProposalFeasibilityResult {
  /** Is this proposal feasible (with current data)? */
  feasible: boolean;
  
  /** Risk level: low = green, medium = yellow, high = orange, critical = red */
  riskLevel: RiskLevel;
  
  /** Projects that might be affected by this proposal */
  affectedProjects: AffectedProject[];
  
  /** Additional notes and warnings */
  notes: ProposalNote[];
  
  /** Estimated production metrics */
  metrics: {
    requiredCycles: number;
    requiredHours: number;
    requiredDays: number;
    availableCapacityUnits: number;
    daysUntilDeadline: number;
    capacityUtilization: number; // 0-1 (0.7 = 70% utilized)
  };
  
  /** Is this result an estimate (vs. actual simulation)? Always true for now. */
  isEstimate: true;
}

export interface ProposalInput {
  productId: string;
  quantity: number;
  dueDate: string; // YYYY-MM-DD
  urgency: 'normal' | 'urgent' | 'critical';
  preferredColor?: string;
}

// ============= CONSTANTS =============

// Night limit: 5 plates per printer (no operator to swap)
const NIGHT_PLATE_LIMIT = 5;

// Conservative safety margin (prefer false-positive)
const SAFETY_MARGIN = 0.2; // 20% buffer

// Slack threshold - below this we warn
const SLACK_THRESHOLD_HOURS = 8;

// Impact estimation multipliers (conservative)
const SAME_COLOR_IMPACT_MULTIPLIER = 0.6; // 60% of new project hours impact same-color projects
const DIFFERENT_COLOR_IMPACT_MULTIPLIER = 0.3; // 30% impact on different colors

// ============= MAIN FUNCTION =============

/**
 * Check if a proposed order is feasible.
 * This is a READ-ONLY operation - no data is saved.
 * 
 * @param input - The proposal parameters
 * @returns Feasibility result with estimates (clearly marked as such)
 */
export const checkProposalFeasibility = (input: ProposalInput): ProposalFeasibilityResult => {
  console.log('[ProposalChecker] Checking feasibility for:', input);
  
  const notes: ProposalNote[] = [];
  const affectedProjects: AffectedProject[] = [];
  
  // Get current state (read-only)
  const products = getProducts();
  const printers = getPrinters().filter(p => p.active);
  const activeProjects = getActiveProjects();
  const settings = getFactorySettings();
  
  // Find the product
  const product = products.find(p => p.id === input.productId);
  if (!product) {
    return createErrorResult('Product not found', 'מוצר לא נמצא');
  }
  
  // Get preset (use recommended or first)
  const preset = product.platePresets.find(p => p.isRecommended) || product.platePresets[0];
  if (!preset) {
    return createErrorResult('Product has no presets', 'למוצר אין פריסטים');
  }
  
  if (printers.length === 0) {
    return createErrorResult('No active printers', 'אין מדפסות פעילות');
  }
  
  // Calculate work hours per day
  const { dayHours, nightHours } = calculateWorkHours(settings);
  
  // Calculate capacity with night limit
  const dailyCapacity = calculateDailyCapacity(printers, preset, dayHours, nightHours);
  
  // Calculate time metrics
  const daysUntilDeadline = calculateDaysUntilDeadline(input.dueDate);
  const requiredCycles = Math.ceil(input.quantity / preset.unitsPerPlate);
  const requiredHours = requiredCycles * preset.cycleHours;
  const requiredDays = Math.ceil(input.quantity / dailyCapacity.totalUnitsPerDay);
  
  // Calculate current load
  const currentLoad = activeProjects.reduce((sum, p) => sum + (p.quantityTarget - p.quantityGood), 0);
  const totalCapacityUnits = dailyCapacity.totalUnitsPerDay * daysUntilDeadline;
  const availableCapacityUnits = Math.max(0, totalCapacityUnits - currentLoad);
  
  // Add capacity utilization (with safety margin)
  const capacityUtilization = (currentLoad + input.quantity) / (totalCapacityUnits * (1 - SAFETY_MARGIN));
  
  console.log('[ProposalChecker] Capacity analysis:', {
    dailyCapacity: dailyCapacity.totalUnitsPerDay,
    daysUntilDeadline,
    requiredDays,
    currentLoad,
    availableCapacityUnits,
    capacityUtilization: Math.round(capacityUtilization * 100) + '%',
  });
  
  // Check deadline impact on existing projects
  checkImpactOnExistingProjects(
    input,
    product,
    preset,
    activeProjects,
    products,
    requiredHours,
    affectedProjects,
    notes
  );
  
  // Add color warning if color might not be available
  if (input.preferredColor && input.preferredColor !== 'any') {
    const colorAvailable = printers.some(p => {
      const mountedSpool = p.mountedSpoolId;
      // Simplified check - in real scenario we'd check spool color
      return mountedSpool !== null;
    });
    
    if (!colorAvailable) {
      notes.push({
        type: 'warning',
        text: 'Preferred color may require spool change',
        textHe: 'הצבע המועדף עשוי לדרוש החלפת גליל',
      });
    }
  }
  
  // Determine feasibility and risk level
  const { feasible, riskLevel } = determineFeasibilityAndRisk(
    input.quantity,
    availableCapacityUnits,
    requiredDays,
    daysUntilDeadline,
    affectedProjects,
    input.urgency
  );
  
  // Add notes based on result
  if (feasible && riskLevel === 'low') {
    notes.unshift({
      type: 'info',
      text: 'Estimated: Sufficient capacity available',
      textHe: 'הערכה: יש מספיק קיבולת',
    });
  } else if (feasible && riskLevel === 'medium') {
    notes.unshift({
      type: 'warning',
      text: 'Estimated: Tight but achievable with current load',
      textHe: 'הערכה: צפוף אבל אפשרי עם העומס הנוכחי',
    });
  } else if (!feasible) {
    notes.unshift({
      type: 'error',
      text: 'Estimated: Insufficient capacity or deadline conflict',
      textHe: 'הערכה: אין מספיק קיבולת או התנגשות בדדליין',
    });
  }
  
  // Add night capacity note
  notes.push({
    type: 'info',
    text: `Night capacity: ${NIGHT_PLATE_LIMIT} plates/printer (limited by operator availability)`,
    textHe: `קיבולת לילה: ${NIGHT_PLATE_LIMIT} פלטות/מדפסת (מוגבל בגלל זמינות מפעיל)`,
  });
  
  return {
    feasible,
    riskLevel,
    affectedProjects,
    notes,
    metrics: {
      requiredCycles,
      requiredHours: Math.round(requiredHours * 10) / 10,
      requiredDays,
      availableCapacityUnits: Math.round(availableCapacityUnits),
      daysUntilDeadline,
      capacityUtilization: Math.min(1, Math.round(capacityUtilization * 100) / 100),
    },
    isEstimate: true,
  };
};

// ============= HELPER FUNCTIONS =============

function createErrorResult(message: string, messageHe: string): ProposalFeasibilityResult {
  return {
    feasible: false,
    riskLevel: 'critical',
    affectedProjects: [],
    notes: [{ type: 'error', text: message, textHe: messageHe }],
    metrics: {
      requiredCycles: 0,
      requiredHours: 0,
      requiredDays: 0,
      availableCapacityUnits: 0,
      daysUntilDeadline: 0,
      capacityUtilization: 0,
    },
    isEstimate: true,
  };
}

function calculateWorkHours(settings: FactorySettings | null): { dayHours: number; nightHours: number } {
  if (!settings) {
    return { dayHours: 8, nightHours: 0 };
  }
  
  const startTime = parseFloat(settings.startTime?.replace(':', '.') || '9');
  const endTime = parseFloat(settings.endTime?.replace(':', '.') || '17');
  const dayHours = (endTime - startTime) * (100 / 60); // Convert decimal to actual hours
  
  // Night hours: from end time to next start time (if after-hours is enabled)
  const afterHoursEnabled = settings.afterHoursBehavior !== 'NONE';
  const nightHours = afterHoursEnabled ? (24 - (endTime - startTime)) : 0;
  
  return { dayHours: Math.max(0, dayHours), nightHours };
}

function calculateDailyCapacity(
  printers: Printer[],
  preset: { cycleHours: number; unitsPerPlate: number },
  dayHours: number,
  nightHours: number
): { totalUnitsPerDay: number; dayCycles: number; nightCycles: number } {
  const cyclesPerPrinterDay = Math.floor(dayHours / preset.cycleHours);
  
  // Night: limited to NIGHT_PLATE_LIMIT plates per printer (no operator to swap)
  const maxNightCycles = Math.floor(nightHours / preset.cycleHours);
  const cyclesPerPrinterNight = Math.min(maxNightCycles, NIGHT_PLATE_LIMIT);
  
  const totalCyclesPerPrinter = cyclesPerPrinterDay + cyclesPerPrinterNight;
  const unitsPerPrinterPerDay = totalCyclesPerPrinter * preset.unitsPerPlate;
  
  return {
    totalUnitsPerDay: unitsPerPrinterPerDay * printers.length,
    dayCycles: cyclesPerPrinterDay * printers.length,
    nightCycles: cyclesPerPrinterNight * printers.length,
  };
}

function calculateDaysUntilDeadline(dueDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  due.setHours(23, 59, 59, 999);
  return Math.max(0, Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
}

function checkImpactOnExistingProjects(
  input: ProposalInput,
  product: Product,
  preset: { cycleHours: number; unitsPerPlate: number },
  activeProjects: Project[],
  products: Product[],
  newProjectHours: number,
  affectedProjects: AffectedProject[],
  notes: ProposalNote[]
): void {
  const newDeadline = new Date(input.dueDate);
  const newColor = normalizeColor(input.preferredColor || 'any');
  
  for (const project of activeProjects) {
    if (!project.dueDate || project.status === 'completed') continue;
    
    const projectDeadline = new Date(project.dueDate);
    const projectProduct = products.find(p => p.id === project.productId);
    const projectColor = normalizeColor(project.color || 'any');
    
    // Calculate current slack (simplified estimate)
    const remainingUnits = project.quantityTarget - project.quantityGood;
    const projectPreset = projectProduct?.platePresets?.[0];
    if (!projectPreset || remainingUnits <= 0) continue;
    
    const hoursNeeded = Math.ceil(remainingUnits / projectPreset.unitsPerPlate) * projectPreset.cycleHours;
    const hoursUntilDeadline = (projectDeadline.getTime() - Date.now()) / (1000 * 60 * 60);
    const currentSlack = hoursUntilDeadline - hoursNeeded;
    
    // Estimate impact from new project
    const sameColor = newColor === projectColor;
    const newIsMoreUrgent = newDeadline <= projectDeadline;
    
    let impactHours = 0;
    let reason = '';
    let reasonHe = '';
    
    if (sameColor && newIsMoreUrgent) {
      // Same color + earlier deadline = high impact
      impactHours = newProjectHours * SAME_COLOR_IMPACT_MULTIPLIER;
      reason = 'Same color, competing for printer time';
      reasonHe = 'אותו צבע, מתחרה על זמן מדפסת';
    } else if (newIsMoreUrgent) {
      // Different color but earlier deadline = medium impact
      impactHours = newProjectHours * DIFFERENT_COLOR_IMPACT_MULTIPLIER;
      reason = 'Earlier deadline, may delay this project';
      reasonHe = 'דדליין מוקדם יותר, עלול לעכב פרויקט זה';
    }
    
    const estimatedSlackAfter = currentSlack - impactHours;
    const wouldMissDeadline = currentSlack > 0 && estimatedSlackAfter < 0;
    const slackDropped = currentSlack >= SLACK_THRESHOLD_HOURS && estimatedSlackAfter < SLACK_THRESHOLD_HOURS;
    
    if (wouldMissDeadline || slackDropped) {
      affectedProjects.push({
        projectId: project.id,
        projectName: project.name,
        currentSlackHours: Math.round(currentSlack * 10) / 10,
        estimatedSlackAfter: Math.round(estimatedSlackAfter * 10) / 10,
        wouldMissDeadline,
        reason,
        reasonHe,
      });
    }
  }
  
  // Add summary note if there are affected projects
  if (affectedProjects.length > 0) {
    const missCount = affectedProjects.filter(p => p.wouldMissDeadline).length;
    if (missCount > 0) {
      notes.push({
        type: 'error',
        text: `Warning: ${missCount} existing project(s) may miss deadline`,
        textHe: `אזהרה: ${missCount} פרויקט(ים) קיימים עלולים לפספס דדליין`,
      });
    } else {
      notes.push({
        type: 'warning',
        text: `${affectedProjects.length} project(s) will have reduced margin`,
        textHe: `ל-${affectedProjects.length} פרויקט(ים) יהיה מרווח מצומצם`,
      });
    }
  }
}

function determineFeasibilityAndRisk(
  quantity: number,
  availableCapacity: number,
  requiredDays: number,
  daysAvailable: number,
  affectedProjects: AffectedProject[],
  urgency: 'normal' | 'urgent' | 'critical'
): { feasible: boolean; riskLevel: RiskLevel } {
  // Apply safety margin for conservative estimate
  const safeCapacity = availableCapacity * (1 - SAFETY_MARGIN);
  
  // Check if any project would miss deadline
  const wouldCauseMissedDeadline = affectedProjects.some(p => p.wouldMissDeadline);
  
  // Calculate feasibility
  const hasCapacity = quantity <= safeCapacity;
  const hasTime = requiredDays <= daysAvailable;
  
  if (wouldCauseMissedDeadline) {
    // Critical: would cause other projects to miss deadlines
    return { feasible: false, riskLevel: 'critical' };
  }
  
  if (hasCapacity && hasTime) {
    // Check utilization for risk level
    const utilization = quantity / safeCapacity;
    
    if (utilization < 0.6) {
      return { feasible: true, riskLevel: 'low' };
    } else if (utilization < 0.85) {
      return { feasible: true, riskLevel: 'medium' };
    } else {
      // High utilization = higher risk
      return { feasible: true, riskLevel: urgency === 'critical' ? 'high' : 'medium' };
    }
  }
  
  if (quantity <= availableCapacity * 1.3 && hasTime) {
    // Possible with adjustments
    return { feasible: false, riskLevel: 'high' };
  }
  
  // Cannot accept
  return { feasible: false, riskLevel: 'critical' };
}
