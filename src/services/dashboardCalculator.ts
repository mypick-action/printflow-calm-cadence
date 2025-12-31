// Dashboard Planning Calculator
// Calculates today's production plan from core system data
// Dashboard = Calculation, NOT Storage

import { 
  getFactorySettings,
  getActivePrinters,
  getProjectsSync,
  getProducts,
  getPlannedCycles,
  getProduct,
  getDayScheduleForDate,
  calculateDaysRemaining,
  calculatePriorityFromDueDate,
  PlannedCycle,
  Printer,
  Project,
  Product,
  PlatePreset,
  FactorySettings,
} from './storage';
import { format, addMinutes, parseISO } from 'date-fns';
import { isSameLocalDay } from './dateUtils';

// ============= TYPES =============

export interface DashboardCycle {
  id: string;
  projectId: string;
  projectName: string;
  productName: string;
  productId: string;
  printerId: string;
  printerName: string;
  units: number;
  gramsNeeded: number;
  color: string;
  material: string;
  startTime: string;
  endTime: string;
  cycleHours: number;
  isEndOfDay: boolean;
  isRisky: boolean;
  hasAMS: boolean;
  status: PlannedCycle['status'];
  presetName?: string;
}

export interface PrinterDayPlan {
  printer: Printer;
  cycles: DashboardCycle[];
  totalUnits: number;
  totalHours: number;
  lastColor?: string;
  isFullyScheduled: boolean;
}

export interface AttentionItem {
  type: 'urgent' | 'critical' | 'filament' | 'time_overflow' | 'no_preset' | 'printer_inactive' | 'issue_reported';
  message: string;
  messageEn: string;
  projectId?: string;
  printerId?: string;
  severity: 'warning' | 'error';
}

export interface TodayPlanResult {
  printerPlans: PrinterDayPlan[];
  attentionItems: AttentionItem[];
  isAllReady: boolean;
  totalCycles: number;
  totalUnits: number;
  workdayStart: string;
  workdayEnd: string;
  isWorkday: boolean;
  lastCalculatedAt: string;
  missingData: { type: string; message: string; messageEn: string }[];
}

// ============= HELPERS =============

const formatTime = (date: Date): string => {
  return format(date, 'HH:mm');
};

const parseTimeToMinutes = (time: string): number => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

const minutesToTime = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};

// ============= MAIN CALCULATOR =============

