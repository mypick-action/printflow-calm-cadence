// Constraint Calculator for Planning
// Calculates constraints for cycle planning WITHOUT guessing solutions

import { 
  getFactorySettings,
  getDayScheduleForDate,
  getAvailableFilamentForPrinter,
  getProduct,
  getProject,
  getPrinter,
  PlatePreset,
  Product,
  PlannedCycle,
} from './storage';

export interface PlanningConstraints {
  maxCycleHours: number;
  maxFilamentGrams: number;
  preferLowRisk: boolean;
  mustAllowNightCycle: boolean;
  reason: 'time' | 'filament' | 'risk' | 'combined';
}

export interface ConstraintViolation {
  type: 'time' | 'filament' | 'risk' | 'night';
  message: string;
  messageEn: string;
  details: string;
  detailsEn: string;
}

export interface PresetFitResult {
  fits: boolean;
  violations: ConstraintViolation[];
  fitsTime: boolean;
  fitsFilament: boolean;
  fitsRisk: boolean;
  fitsNight: boolean;
}

// Format hours to human readable (e.g., 2.25 -> "2h15m")
export const formatHoursToHuman = (hours: number): string => {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (m === 0) return `${h}h`;
  return `${h}h${m.toString().padStart(2, '0')}m`;
};

// Calculate remaining work hours for today
export const calculateRemainingWorkHours = (
  currentTime: Date = new Date()
): { hoursRemaining: number; endTime: string } | null => {
  const settings = getFactorySettings();
  if (!settings) return null;
  
  const daySchedule = getDayScheduleForDate(currentTime, settings, []);
  if (!daySchedule || !daySchedule.enabled) return null;
  
  const [endH, endM] = daySchedule.endTime.split(':').map(Number);
  const endMinutes = endH * 60 + endM;
  const currentMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();
  
  const remainingMinutes = endMinutes - currentMinutes;
  if (remainingMinutes <= 0) return null;
  
  return {
    hoursRemaining: remainingMinutes / 60,
    endTime: daySchedule.endTime,
  };
};

// Calculate constraints for the current situation
export const calculatePlanningConstraints = (
  printerId: string,
  projectId: string,
  currentTime: Date = new Date()
): PlanningConstraints | null => {
  const project = getProject(projectId);
  const printer = getPrinter(printerId);
  const settings = getFactorySettings();
  
  if (!project || !printer || !settings) return null;
  
  const remaining = calculateRemainingWorkHours(currentTime);
  if (!remaining) return null;
  
  const { totalGrams } = getAvailableFilamentForPrinter(
    printerId,
    project.color,
    printer
  );
  
  const product = getProduct(project.productId);
  if (!product) return null;
  
  // Check if we're near end of day and it's unattended time
  const isUnattendedTime = remaining.hoursRemaining <= 2;
  
  return {
    maxCycleHours: remaining.hoursRemaining,
    maxFilamentGrams: totalGrams,
    preferLowRisk: isUnattendedTime,
    mustAllowNightCycle: isUnattendedTime && settings.afterHoursBehavior !== 'NONE',
    reason: 'combined',
  };
};

// Check if a preset fits the given constraints
export const checkPresetFitsConstraints = (
  preset: PlatePreset,
  product: Product,
  constraints: PlanningConstraints
): PresetFitResult => {
  const violations: ConstraintViolation[] = [];
  
  const gramsPerCycle = product.gramsPerUnit * preset.unitsPerPlate;
  
  // Time check
  const fitsTime = preset.cycleHours <= constraints.maxCycleHours;
  if (!fitsTime) {
    violations.push({
      type: 'time',
      message: `מחזור ארוך מדי (${formatHoursToHuman(preset.cycleHours)} מתוך ${formatHoursToHuman(constraints.maxCycleHours)} זמינים)`,
      messageEn: `Cycle too long (${formatHoursToHuman(preset.cycleHours)} of ${formatHoursToHuman(constraints.maxCycleHours)} available)`,
      details: `זמן מחזור: ${formatHoursToHuman(preset.cycleHours)}`,
      detailsEn: `Cycle time: ${formatHoursToHuman(preset.cycleHours)}`,
    });
  }
  
  // Filament check
  const fitsFilament = gramsPerCycle <= constraints.maxFilamentGrams;
  if (!fitsFilament) {
    violations.push({
      type: 'filament',
      message: `לא מספיק חומר (${gramsPerCycle}g נדרש, ${constraints.maxFilamentGrams}g זמין)`,
      messageEn: `Insufficient filament (${gramsPerCycle}g needed, ${constraints.maxFilamentGrams}g available)`,
      details: `חומר נדרש: ${gramsPerCycle}g`,
      detailsEn: `Filament needed: ${gramsPerCycle}g`,
    });
  }
  
  // Risk check (only if preferred)
  const fitsRisk = !constraints.preferLowRisk || preset.riskLevel === 'low';
  if (!fitsRisk) {
    violations.push({
      type: 'risk',
      message: `רמת סיכון ${preset.riskLevel === 'high' ? 'גבוהה' : 'בינונית'} - מומלץ נמוכה`,
      messageEn: `Risk level ${preset.riskLevel} - low recommended`,
      details: `סיכון: ${preset.riskLevel}`,
      detailsEn: `Risk: ${preset.riskLevel}`,
    });
  }
  
  // Night cycle check
  const fitsNight = !constraints.mustAllowNightCycle || preset.allowedForNightCycle;
  if (!fitsNight) {
    violations.push({
      type: 'night',
      message: 'פריסה זו לא מאושרת להדפסת לילה',
      messageEn: 'This preset is not allowed for night printing',
      details: 'לא מותר בלילה',
      detailsEn: 'Not allowed at night',
    });
  }
  
  return {
    fits: fitsTime && fitsFilament && fitsRisk && fitsNight,
    violations,
    fitsTime,
    fitsFilament,
    fitsRisk,
    fitsNight,
  };
};

