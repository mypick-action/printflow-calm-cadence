// Data service layer for PrintFlow
// This layer abstracts localStorage so we can swap to a real DB later

// ============= TYPES =============

export interface PlatePreset {
  id: string;
  name: string;
  unitsPerPlate: number;
  cycleHours: number;
  riskLevel: 'low' | 'medium' | 'high';
  allowedForNightCycle: boolean;
  isRecommended: boolean;
  notes?: string;
}

export interface Product {
  id: string;
  name: string;
  gramsPerUnit: number;
  platePresets: PlatePreset[];
}

// Computed helper for grams per cycle
export const getGramsPerCycle = (product: Product, preset: PlatePreset): number => {
  return product.gramsPerUnit * preset.unitsPerPlate;
};

export interface Project {
  id: string;
  name: string;
  productId: string;
  productName: string;
  preferredPresetId?: string; // optional: override default preset
  quantityTarget: number;
  quantityGood: number;
  quantityScrap: number;
  dueDate: string; // ISO date string
  urgency: 'normal' | 'urgent' | 'critical';
  urgencyManualOverride: boolean; // true if user manually set urgency
  status: 'pending' | 'in_progress' | 'completed' | 'on_hold';
  color: string;
  createdAt: string;
}

export interface Printer {
  id: string;
  name: string;
  active: boolean;
  currentColor?: string;
  currentMaterial?: string;
  hasAMS: boolean;
  amsSlots?: number; // 4 or 8 typically
  amsMode?: 'backup_same_color' | 'multi_color';
  maxSpoolWeight?: number; // max spool size printer supports (1000, 2000, 5000g)
}

export interface Spool {
  id: string;
  color: string;
  material: string;
  packageSize: 1000 | 2000 | 5000; // 1kg, 2kg, 5kg
  gramsRemainingEst: number;
  state: 'new' | 'open' | 'empty';
  location: 'stock' | 'printer' | 'shelf' | 'ams';
  assignedPrinterId?: string;
  amsSlotIndex?: number; // which AMS slot (0-based)
  lastAuditDate?: string;
  lastAuditGrams?: number;
  needsAudit: boolean;
}

export interface DaySchedule {
  enabled: boolean;
  startTime: string;
  endTime: string;
}

export interface WeeklySchedule {
  sunday: DaySchedule;
  monday: DaySchedule;
  tuesday: DaySchedule;
  wednesday: DaySchedule;
  thursday: DaySchedule;
  friday: DaySchedule;
  saturday: DaySchedule;
}

export interface PlannedCycle {
  id: string;
  projectId: string;
  printerId: string;
  unitsPlanned: number;
  gramsPlanned: number;
  plateType: 'full' | 'reduced' | 'closeout';
  startTime: string;
  endTime: string;
  shift: 'day' | 'end_of_day';
  suggestedSpoolId?: string;
  status: 'planned' | 'in_progress' | 'completed' | 'failed';
}

export interface CycleLog {
  id: string;
  printerId: string;
  projectId: string;
  plannedCycleId?: string;
  result: 'completed' | 'completed_with_scrap' | 'failed';
  unitsCompleted: number;
  unitsScrap: number;
  gramsWasted: number;
  timestamp: string;
  notes?: string;
}

export interface IssueReport {
  id: string;
  printerId: string;
  projectId: string;
  issueType: 'power_outage' | 'print_not_started' | 'stopped_mid_cycle' | 'other';
  description?: string;
  unitsPrinted?: number;
  recoveryOption?: string;
  resolved: boolean;
  timestamp: string;
}

export interface PriorityRules {
  urgentDaysThreshold: number; // Days below which it becomes urgent (default 14)
  criticalDaysThreshold: number; // Days below which it becomes critical (default 7)
}

export interface FactorySettings {
  printerCount: number;
  weeklySchedule: WeeklySchedule;
  // Legacy fields for backward compatibility
  workdays?: string[];
  startTime?: string;
  endTime?: string;
  afterHoursBehavior: 'NONE' | 'ONE_CYCLE_END_OF_DAY' | 'FULL_AUTOMATION';
  colors: string[];
  standardSpoolWeight: number;
  deliveryDays: number;
  transitionMinutes: number;
  priorityRules: PriorityRules;
  hasAMS: boolean; // simple flag from onboarding
}

