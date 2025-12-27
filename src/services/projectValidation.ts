// Project Validation Service
// Validates if a project can be planned and provides clear feedback

import {
  Project,
  Product,
  Printer,
  FactorySettings,
  Spool,
  getProducts,
  getProduct,
  getActivePrinters,
  getFactorySettings,
  getSpools,
  getDayScheduleForDate,
} from './storage';

export interface ValidationIssue {
  type: 'error' | 'warning';
  code: string;
  message: string;
  messageEn: string;
}

export interface ProjectValidationResult {
  canPlan: boolean;
  issues: ValidationIssue[];
  willAutoReplan: boolean;
  autoReplanDelayMs: number;
}

// Validate if a project can be planned
export const validateProjectForPlanning = (project: Project): ProjectValidationResult => {
  const issues: ValidationIssue[] = [];
  
  // Check 1: Active printers
  const activePrinters = getActivePrinters();
  if (activePrinters.length === 0) {
    issues.push({
      type: 'error',
      code: 'NO_ACTIVE_PRINTERS',
      message: 'אין מדפסות פעילות',
      messageEn: 'No active printers',
    });
  }

  // Check 2: Product exists and has plate layouts
  const product = getProduct(project.productId);
  if (!product) {
    issues.push({
      type: 'error',
      code: 'PRODUCT_NOT_FOUND',
      message: 'המוצר לא נמצא',
      messageEn: 'Product not found',
    });
  } else {
    if (!product.platePresets || product.platePresets.length === 0) {
      issues.push({
        type: 'error',
        code: 'NO_PLATE_PRESETS',
        message: 'למוצר אין פריסות (plate presets) מוגדרות',
        messageEn: 'Product has no plate presets defined',
      });
    } else {
      // Check if any preset has valid unitsPerPlate and cycleHours
      const validPresets = product.platePresets.filter(p => p.unitsPerPlate > 0 && p.cycleHours > 0);
      if (validPresets.length === 0) {
        issues.push({
          type: 'error',
          code: 'INVALID_PLATE_PRESETS',
          message: 'לכל הפריסות חסרים ערכים: unitsPerPlate או cycleHours',
          messageEn: 'All plate presets missing unitsPerPlate or cycleHours values',
        });
      }
    }

    if (!product.gramsPerUnit || product.gramsPerUnit <= 0) {
      issues.push({
        type: 'warning',
        code: 'NO_GRAMS_PER_UNIT',
        message: 'לא הוגדר צריכת חומר ליחידה (gramsPerUnit)',
        messageEn: 'No material consumption per unit defined (gramsPerUnit)',
      });
    }
  }

  // Check 3: Factory settings exist
  const settings = getFactorySettings();
  if (!settings) {
    issues.push({
      type: 'error',
      code: 'NO_FACTORY_SETTINGS',
      message: 'חסרות הגדרות מפעל',
      messageEn: 'Missing factory settings',
    });
  } else {
    // Check if there are working days configured
    const today = new Date();
    let hasWorkingDays = false;
    for (let i = 0; i < 7; i++) {
      const checkDate = new Date(today);
      checkDate.setDate(checkDate.getDate() + i);
      const schedule = getDayScheduleForDate(checkDate, settings, []);
      if (schedule?.enabled) {
        hasWorkingDays = true;
        break;
      }
    }
    
    if (!hasWorkingDays) {
      issues.push({
        type: 'warning',
        code: 'NO_WORKING_DAYS',
        message: 'אין ימי עבודה מוגדרים ב-7 הימים הקרובים',
        messageEn: 'No working days configured in the next 7 days',
      });
    }
  }

  // Check 4: Quantity and due date
  if (!project.quantityTarget || project.quantityTarget <= 0) {
    issues.push({
      type: 'error',
      code: 'INVALID_QUANTITY',
      message: 'כמות יעד לא תקינה',
      messageEn: 'Invalid target quantity',
    });
  }

  if (!project.dueDate) {
    issues.push({
      type: 'error',
      code: 'NO_DUE_DATE',
      message: 'לא הוגדר תאריך יעד',
      messageEn: 'No due date specified',
    });
  } else {
    const dueDate = new Date(project.dueDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (dueDate < today) {
      issues.push({
        type: 'warning',
        code: 'PAST_DUE_DATE',
        message: 'תאריך היעד עבר',
        messageEn: 'Due date is in the past',
      });
    }
  }

  // Check 5: Material availability (warning only)
  if (product && product.gramsPerUnit > 0 && project.quantityTarget > 0) {
    const spools = getSpools();
    const color = project.color.toLowerCase();
    const availableGrams = spools
      .filter(s => s.color.toLowerCase() === color && s.state !== 'empty')
      .reduce((sum, s) => sum + s.gramsRemainingEst, 0);
    
    const neededGrams = product.gramsPerUnit * project.quantityTarget;
    
    if (availableGrams < neededGrams) {
      issues.push({
        type: 'warning',
        code: 'INSUFFICIENT_MATERIAL',
        message: `אין מספיק חומר בצבע ${project.color}: נדרשים ${Math.ceil(neededGrams)}g, זמינים ${Math.ceil(availableGrams)}g`,
        messageEn: `Insufficient ${project.color} material: need ${Math.ceil(neededGrams)}g, have ${Math.ceil(availableGrams)}g`,
      });
    }
  }

  // Check 6: Project status
  if (project.status !== 'in_progress' && project.status !== 'pending') {
    issues.push({
      type: 'warning',
      code: 'NOT_ACTIVE_STATUS',
      message: `סטטוס הפרויקט הוא "${project.status}" - לא יתוזמן אוטומטית`,
      messageEn: `Project status is "${project.status}" - won't be scheduled automatically`,
    });
  }

  // Determine if can plan (no errors)
  const hasErrors = issues.some(i => i.type === 'error');
  const canPlan = !hasErrors;

  return {
    canPlan,
    issues,
    willAutoReplan: canPlan,
    autoReplanDelayMs: 1500, // matches DEBOUNCE_MS in autoReplan.ts
  };
};

// Get a summary message for toast
export const getValidationSummary = (result: ProjectValidationResult, language: 'he' | 'en'): {
  title: string;
  description: string;
  variant: 'default' | 'destructive';
} => {
  if (result.canPlan && result.issues.length === 0) {
    return {
      title: language === 'he' ? 'פרויקט נשמר' : 'Project saved',
      description: language === 'he' 
        ? `התכנון יתעדכן אוטומטית תוך ${result.autoReplanDelayMs / 1000} שניות`
        : `Planning will auto-update in ${result.autoReplanDelayMs / 1000} seconds`,
      variant: 'default',
    };
  }

  if (result.canPlan && result.issues.length > 0) {
    const warningMessages = result.issues
      .map(i => language === 'he' ? i.message : i.messageEn)
      .join('\n');
    
    return {
      title: language === 'he' ? 'פרויקט נשמר עם אזהרות' : 'Project saved with warnings',
      description: warningMessages,
      variant: 'default',
    };
  }

  // Has errors - cannot plan
  const errorMessages = result.issues
    .filter(i => i.type === 'error')
    .map(i => language === 'he' ? i.message : i.messageEn)
    .join('\n');

  return {
    title: language === 'he' ? 'פרויקט נשמר אך לא יתוכנן' : 'Project saved but NOT planned',
    description: language === 'he' 
      ? `חסרים נתונים:\n${errorMessages}`
      : `Missing required data:\n${errorMessages}`,
    variant: 'destructive',
  };
};
