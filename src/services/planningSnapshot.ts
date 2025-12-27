// ============= PLANNING SNAPSHOT SERVICE =============
// Tracks changes between planning runs for explainability
// NO AI, NO Cloud - Pure local comparison logic

import {
  getActiveProjects,
  getActivePrinters,
  getSpools,
  getFactorySettings,
  getPlanningMeta,
} from './storage';
import { generatePlan, PlanningWarning } from './planningEngine';

// ============= TYPES =============

export interface PlanningSnapshot {
  capturedAt: string;
  activeProjectsCount: number;
  activePrintersCount: number;
  totalRemainingUnits: number;
  inventoryByColor: Record<string, number>;
  warningsCount: number;
  workScheduleHash: string;
  projectIds: string[];
  printerIds: string[];
}

export interface PlanningChange {
  type: 'projects_added' | 'projects_removed' | 'printers_added' | 'printers_disabled' | 
        'inventory_changed' | 'schedule_changed' | 'warnings_changed' | 'units_changed';
  messageHe: string;
  messageEn: string;
  details?: {
    count?: number;
    color?: string;
    change?: number;
  };
}

export interface ChangeSummary {
  hasChanges: boolean;
  changes: PlanningChange[];
  previousSnapshot: PlanningSnapshot | null;
  currentSnapshot: PlanningSnapshot;
}

// ============= STORAGE =============

const SNAPSHOT_KEY = 'printflow_last_plan_snapshot';

export const getLastPlanningSnapshot = (): PlanningSnapshot | null => {
  try {
    const item = localStorage.getItem(SNAPSHOT_KEY);
    return item ? JSON.parse(item) : null;
  } catch {
    return null;
  }
};

export const savePlanningSnapshot = (snapshot: PlanningSnapshot): void => {
  localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
};

// ============= SNAPSHOT CREATION =============

const createWorkScheduleHash = (): string => {
  const settings = getFactorySettings();
  if (!settings?.weeklySchedule) return 'no-schedule';
  
  // Create a simple hash from schedule
  const parts: string[] = [];
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
  
  for (const day of days) {
    const schedule = settings.weeklySchedule[day];
    if (schedule?.enabled) {
      parts.push(`${day}:${schedule.startTime}-${schedule.endTime}`);
    }
  }
  
  return parts.join('|');
};

export const captureCurrentSnapshot = (): PlanningSnapshot => {
  const projects = getActiveProjects();
  const printers = getActivePrinters();
  const spools = getSpools();
  
  // Calculate inventory by color
  const inventoryByColor: Record<string, number> = {};
  for (const spool of spools) {
    if (spool.state !== 'empty') {
      const color = spool.color.toLowerCase();
      inventoryByColor[color] = (inventoryByColor[color] || 0) + spool.gramsRemainingEst;
    }
  }
  
  // Calculate total remaining units
  const totalRemainingUnits = projects.reduce(
    (sum, p) => sum + Math.max(0, p.quantityTarget - p.quantityGood),
    0
  );
  
  // Get current warnings count
  let warningsCount = 0;
  try {
    const planResult = generatePlan({ daysToPlane: 7 });
    warningsCount = planResult.warnings.length;
  } catch {
    warningsCount = 0;
  }
  
  return {
    capturedAt: new Date().toISOString(),
    activeProjectsCount: projects.length,
    activePrintersCount: printers.length,
    totalRemainingUnits,
    inventoryByColor,
    warningsCount,
    workScheduleHash: createWorkScheduleHash(),
    projectIds: projects.map(p => p.id),
    printerIds: printers.map(p => p.id),
  };
};

// ============= CHANGE DETECTION =============