export interface TemporaryScheduleOverride {
  id: string;
  startDate: string;
  endDate: string;
  dayOverrides: Partial<WeeklySchedule>;
}

// Helper to get default weekly schedule
export const getDefaultWeeklySchedule = (): WeeklySchedule => ({
  sunday: { enabled: true, startTime: '08:30', endTime: '17:30' },
  monday: { enabled: true, startTime: '08:30', endTime: '17:30' },
  tuesday: { enabled: true, startTime: '08:30', endTime: '17:30' },
  wednesday: { enabled: true, startTime: '08:30', endTime: '17:30' },
  thursday: { enabled: true, startTime: '08:30', endTime: '17:30' },
  friday: { enabled: true, startTime: '09:00', endTime: '14:00' },
  saturday: { enabled: false, startTime: '09:00', endTime: '14:00' },
});

// Helper to get day schedule for a specific date, considering overrides
export const getDayScheduleForDate = (
  date: Date,
  settings: FactorySettings | null,
  overrides: TemporaryScheduleOverride[]
): DaySchedule | null => {
  if (!settings) return null;
  
  const dayNames: (keyof WeeklySchedule)[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayName = dayNames[date.getDay()];
  
  // Check for temporary overrides first
  for (const override of overrides) {
    const start = new Date(override.startDate);
    const end = new Date(override.endDate);
    if (date >= start && date <= end && override.dayOverrides[dayName]) {
      return override.dayOverrides[dayName]!;
    }
  }
  
  // Fall back to weekly schedule
  return settings.weeklySchedule?.[dayName] || null;
};

// Helper to calculate available filament for a printer (considering AMS)
export const getAvailableFilamentForPrinter = (
  printerId: string,
  color: string,
  printer: Printer
): { totalGrams: number; spools: Spool[]; recommendation?: string } => {
  const spools = getSpools();
  const matchingSpools = spools.filter(s => 
    s.color.toLowerCase() === color.toLowerCase() &&
    s.state !== 'empty' &&
    (s.assignedPrinterId === printerId || s.location === 'stock')
  );
  
  if (printer.hasAMS && printer.amsMode === 'backup_same_color') {
    // AMS backup mode: sum all matching spools in AMS slots
    const amsSpools = matchingSpools.filter(s => s.location === 'ams' && s.assignedPrinterId === printerId);
    const totalGrams = amsSpools.reduce((sum, s) => sum + s.gramsRemainingEst, 0);
    return { totalGrams, spools: amsSpools };
  }
  
  // Non-AMS: single spool only
  const assignedSpool = matchingSpools.find(s => s.assignedPrinterId === printerId);
  if (assignedSpool) {
    return { totalGrams: assignedSpool.gramsRemainingEst, spools: [assignedSpool] };
  }
  
  return { totalGrams: 0, spools: [] };
};

// Helper to check if cycle can proceed and get recommendations
export interface CycleRecommendation {
  canProceed: boolean;
  warnings: string[];
  recommendations: { icon: string; text: string; textEn: string }[];
}

export const checkCycleFilamentRequirements = (
  gramsNeeded: number,
  printerId: string,
  color: string
): CycleRecommendation => {
  const printers = getPrinters();
  const printer = printers.find(p => p.id === printerId);
  if (!printer) {
    return { canProceed: false, warnings: ['Printer not found'], recommendations: [] };
  }
  
  const { totalGrams, spools } = getAvailableFilamentForPrinter(printerId, color, printer);
  const recommendations: CycleRecommendation['recommendations'] = [];
  const warnings: string[] = [];
  
  if (gramsNeeded > totalGrams) {
    warnings.push(`Insufficient filament: need ${gramsNeeded}g, have ${totalGrams}g`);
    
    recommendations.push({
      icon: '📦',
      text: 'השתמש בגליל גדול (2 ק"ג / 5 ק"ג)',
      textEn: 'Use a large spool (2kg / 5kg)'
    });
    
    if (printer.hasAMS) {
      recommendations.push({
        icon: '🔄',
        text: 'השתמש ב-AMS עם מספר גלילים באותו צבע',
        textEn: 'Use AMS with multiple spools of the same color'
      });
    }
    
    recommendations.push({
      icon: '📉',
      text: 'הפחת יחידות למחזור',
      textEn: 'Reduce units per cycle'
    });
    
    return { canProceed: false, warnings, recommendations };
  }
  
  // Check if single spool is sufficient or needs AMS
  if (!printer.hasAMS && spools.length === 1 && spools[0].gramsRemainingEst < gramsNeeded) {
    warnings.push('Single spool insufficient without AMS');
    recommendations.push({
      icon: '🔄',
      text: 'שקול להוסיף AMS לגיבוי אוטומטי',
      textEn: 'Consider adding AMS for automatic backup'
    });
  }
  
  return { canProceed: true, warnings, recommendations };
};

// ============= STORAGE KEYS =============

const KEYS = {
  PRODUCTS: 'printflow_products',
  PROJECTS: 'printflow_projects',
  PRINTERS: 'printflow_printers',
  SPOOLS: 'printflow_spools',
  PLANNED_CYCLES: 'printflow_planned_cycles',
  CYCLE_LOGS: 'printflow_cycle_logs',
  ISSUE_REPORTS: 'printflow_issue_reports',
  FACTORY_SETTINGS: 'printflow_factory_settings',
  ONBOARDING_COMPLETE: 'printflow_onboarding_complete',
};

// ============= HELPERS =============

const generateId = (): string => {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

const getItem = <T>(key: string, defaultValue: T): T => {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch {
    return defaultValue;
  }
};

const setItem = <T>(key: string, value: T): void => {
  localStorage.setItem(key, JSON.stringify(value));
};

// ============= INITIAL/MOCK DATA =============

const initialProducts: Product[] = [
  { 
    id: 'prod-1', 
    name: 'Phone Stand', 
    gramsPerUnit: 45, 
    platePresets: [
      { id: 'preset-1-1', name: 'Full', unitsPerPlate: 8, cycleHours: 2.5, riskLevel: 'low', allowedForNightCycle: true, isRecommended: true },
      { id: 'preset-1-2', name: 'Safe', unitsPerPlate: 6, cycleHours: 2, riskLevel: 'low', allowedForNightCycle: true, isRecommended: false },
      { id: 'preset-1-3', name: 'Night', unitsPerPlate: 4, cycleHours: 1.5, riskLevel: 'low', allowedForNightCycle: true, isRecommended: false },
    ]
  },
  { 
    id: 'prod-2', 
    name: 'Cable Organizer', 
    gramsPerUnit: 12, 
    platePresets: [
      { id: 'preset-2-1', name: 'Full', unitsPerPlate: 20, cycleHours: 1.5, riskLevel: 'low', allowedForNightCycle: true, isRecommended: true },
      { id: 'preset-2-2', name: 'Safe', unitsPerPlate: 15, cycleHours: 1.2, riskLevel: 'low', allowedForNightCycle: true, isRecommended: false },
    ]
  },
  { 
    id: 'prod-3', 
    name: 'Pen Holder', 
    gramsPerUnit: 85, 
    platePresets: [
      { id: 'preset-3-1', name: 'Full', unitsPerPlate: 4, cycleHours: 4, riskLevel: 'medium', allowedForNightCycle: false, isRecommended: false },
      { id: 'preset-3-2', name: 'Safe', unitsPerPlate: 2, cycleHours: 2.5, riskLevel: 'low', allowedForNightCycle: true, isRecommended: true },
    ]
  },
  { 
    id: 'prod-4', 
    name: 'Wall Hook', 
    gramsPerUnit: 18, 
    platePresets: [
      { id: 'preset-4-1', name: 'Full', unitsPerPlate: 24, cycleHours: 1, riskLevel: 'low', allowedForNightCycle: true, isRecommended: true },
      { id: 'preset-4-2', name: 'Low Risk', unitsPerPlate: 16, cycleHours: 0.75, riskLevel: 'low', allowedForNightCycle: true, isRecommended: false },
    ]
  },
  { 
    id: 'prod-5', 
    name: 'Coaster Set', 
    gramsPerUnit: 32, 
    platePresets: [
      { id: 'preset-5-1', name: 'Full', unitsPerPlate: 6, cycleHours: 2, riskLevel: 'medium', allowedForNightCycle: false, isRecommended: false },
      { id: 'preset-5-2', name: 'Safe', unitsPerPlate: 4, cycleHours: 1.5, riskLevel: 'low', allowedForNightCycle: true, isRecommended: true },
    ]
  },
];

const initialProjects: Project[] = [
  {
    id: 'proj-1',
    name: 'Phone Stands - Batch A',
    productId: 'prod-1',
    productName: 'Phone Stand',
    quantityTarget: 100,
    quantityGood: 65,
    quantityScrap: 3,
    dueDate: '2025-01-02',
    urgency: 'normal',
    urgencyManualOverride: false,
    status: 'in_progress',
    color: 'Black',
    createdAt: '2024-12-20',
  },
  {
    id: 'proj-2',
    name: 'Cable Organizers - Client B',
    productId: 'prod-2',
    productName: 'Cable Organizer',
    quantityTarget: 250,
    quantityGood: 180,
    quantityScrap: 8,
    dueDate: '2024-12-30',
    urgency: 'urgent',
    urgencyManualOverride: false,
    status: 'in_progress',
    color: 'White',
    createdAt: '2024-12-18',
  },
  {
    id: 'proj-3',
    name: 'Pen Holders - Office Supply',
    productId: 'prod-3',
    productName: 'Pen Holder',
    quantityTarget: 50,
    quantityGood: 50,
    quantityScrap: 2,
    dueDate: '2024-12-25',
    urgency: 'normal',
    urgencyManualOverride: false,
    status: 'completed',
    color: 'Gray',
    createdAt: '2024-12-15',
  },
  {
    id: 'proj-4',
    name: 'Wall Hooks - Custom Order',
    productId: 'prod-4',
    productName: 'Wall Hook',
    quantityTarget: 200,
    quantityGood: 0,
    quantityScrap: 0,
    dueDate: '2025-01-15',
    urgency: 'critical',
    urgencyManualOverride: false,
    status: 'pending',
    color: 'Blue',
    createdAt: '2024-12-27',
  },
];

// Default priority rules
const DEFAULT_PRIORITY_RULES: PriorityRules = {
  urgentDaysThreshold: 14,
  criticalDaysThreshold: 7,
};

// ============= PRIORITY CALCULATION =============

export const calculateDaysRemaining = (dueDate: string): number => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  return Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
};

export const calculatePriorityFromDueDate = (
  dueDate: string,
  rules?: PriorityRules
): 'normal' | 'urgent' | 'critical' => {
  const effectiveRules = rules || getFactorySettings()?.priorityRules || DEFAULT_PRIORITY_RULES;
  const daysRemaining = calculateDaysRemaining(dueDate);
  
  if (daysRemaining < effectiveRules.criticalDaysThreshold) {
    return 'critical';
  } else if (daysRemaining < effectiveRules.urgentDaysThreshold) {
    return 'urgent';
  }
  return 'normal';
};

export const getPriorityRules = (): PriorityRules => {
  return getFactorySettings()?.priorityRules || DEFAULT_PRIORITY_RULES;
};

export const savePriorityRules = (rules: PriorityRules): void => {
  const settings = getFactorySettings();
  if (settings) {
    saveFactorySettings({ ...settings, priorityRules: rules });
  }
};

const getInitialPrinters = (): Printer[] => {
  const settings = getFactorySettings();
  return Array.from({ length: settings?.printerCount || 3 }, (_, i) => ({
    id: `printer-${i + 1}`,
    name: `Printer ${i + 1}`,
    active: true,
    currentColor: i === 0 ? 'Black' : i === 1 ? 'White' : undefined,
    hasAMS: false,
  }));
};

const getInitialPlannedCycles = (): PlannedCycle[] => {
  return [
    {
      id: 'cycle-1',
      projectId: 'proj-1',
      printerId: 'printer-1',
      unitsPlanned: 8,
      gramsPlanned: 360,
      plateType: 'full',
      startTime: '08:30',
      endTime: '11:00',
      shift: 'day',
      status: 'in_progress',
    },
    {
      id: 'cycle-2',
      projectId: 'proj-2',
      printerId: 'printer-2',
      unitsPlanned: 20,
      gramsPlanned: 240,
      plateType: 'full',
      startTime: '09:00',
      endTime: '10:30',
      shift: 'day',
      status: 'in_progress',
    },
    {
      id: 'cycle-3',
      projectId: 'proj-1',
      printerId: 'printer-1',
      unitsPlanned: 8,
      gramsPlanned: 360,
      plateType: 'full',
      startTime: '11:15',
      endTime: '13:45',
      shift: 'day',
      status: 'planned',
    },
    {
      id: 'cycle-4',
      projectId: 'proj-1',
      printerId: 'printer-1',
      unitsPlanned: 4,
      gramsPlanned: 180,
      plateType: 'reduced',
      startTime: '17:00',
      endTime: '19:30',
      shift: 'end_of_day',
      status: 'planned',
    },
  ];
};

// ============= PRODUCTS =============

export const getProducts = (): Product[] => {
  const products = getItem<Product[]>(KEYS.PRODUCTS, []);
  if (products.length === 0) {
    setItem(KEYS.PRODUCTS, initialProducts);
    return initialProducts;
  }
  return products;
};

export const getProduct = (id: string): Product | undefined => {
  return getProducts().find(p => p.id === id);
};

export const createProduct = (product: Omit<Product, 'id'>): Product => {
  const newProduct = { ...product, id: generateId() };
  const products = getProducts();
  setItem(KEYS.PRODUCTS, [...products, newProduct]);
  return newProduct;
};

// ============= PROJECTS =============

export const getProjects = (): Project[] => {
  const projects = getItem<Project[]>(KEYS.PROJECTS, []);
  if (projects.length === 0) {
    setItem(KEYS.PROJECTS, initialProjects);
    return initialProjects;
  }
  return projects;
};

export const getProject = (id: string): Project | undefined => {
  return getProjects().find(p => p.id === id);
};

export const getActiveProjects = (): Project[] => {
  return getProjects().filter(p => p.status !== 'completed');
};

export const createProject = (project: Omit<Project, 'id' | 'createdAt' | 'quantityGood' | 'quantityScrap'>): Project => {
  const newProject: Project = {
    ...project,
    id: generateId(),
    createdAt: new Date().toISOString().split('T')[0],
    quantityGood: 0,
    quantityScrap: 0,
  };
  const projects = getProjects();
  setItem(KEYS.PROJECTS, [...projects, newProject]);
  return newProject;
};

export const updateProject = (id: string, updates: Partial<Project>): Project | undefined => {
  const projects = getProjects();
  const index = projects.findIndex(p => p.id === id);
  if (index === -1) return undefined;
  
  projects[index] = { ...projects[index], ...updates };
  setItem(KEYS.PROJECTS, projects);
  return projects[index];
};

export const deleteProject = (id: string): boolean => {
  const projects = getProjects();
  const filtered = projects.filter(p => p.id !== id);
  if (filtered.length === projects.length) return false;
  setItem(KEYS.PROJECTS, filtered);
  return true;
};

// ============= PRINTERS =============

export const getPrinters = (): Printer[] => {
  const printers = getItem<Printer[]>(KEYS.PRINTERS, []);
  if (printers.length === 0) {
    const initial = getInitialPrinters();
    setItem(KEYS.PRINTERS, initial);
    return initial;
  }
  return printers;
};

export const getPrinter = (id: string): Printer | undefined => {
  return getPrinters().find(p => p.id === id);
};

export const updatePrinter = (id: string, updates: Partial<Printer>): Printer | undefined => {
  const printers = getPrinters();
  const index = printers.findIndex(p => p.id === id);
  if (index === -1) return undefined;
  
  printers[index] = { ...printers[index], ...updates };
  setItem(KEYS.PRINTERS, printers);
  return printers[index];
};

// ============= PLANNED CYCLES =============

export const getPlannedCycles = (): PlannedCycle[] => {
  const cycles = getItem<PlannedCycle[]>(KEYS.PLANNED_CYCLES, []);
  if (cycles.length === 0) {
    const initial = getInitialPlannedCycles();
    setItem(KEYS.PLANNED_CYCLES, initial);
    return initial;
  }
  return cycles;
};

export const getActiveCycleForPrinter = (printerId: string): PlannedCycle | undefined => {
  return getPlannedCycles().find(c => c.printerId === printerId && c.status === 'in_progress');
};

export const getCyclesForProject = (projectId: string): PlannedCycle[] => {
  return getPlannedCycles().filter(c => c.projectId === projectId);
};

export const updatePlannedCycle = (id: string, updates: Partial<PlannedCycle>): PlannedCycle | undefined => {
  const cycles = getPlannedCycles();
  const index = cycles.findIndex(c => c.id === id);
  if (index === -1) return undefined;
  
  cycles[index] = { ...cycles[index], ...updates };
  setItem(KEYS.PLANNED_CYCLES, cycles);
  return cycles[index];
};

// ============= CYCLE LOGS =============

export const getCycleLogs = (): CycleLog[] => {
  return getItem<CycleLog[]>(KEYS.CYCLE_LOGS, []);
};

export const logCycle = (log: Omit<CycleLog, 'id' | 'timestamp'>): CycleLog => {
  const newLog: CycleLog = {
    ...log,
    id: generateId(),
    timestamp: new Date().toISOString(),
  };
  const logs = getCycleLogs();
  setItem(KEYS.CYCLE_LOGS, [...logs, newLog]);
  
  // Update project quantities
  const project = getProject(log.projectId);
  if (project) {
    updateProject(log.projectId, {
      quantityGood: project.quantityGood + log.unitsCompleted,
      quantityScrap: project.quantityScrap + log.unitsScrap,
      status: project.quantityGood + log.unitsCompleted >= project.quantityTarget ? 'completed' : 'in_progress',
    });
  }
  
  // Update planned cycle status if linked
  if (log.plannedCycleId) {
    updatePlannedCycle(log.plannedCycleId, {
      status: log.result === 'failed' ? 'failed' : 'completed',
    });
  }
  
  return newLog;
};

// ============= ISSUE REPORTS =============

export const getIssueReports = (): IssueReport[] => {
  return getItem<IssueReport[]>(KEYS.ISSUE_REPORTS, []);
};

export const getUnresolvedIssues = (): IssueReport[] => {
  return getIssueReports().filter(i => !i.resolved);
};

export const createIssueReport = (report: Omit<IssueReport, 'id' | 'timestamp' | 'resolved'>): IssueReport => {
  const newReport: IssueReport = {
    ...report,
    id: generateId(),
    timestamp: new Date().toISOString(),
    resolved: false,
  };
  const reports = getIssueReports();
  setItem(KEYS.ISSUE_REPORTS, [...reports, newReport]);
  return newReport;
};

export const resolveIssue = (id: string, recoveryOption: string): IssueReport | undefined => {
  const reports = getIssueReports();
  const index = reports.findIndex(r => r.id === id);
  if (index === -1) return undefined;
  
  reports[index] = { ...reports[index], resolved: true, recoveryOption };
  setItem(KEYS.ISSUE_REPORTS, reports);
  return reports[index];
};

// ============= FACTORY SETTINGS =============

export const getFactorySettings = (): FactorySettings | null => {
  return getItem<FactorySettings | null>(KEYS.FACTORY_SETTINGS, null);
};

export const saveFactorySettings = (settings: FactorySettings): void => {
  setItem(KEYS.FACTORY_SETTINGS, settings);
  
  // Also update printers based on count
  const existingPrinters = getItem<Printer[]>(KEYS.PRINTERS, []);
  const newPrinters: Printer[] = Array.from({ length: settings.printerCount }, (_, i) => {
    const existing = existingPrinters[i];
    return existing || {
      id: `printer-${i + 1}`,
      name: `Printer ${i + 1}`,
      active: true,
      hasAMS: settings.hasAMS || false,
    };
  });
  setItem(KEYS.PRINTERS, newPrinters);
};

// ============= ONBOARDING =============

export const isOnboardingComplete = (): boolean => {
  return getItem<boolean>(KEYS.ONBOARDING_COMPLETE, false);
};

export const completeOnboarding = (): void => {
  setItem(KEYS.ONBOARDING_COMPLETE, true);
};

export const resetOnboarding = (): void => {
  setItem(KEYS.ONBOARDING_COMPLETE, false);
};

// ============= SPOOLS / INVENTORY =============

export const getSpools = (): Spool[] => {
  return getItem<Spool[]>(KEYS.SPOOLS, []);
};

export const createSpool = (spool: Omit<Spool, 'id'>): Spool => {
  const newSpool = { ...spool, id: generateId() };
  const spools = getSpools();
  setItem(KEYS.SPOOLS, [...spools, newSpool]);
  return newSpool;
};

export const updateSpool = (id: string, updates: Partial<Spool>): Spool | undefined => {
  const spools = getSpools();
  const index = spools.findIndex(s => s.id === id);
  if (index === -1) return undefined;
  
  spools[index] = { ...spools[index], ...updates };
  setItem(KEYS.SPOOLS, spools);
  return spools[index];
};

// ============= QUOTE CHECK SIMULATION =============

export interface QuoteCheckResult {
  canAccept: boolean;
  canAcceptWithAdjustment: boolean;
  requiredDays: number;
  availableCapacityUnits: number;
  message: string;
  suggestions?: string[];
}

export const simulateQuote = (
  productId: string,
  quantity: number,
  dueDate: string,
  urgency: 'normal' | 'urgent' | 'critical'
): QuoteCheckResult => {
  const product = getProduct(productId);
  if (!product) {
    return {
      canAccept: false,
      canAcceptWithAdjustment: false,
      requiredDays: 0,
      availableCapacityUnits: 0,
      message: 'Product not found',
    };
  }

  const settings = getFactorySettings();
  const printers = getPrinters().filter(p => p.active);
  const activeProjects = getActiveProjects();
  
  // Calculate daily capacity using recommended preset
  const recommendedPreset = product.platePresets.find(p => p.isRecommended) || product.platePresets[0];
  if (!recommendedPreset) {
    return {
      canAccept: false,
      canAcceptWithAdjustment: false,
      requiredDays: 0,
      availableCapacityUnits: 0,
      message: 'Product has no presets',
    };
  }
  
  const workHoursPerDay = settings ? 
    (parseFloat(settings.endTime?.replace(':', '.') || '17') - parseFloat(settings.startTime?.replace(':', '.') || '9')) * (100/60) : 8;
  const cyclesPerPrinterPerDay = Math.floor(workHoursPerDay / recommendedPreset.cycleHours);
  const unitsPerPrinterPerDay = cyclesPerPrinterPerDay * recommendedPreset.unitsPerPlate;
  const totalDailyCapacity = unitsPerPrinterPerDay * printers.length;
  
  // Calculate days until due
  const today = new Date();
  const due = new Date(dueDate);
  const daysUntilDue = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  
  // Calculate required days
  const requiredDays = Math.ceil(quantity / totalDailyCapacity);
  
  // Calculate current load from active projects
  const currentLoad = activeProjects.reduce((sum, p) => sum + (p.quantityTarget - p.quantityGood), 0);
  const availableCapacityUnits = Math.max(0, (totalDailyCapacity * daysUntilDue) - currentLoad);
  
  // Determine result
  if (quantity <= availableCapacityUnits && requiredDays <= daysUntilDue) {
    return {
      canAccept: true,
      canAcceptWithAdjustment: false,
      requiredDays,
      availableCapacityUnits,
      message: urgency === 'critical' ? 
        'Can accept - will be prioritized' : 
        'Can accept within timeframe',
    };
  } else if (quantity <= availableCapacityUnits * 1.3) {
    return {
      canAccept: false,
      canAcceptWithAdjustment: true,
      requiredDays,
      availableCapacityUnits,
      message: 'Can accept with adjustment',
      suggestions: [
        'Consider extending deadline by a few days',
        'Add overtime for critical orders',
        'Reduce units per cycle for faster turnaround',
      ],
    };
  } else {
    return {
      canAccept: false,
      canAcceptWithAdjustment: false,
      requiredDays,
      availableCapacityUnits,
      message: 'Cannot accept without outsourcing',
      suggestions: [
        'Consider outsourcing part of the order',
        'Negotiate a later deadline',
        'Split into multiple deliveries',
      ],
    };
  }
};

// ============= RESET ALL DATA =============

export const resetAllData = (): void => {
  Object.values(KEYS).forEach(key => localStorage.removeItem(key));
};