// Find which existing presets fit the constraints
export const findFittingPresets = (
  product: Product,
  constraints: PlanningConstraints
): { preset: PlatePreset; result: PresetFitResult }[] => {
  return product.platePresets.map(preset => ({
    preset,
    result: checkPresetFitsConstraints(preset, product, constraints),
  }));
};

// Generate human-friendly problem description
export const generateProblemDescription = (
  constraints: PlanningConstraints,
  currentPreset: PlatePreset,
  product: Product,
  language: 'he' | 'en'
): { title: string; description: string; constraintSummary: string } => {
  const result = checkPresetFitsConstraints(currentPreset, product, constraints);
  
  if (language === 'he') {
    const title = 'פריסת הפלטה הנוכחית לא מתאימה';
    let description = '';
    
    if (!result.fitsTime) {
      description = `הפריסה הנוכחית (${formatHoursToHuman(currentPreset.cycleHours)}) לא תסתיים בזמן הנותר להיום.`;
    } else if (!result.fitsFilament) {
      const grams = product.gramsPerUnit * currentPreset.unitsPerPlate;
      description = `אין מספיק חומר להשלמת הפריסה הנוכחית (${grams}g).`;
    } else if (!result.fitsNight) {
      description = 'הפריסה הנוכחית לא מאושרת להדפסה ללא השגחה.';
    }
    
    const constraintSummary = `כדי להמשיך היום, נדרשת פריסה עם:\n• זמן מחזור עד ${formatHoursToHuman(constraints.maxCycleHours)}\n• חומר עד ${constraints.maxFilamentGrams}g`;
    
    return { title, description, constraintSummary };
  }
  
  const title = 'Current plate preset does not fit';
  let description = '';
  
  if (!result.fitsTime) {
    description = `The current preset (${formatHoursToHuman(currentPreset.cycleHours)}) will not finish within today's remaining time.`;
  } else if (!result.fitsFilament) {
    const grams = product.gramsPerUnit * currentPreset.unitsPerPlate;
    description = `Not enough filament for the current preset (${grams}g needed).`;
  } else if (!result.fitsNight) {
    description = 'The current preset is not allowed for unattended printing.';
  }
  
  const constraintSummary = `To continue today, a preset is required with:\n• Cycle time up to ${formatHoursToHuman(constraints.maxCycleHours)}\n• Filament up to ${constraints.maxFilamentGrams}g`;
  
  return { title, description, constraintSummary };
};

// Validate a new preset against constraints (for guided creation)
export const validateNewPreset = (
  unitsPerPlate: number,
  cycleHours: number,
  riskLevel: 'low' | 'medium' | 'high',
  allowedForNightCycle: boolean,
  gramsPerUnit: number,
  constraints: PlanningConstraints
): PresetFitResult => {
  const tempPreset: PlatePreset = {
    id: 'temp',
    name: 'temp',
    unitsPerPlate,
    cycleHours,
    riskLevel,
    allowedForNightCycle,
    isRecommended: false,
  };
  
  const tempProduct: Product = {
    id: 'temp',
    name: 'temp',
    gramsPerUnit,
    platePresets: [],
  };
  
  return checkPresetFitsConstraints(tempPreset, tempProduct, constraints);
};