export const detectChanges = (): ChangeSummary => {
  const previousSnapshot = getLastPlanningSnapshot();
  const currentSnapshot = captureCurrentSnapshot();
  
  const changes: PlanningChange[] = [];
  
  if (!previousSnapshot) {
    // First run - no previous snapshot to compare
    return {
      hasChanges: false,
      changes: [],
      previousSnapshot: null,
      currentSnapshot,
    };
  }
  
  // Compare projects
  const prevProjectIds = new Set(previousSnapshot.projectIds);
  const currProjectIds = new Set(currentSnapshot.projectIds);
  
  const addedProjects = currentSnapshot.projectIds.filter(id => !prevProjectIds.has(id));
  const removedProjects = previousSnapshot.projectIds.filter(id => !currProjectIds.has(id));
  
  if (addedProjects.length > 0) {
    changes.push({
      type: 'projects_added',
      messageHe: `נוספו ${addedProjects.length} פרויקטים`,
      messageEn: `${addedProjects.length} project(s) added`,
      details: { count: addedProjects.length },
    });
  }
  
  if (removedProjects.length > 0) {
    changes.push({
      type: 'projects_removed',
      messageHe: `הוסרו ${removedProjects.length} פרויקטים`,
      messageEn: `${removedProjects.length} project(s) removed/completed`,
      details: { count: removedProjects.length },
    });
  }
  
  // Compare printers
  const prevPrinterIds = new Set(previousSnapshot.printerIds);
  const currPrinterIds = new Set(currentSnapshot.printerIds);
  
  const addedPrinters = currentSnapshot.printerIds.filter(id => !prevPrinterIds.has(id));
  const removedPrinters = previousSnapshot.printerIds.filter(id => !currPrinterIds.has(id));
  
  if (addedPrinters.length > 0) {
    changes.push({
      type: 'printers_added',
      messageHe: `נוספו ${addedPrinters.length} מדפסות פעילות`,
      messageEn: `${addedPrinters.length} printer(s) activated`,
      details: { count: addedPrinters.length },
    });
  }
  
  if (removedPrinters.length > 0) {
    changes.push({
      type: 'printers_disabled',
      messageHe: `${removedPrinters.length} מדפסות הושבתו`,
      messageEn: `${removedPrinters.length} printer(s) disabled`,
      details: { count: removedPrinters.length },
    });
  }
  
  // Compare inventory changes (significant changes > 50g)
  const allColors = new Set([
    ...Object.keys(previousSnapshot.inventoryByColor),
    ...Object.keys(currentSnapshot.inventoryByColor),
  ]);
  
  for (const color of allColors) {
    const prev = previousSnapshot.inventoryByColor[color] || 0;
    const curr = currentSnapshot.inventoryByColor[color] || 0;
    const diff = curr - prev;
    
    if (Math.abs(diff) >= 50) {
      if (diff < 0) {
        changes.push({
          type: 'inventory_changed',
          messageHe: `המלאי בצבע ${color} ירד ב-${Math.abs(Math.round(diff))}g`,
          messageEn: `${color} inventory decreased by ${Math.abs(Math.round(diff))}g`,
          details: { color, change: diff },
        });
      } else {
        changes.push({
          type: 'inventory_changed',
          messageHe: `המלאי בצבע ${color} עלה ב-${Math.round(diff)}g`,
          messageEn: `${color} inventory increased by ${Math.round(diff)}g`,
          details: { color, change: diff },
        });
      }
    }
  }
  
  // Compare work schedule
  if (previousSnapshot.workScheduleHash !== currentSnapshot.workScheduleHash) {
    changes.push({
      type: 'schedule_changed',
      messageHe: 'שעות העבודה עודכנו',
      messageEn: 'Work schedule updated',
    });
  }
  
  // Compare warnings count
  const warningsDiff = currentSnapshot.warningsCount - previousSnapshot.warningsCount;
  if (warningsDiff > 0) {
    changes.push({
      type: 'warnings_changed',
      messageHe: `נוצרו ${warningsDiff} אזהרות חדשות`,
      messageEn: `${warningsDiff} new warning(s) detected`,
      details: { count: warningsDiff },
    });
  } else if (warningsDiff < 0) {
    changes.push({
      type: 'warnings_changed',
      messageHe: `${Math.abs(warningsDiff)} אזהרות נפתרו`,
      messageEn: `${Math.abs(warningsDiff)} warning(s) resolved`,
      details: { count: warningsDiff },
    });
  }
  
  // Compare remaining units (significant change > 10)
  const unitsDiff = currentSnapshot.totalRemainingUnits - previousSnapshot.totalRemainingUnits;
  if (Math.abs(unitsDiff) >= 10) {
    if (unitsDiff > 0) {
      changes.push({
        type: 'units_changed',
        messageHe: `נוספו ${unitsDiff} יחידות לייצור`,
        messageEn: `${unitsDiff} units added to production`,
        details: { change: unitsDiff },
      });
    } else {
      changes.push({
        type: 'units_changed',
        messageHe: `${Math.abs(unitsDiff)} יחידות הושלמו`,
        messageEn: `${Math.abs(unitsDiff)} units completed`,
        details: { change: unitsDiff },
      });
    }
  }
  
  // Limit to max 6 changes
  const limitedChanges = changes.slice(0, 6);
  
  return {
    hasChanges: limitedChanges.length > 0,
    changes: limitedChanges,
    previousSnapshot,
    currentSnapshot,
  };
};

// ============= SAVE AFTER SUCCESSFUL PLAN =============

export const saveSnapshotAfterPlan = (): void => {
  const snapshot = captureCurrentSnapshot();
  savePlanningSnapshot(snapshot);
};