export const calculateTodayPlan = (targetDate: Date = new Date()): TodayPlanResult => {
  const settings = getFactorySettings();
  const printers = getActivePrinters();
  const allProjects = getProjectsSync();
  const allProducts = getProducts();
  const plannedCycles = getPlannedCycles();
  
  const missingData: TodayPlanResult['missingData'] = [];
  const attentionItems: AttentionItem[] = [];
  
  // Check for missing data
  if (!settings) {
    return {
      printerPlans: [],
      attentionItems: [],
      isAllReady: false,
      totalCycles: 0,
      totalUnits: 0,
      workdayStart: '08:30',
      workdayEnd: '17:30',
      isWorkday: false,
      lastCalculatedAt: new Date().toISOString(),
      missingData: [{ type: 'settings', message: 'חסרות הגדרות מפעל', messageEn: 'Missing factory settings' }],
    };
  }
  
  // Get today's schedule
  const daySchedule = getDayScheduleForDate(targetDate, settings, []);
  const isWorkday = daySchedule?.enabled ?? false;
  const workdayStart = daySchedule?.startTime || '08:30';
  const workdayEnd = daySchedule?.endTime || '17:30';
  
  if (!isWorkday) {
    return {
      printerPlans: printers.map(p => ({
        printer: p,
        cycles: [],
        totalUnits: 0,
        totalHours: 0,
        isFullyScheduled: false,
      })),
      attentionItems: [],
      isAllReady: true,
      totalCycles: 0,
      totalUnits: 0,
      workdayStart,
      workdayEnd,
      isWorkday: false,
      lastCalculatedAt: new Date().toISOString(),
      missingData: [],
    };
  }
  
  if (printers.length === 0) {
    missingData.push({ type: 'printers', message: 'אין מדפסות פעילות', messageEn: 'No active printers' });
  }
  
  // Get projects that are either in_progress OR pending with planned cycles
  // This ensures we show projects that are scheduled for execution
  const projectIdsWithCycles = new Set(plannedCycles.map(c => c.projectId));
  const activeProjects = allProjects.filter(p => 
    p.status === 'in_progress' || 
    (p.status === 'pending' && projectIdsWithCycles.has(p.id))
  );
  
  // Build product lookup
  const productMap = new Map<string, Product>();
  allProducts.forEach(p => productMap.set(p.id, p));
  
  // Check for projects with missing product data - DEDUPLICATED
  const projectsWithMissingProduct: string[] = [];
  activeProjects.forEach(project => {
    const product = productMap.get(project.productId);
    if (!product) {
      projectsWithMissingProduct.push(project.name);
      return;
    }
    
    const preset = product.platePresets.find(p => p.isRecommended) || product.platePresets[0];
    if (!preset) {
      attentionItems.push({
        type: 'no_preset',
        message: `חסרים נתוני פריסה למוצר: ${product.name}`,
        messageEn: `Missing plate preset for product: ${product.name}`,
        projectId: project.id,
        severity: 'error',
      });
    }
  });
  
  // Add single deduplicated warning for missing products
  if (projectsWithMissingProduct.length > 0) {
    missingData.push({ 
      type: 'product', 
      message: `מוצר חסר ל-${projectsWithMissingProduct.length} פרויקטים`, 
      messageEn: `Product missing for ${projectsWithMissingProduct.length} projects` 
    });
  }
  
  // Filter cycles for today - only show active cycles (planned or in_progress)
  // Completed/failed/cancelled cycles should not appear in the dashboard
  const todayCycles = plannedCycles.filter(cycle => {
    const cycleDate = new Date(cycle.startTime);
    const isToday = isSameLocalDay(cycleDate, targetDate);
    const isActiveStatus = cycle.status === 'planned' || cycle.status === 'in_progress';
    return isToday && isActiveStatus;
  });
  
  // DEBUG: Log cycle date distribution
  if (plannedCycles.length > 0) {
    const dateDistribution: Record<string, number> = {};
    plannedCycles.forEach(c => {
      const dateKey = c.startTime.split('T')[0];
      dateDistribution[dateKey] = (dateDistribution[dateKey] || 0) + 1;
    });
    console.log('[DashboardCalculator] Cycle date distribution:', dateDistribution);
    console.log('[DashboardCalculator] Target date:', format(targetDate, 'yyyy-MM-dd'));
    console.log('[DashboardCalculator] Total cycles:', plannedCycles.length, '→ Today:', todayCycles.length);
  }
  
  // Build printer plans
  const printerPlans: PrinterDayPlan[] = printers.map(printer => {
    const printerCycles = todayCycles
      .filter(c => c.printerId === printer.id)
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    
    const dashboardCycles: DashboardCycle[] = printerCycles.map(cycle => {
      const project = allProjects.find(p => p.id === cycle.projectId);
      const product = project ? productMap.get(project.productId) : undefined;
      const preset = product?.platePresets.find(p => p.isRecommended) || product?.platePresets[0];
      
      const startTime = new Date(cycle.startTime);
      const endTime = new Date(cycle.endTime);
      const cycleHours = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);
      
      return {
        id: cycle.id,
        projectId: cycle.projectId,
        projectName: project?.name || 'Unknown',
        productName: product?.name || project?.productName || 'ללא מוצר',
        productId: project?.productId || '',
        printerId: cycle.printerId,
        printerName: printer.name,
        units: cycle.unitsPlanned,
        gramsNeeded: cycle.gramsPlanned,
        color: project?.color || 'Unknown',
        material: 'PLA', // Default material - projects don't have material field yet
        startTime: formatTime(startTime),
        endTime: formatTime(endTime),
        cycleHours,
        isEndOfDay: cycle.shift === 'end_of_day',
        isRisky: preset?.riskLevel === 'high' || preset?.riskLevel === 'medium',
        hasAMS: printer.hasAMS,
        status: cycle.status,
        presetName: preset?.name,
      };
    });
    
    const totalUnits = dashboardCycles.reduce((sum, c) => sum + c.units, 0);
    const totalHours = dashboardCycles.reduce((sum, c) => sum + c.cycleHours, 0);
    const lastCycle = dashboardCycles[dashboardCycles.length - 1];
    
    // Check if day is fully scheduled
    const dayHours = (parseTimeToMinutes(workdayEnd) - parseTimeToMinutes(workdayStart)) / 60;
    const isFullyScheduled = totalHours >= dayHours * 0.8; // 80% threshold
    
    return {
      printer,
      cycles: dashboardCycles,
      totalUnits,
      totalHours,
      lastColor: lastCycle?.color,
      isFullyScheduled,
    };
  });
  
  // Check for attention items
  // CRITICAL FIX: Calculate urgency dynamically based on current days remaining
  // Don't rely on stored project.urgency which may be outdated
  activeProjects.forEach(project => {
    const days = calculateDaysRemaining(project.dueDate);
    
    // Calculate current urgency based on days remaining
    const currentUrgency = calculatePriorityFromDueDate(project.dueDate);
    
    if (currentUrgency === 'critical') {
      attentionItems.push({
        type: 'critical',
        message: `פרויקט קריטי: ${project.name} (${days} ימים ליעד)`,
        messageEn: `Critical project: ${project.name} (${days} days to due)`,
        projectId: project.id,
        severity: 'error',
      });
    } else if (currentUrgency === 'urgent') {
      attentionItems.push({
        type: 'urgent',
        message: `פרויקט דחוף: ${project.name} (${days} ימים ליעד)`,
        messageEn: `Urgent project: ${project.name} (${days} days to due)`,
        projectId: project.id,
        severity: 'warning',
      });
    }
  });
  
  // Check for cycles that exceed day hours
  printerPlans.forEach(plan => {
    plan.cycles.forEach(cycle => {
      const endMinutes = parseTimeToMinutes(cycle.endTime);
      const dayEndMinutes = parseTimeToMinutes(workdayEnd);
      
      if (endMinutes > dayEndMinutes && !cycle.isEndOfDay) {
        attentionItems.push({
          type: 'time_overflow',
          message: `מחזור חורג משעות העבודה: ${cycle.projectName} (${plan.printer.name})`,
          messageEn: `Cycle exceeds work hours: ${cycle.projectName} (${plan.printer.name})`,
          projectId: cycle.projectId,
          printerId: cycle.printerId,
          severity: 'warning',
        });
      }
    });
  });
  
  const totalCycles = printerPlans.reduce((sum, p) => sum + p.cycles.length, 0);
  const totalUnits = printerPlans.reduce((sum, p) => sum + p.totalUnits, 0);
  
  // Determine if all is ready
  const isAllReady = 
    missingData.length === 0 && 
    attentionItems.filter(a => a.severity === 'error').length === 0 &&
    totalCycles > 0;
  
  return {
    printerPlans,
    attentionItems,
    isAllReady,
    totalCycles,
    totalUnits,
    workdayStart,
    workdayEnd,
    isWorkday,
    lastCalculatedAt: new Date().toISOString(),
    missingData,
  };
};

// ============= SUMMARY HELPERS =============

export interface DashboardSummary {
  activeProjects: number;
  plannedProjects: number;
  waitingProjects: number;
  criticalProjects: number;
  urgentProjects: number;
  activePrinters: number;
  todayCycles: number;
  todayUnits: number;
}

export const getDashboardSummary = (): DashboardSummary => {
  const projects = getProjectsSync();
  const printers = getActivePrinters();
  const todayPlan = calculateTodayPlan();
  
  return {
    activeProjects: projects.filter(p => p.status === 'in_progress').length,
    plannedProjects: projects.filter(p => p.status === 'pending').length,
    waitingProjects: projects.filter(p => p.status === 'on_hold').length,
    criticalProjects: projects.filter(p => p.status !== 'completed' && p.urgency === 'critical').length,
    urgentProjects: projects.filter(p => p.status !== 'completed' && p.urgency === 'urgent').length,
    activePrinters: printers.length,
    todayCycles: todayPlan.totalCycles,
    todayUnits: todayPlan.totalUnits,
  };
};
