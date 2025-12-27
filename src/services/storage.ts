// Data service layer for PrintFlow
// This layer abstracts localStorage so we can swap to a real DB later

import { scheduleAutoReplan } from './autoReplan';

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

export interface AMSModes {
  backupSameColor: boolean; // Backup / auto refill (same color continues when spool ends)
  multiColor: boolean; // Multi-color printing
}

// Estimate of how much filament is left on a mounted spool
export type FilamentEstimate = 'unknown' | 'low' | 'medium' | 'high';

// AMS slot state for loaded spools tracking
export interface AMSSlotState {
  slotIndex: number;
  spoolId?: string | null; // null if user just picked color without spool
  color?: string; // direct color selection if no spoolId
  estimate: FilamentEstimate;
}

export interface Printer {
  id: string;
  printerNumber: number;
  name: string;
  active: boolean;
  status: 'active' | 'out_of_service' | 'archived';
  disableReason?: 'breakdown' | 'maintenance' | 'retired';
  disabledAt?: string;
  expectedReturnDate?: string;
  currentColor?: string;
  currentMaterial?: string;
  hasAMS: boolean;
  amsSlots?: number; // 4, 8, or custom
  amsModes?: AMSModes; // AMS usage modes
  // Legacy field for backward compatibility
  amsMode?: 'backup_same_color' | 'multi_color';
  maxSpoolWeight?: number; // max spool size printer supports (1000, 2000, 5000g)
  // Loaded spools state (for non-AMS printers)
  mountedSpoolId?: string | null;
  mountedColor?: string; // color if user didn't pick specific spool
  mountedEstimate?: FilamentEstimate;
  // AMS slots state (for AMS printers)
  amsSlotStates?: AMSSlotState[];
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

// Cycle readiness state - indicates what's needed before execution
export type CycleReadinessState = 'ready' | 'waiting_for_spool' | 'blocked_inventory';

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
  // New fields for execution readiness
  readinessState: CycleReadinessState;
  readinessDetails?: string; // Human-readable explanation
  requiredColor?: string;
  requiredMaterial?: string;
  requiredGrams?: number;
}

// Load recommendation for operators
export interface LoadRecommendation {
  id: string;
  printerId: string;
  printerName: string;
  action: 'load_spool' | 'order_material';
  priority: 'high' | 'medium' | 'low';
  color: string;
  material?: string;
  gramsNeeded: number;
  suggestedSpoolIds: string[]; // Spools from inventory that could be used
  affectedCycleIds: string[];
  affectedProjectNames: string[];
  message: string;
  messageEn: string;
}

// Material shortage alert
export interface MaterialShortage {
  color: string;
  material?: string;
  requiredGrams: number;
  availableGrams: number;
  shortfallGrams: number;
  affectedProjectIds: string[];
  affectedProjectNames: string[];
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

export const KEYS = {
  PRODUCTS: 'printflow_products',
  PROJECTS: 'printflow_projects',
  PRINTERS: 'printflow_printers',
  SPOOLS: 'printflow_spools',
  PLANNED_CYCLES: 'printflow_planned_cycles',
  CYCLE_LOGS: 'printflow_cycle_logs',
  ISSUE_REPORTS: 'printflow_issue_reports',
  FACTORY_SETTINGS: 'printflow_factory_settings',
  ONBOARDING_COMPLETE: 'printflow_onboarding_complete',
  BOOTSTRAPPED: 'printflow_bootstrapped',
  DEMO_MODE: 'printflow_demo_mode',
  LOADED_SPOOLS_INITIALIZED: 'printflow_loaded_spools_initialized',
  MOUNTED_STATE_UNKNOWN: 'printflow_mounted_state_unknown',
};

// ============= HELPERS =============

const generateId = (): string => {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

const getItem = <T>(key: string, defaultValue: T): T => {
  try {
    const item = localStorage.getItem(key);
    if (key === KEYS.PLANNED_CYCLES) {
      console.log(`[storage] getItem(${key}) from origin: ${window.location.origin}, found: ${item ? JSON.parse(item).length : 0} items`);
    }
    return item ? JSON.parse(item) : defaultValue;
  } catch {
    return defaultValue;
  }
};

const setItem = <T>(key: string, value: T): void => {
  if (key === KEYS.PLANNED_CYCLES) {
    console.log(`[storage] setItem(${key}) on origin: ${window.location.origin}, writing: ${Array.isArray(value) ? value.length : 'N/A'} items`);
  }
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
    printerNumber: i + 1,
    name: `Printer ${i + 1}`,
    active: true,
    status: 'active' as const,
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
      readinessState: 'ready',
      requiredColor: 'Black',
      requiredGrams: 360,
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
      readinessState: 'ready',
      requiredColor: 'White',
      requiredGrams: 240,
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
      readinessState: 'waiting_for_spool',
      readinessDetails: 'Load Black spool on Printer 1',
      requiredColor: 'Black',
      requiredGrams: 360,
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
      readinessState: 'waiting_for_spool',
      readinessDetails: 'Load Black spool on Printer 1',
      requiredColor: 'Black',
      requiredGrams: 180,
    },
  ];
};

// ============= PRODUCTS =============

export const getProducts = (): Product[] => {
  const products = getItem<Product[]>(KEYS.PRODUCTS, []);
  // Don't auto-populate with demo data - respect bootstrap choice
  if (products.length === 0) {
    return [];
  }
  // Migrate old products without platePresets
  const migratedProducts = products.map(p => {
    if (!p.platePresets || !Array.isArray(p.platePresets)) {
      // Convert legacy product to new format
      const legacyProduct = p as any;
      return {
        ...p,
        platePresets: [{
          id: `preset-${p.id}-1`,
          name: 'Full',
          unitsPerPlate: legacyProduct.safeUnitsFullPlate || 8,
          cycleHours: legacyProduct.cycleHours || 2,
          riskLevel: 'low' as const,
          allowedForNightCycle: legacyProduct.nightAllowed !== 'no',
          isRecommended: true,
        }],
      };
    }
    return p;
  });
  // Save migrated data if any changes were made
  if (migratedProducts.some((p, i) => p !== products[i])) {
    setItem(KEYS.PRODUCTS, migratedProducts);
  }
  return migratedProducts;
};

export const getProduct = (id: string): Product | undefined => {
  return getProducts().find(p => p.id === id);
};

export const createProduct = (product: Omit<Product, 'id'>): Product => {
  const newProduct = { ...product, id: generateId() };
  const products = getProducts();
  setItem(KEYS.PRODUCTS, [...products, newProduct]);
  scheduleAutoReplan('product_created');
  return newProduct;
};

export const updateProduct = (id: string, updates: Partial<Product>): Product | undefined => {
  const products = getProducts();
  const index = products.findIndex(p => p.id === id);
  if (index === -1) return undefined;
  
  products[index] = { ...products[index], ...updates };
  setItem(KEYS.PRODUCTS, products);
  
  // Schedule auto-replan for planning-relevant changes
  const planningRelevantKeys = ['gramsPerUnit', 'platePresets'];
  const hasRelevantChange = Object.keys(updates).some(key => planningRelevantKeys.includes(key));
  if (hasRelevantChange) {
    scheduleAutoReplan('product_updated');
  }
  
  return products[index];
};

export const deleteProduct = (id: string): boolean => {
  const products = getProducts();
  const filtered = products.filter(p => p.id !== id);
  if (filtered.length === products.length) return false;
  setItem(KEYS.PRODUCTS, filtered);
  scheduleAutoReplan('product_deleted');
  return true;
};

export const deleteProducts = (ids: string[]): number => {
  const products = getProducts();
  const idsSet = new Set(ids);
  const filtered = products.filter(p => !idsSet.has(p.id));
  const deletedCount = products.length - filtered.length;
  if (deletedCount > 0) {
    setItem(KEYS.PRODUCTS, filtered);
    scheduleAutoReplan('products_deleted');
  }
  return deletedCount;
};

export const deleteProjects = (ids: string[]): number => {
  const projects = getProjects();
  const idsSet = new Set(ids);
  const filtered = projects.filter(p => !idsSet.has(p.id));
  const deletedCount = projects.length - filtered.length;
  if (deletedCount > 0) {
    setItem(KEYS.PROJECTS, filtered);
    scheduleAutoReplan('projects_deleted');
  }
  return deletedCount;
};

// ============= PROJECTS =============

export const getProjects = (): Project[] => {
  const projects = getItem<Project[]>(KEYS.PROJECTS, []);
  // Don't auto-populate with demo data - respect bootstrap choice
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
  scheduleAutoReplan('project_created');
  return newProject;
};

export const updateProject = (id: string, updates: Partial<Project>, skipAutoReplan: boolean = false): Project | undefined => {
  const projects = getProjects();
  const index = projects.findIndex(p => p.id === id);
  if (index === -1) return undefined;
  
  projects[index] = { ...projects[index], ...updates };
  setItem(KEYS.PROJECTS, projects);
  
  // Schedule auto-replan for planning-relevant changes
  if (!skipAutoReplan) {
    const planningRelevantKeys = ['quantityTarget', 'dueDate', 'status', 'urgency', 'preferredPresetId', 'productId'];
    const hasRelevantChange = Object.keys(updates).some(key => planningRelevantKeys.includes(key));
    if (hasRelevantChange) {
      scheduleAutoReplan('project_updated');
    }
  }
  
  return projects[index];
};

export const deleteProject = (id: string): boolean => {
  const projects = getProjects();
  const filtered = projects.filter(p => p.id !== id);
  if (filtered.length === projects.length) return false;
  setItem(KEYS.PROJECTS, filtered);
  scheduleAutoReplan('project_deleted');
  return true;
};

// ============= PRINTERS =============

export const getPrinters = (): Printer[] => {
  const printers = getItem<Printer[]>(KEYS.PRINTERS, []);
  // Don't auto-populate - printers created during onboarding
  if (printers.length === 0) {
    return [];
  }
  // Migrate old printers without new fields
  const migratedPrinters = printers.map((p, idx) => ({
    ...p,
    printerNumber: p.printerNumber ?? idx + 1,
    status: p.status ?? (p.active ? 'active' : 'out_of_service') as Printer['status'],
  }));
  if (migratedPrinters.some((p, i) => p !== printers[i])) {
    setItem(KEYS.PRINTERS, migratedPrinters);
  }
  return migratedPrinters;
};

export const getActivePrinters = (): Printer[] => {
  return getPrinters().filter(p => p.status === 'active');
};

export const getPrinter = (id: string): Printer | undefined => {
  return getPrinters().find(p => p.id === id);
};

export const createPrinter = (printer: Omit<Printer, 'id'>): Printer => {
  const newPrinter: Printer = { ...printer, id: generateId() };
  const printers = getPrinters();
  setItem(KEYS.PRINTERS, [...printers, newPrinter]);
  scheduleAutoReplan('printer_added');
  return newPrinter;
};

export const updatePrinter = (id: string, updates: Partial<Printer>): Printer | undefined => {
  const printers = getPrinters();
  const index = printers.findIndex(p => p.id === id);
  if (index === -1) return undefined;
  
  printers[index] = { ...printers[index], ...updates };
  setItem(KEYS.PRINTERS, printers);
  
  // Schedule auto-replan for planning-relevant changes
  const planningRelevantKeys = ['active', 'status', 'hasAMS', 'amsSlots', 'amsMode'];
  const hasRelevantChange = Object.keys(updates).some(key => planningRelevantKeys.includes(key));
  if (hasRelevantChange) {
    scheduleAutoReplan('printer_updated');
  }
  
  return printers[index];
};

export const getNextPrinterNumber = (): number => {
  const printers = getPrinters();
  const maxNumber = printers.reduce((max, p) => Math.max(max, p.printerNumber || 0), 0);
  return maxNumber + 1;
};

// ============= PLANNED CYCLES =============

export const getPlannedCycles = (): PlannedCycle[] => {
  const cycles = getItem<PlannedCycle[]>(KEYS.PLANNED_CYCLES, []);
  // Don't auto-populate - respect bootstrap choice
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

// ============= MATERIAL CONSUMPTION (FIFO) =============

export interface MaterialConsumptionResult {
  success: boolean;
  gramsConsumed: number;
  spoolsAffected: string[];
  error?: string;
  errorHe?: string;
}

/**
 * Consume material from spools using FIFO logic.
 * Consumes from oldest open spool first, then moves to next.
 * @param color - The color to consume
 * @param gramsNeeded - Total grams to consume
 * @param printerId - Optional: prefer spools assigned to this printer
 * @returns Result with success status and affected spools
 */
export const consumeMaterial = (
  color: string,
  gramsNeeded: number,
  printerId?: string
): MaterialConsumptionResult => {
  if (gramsNeeded <= 0) {
    return { success: true, gramsConsumed: 0, spoolsAffected: [] };
  }

  const spools = getSpools();
  const colorLower = color.toLowerCase();
  
  // Find matching spools (same color, not empty)
  // Sort by: assigned to printer first, then open before new, then by remaining grams (FIFO approximation)
  const matchingSpools = spools
    .filter(s => 
      s.color.toLowerCase() === colorLower && 
      s.state !== 'empty' &&
      s.gramsRemainingEst > 0
    )
    .sort((a, b) => {
      // Priority 1: Assigned to the same printer
      if (printerId) {
        const aAssigned = a.assignedPrinterId === printerId ? 0 : 1;
        const bAssigned = b.assignedPrinterId === printerId ? 0 : 1;
        if (aAssigned !== bAssigned) return aAssigned - bAssigned;
      }
      // Priority 2: Open spools before new (use open ones first)
      const stateOrder = { 'open': 0, 'new': 1, 'empty': 2 };
      if (stateOrder[a.state] !== stateOrder[b.state]) {
        return stateOrder[a.state] - stateOrder[b.state];
      }
      // Priority 3: Less remaining grams first (finish smaller spools)
      return a.gramsRemainingEst - b.gramsRemainingEst;
    });

  // Calculate total available
  const totalAvailable = matchingSpools.reduce((sum, s) => sum + s.gramsRemainingEst, 0);
  
  if (totalAvailable < gramsNeeded) {
    return {
      success: false,
      gramsConsumed: 0,
      spoolsAffected: [],
      error: `Insufficient ${color} filament: need ${gramsNeeded}g, have ${totalAvailable}g`,
      errorHe: `אין מספיק פילמנט ${color}: נדרשים ${gramsNeeded}g, זמינים ${totalAvailable}g`,
    };
  }

  // Consume using FIFO
  let remaining = gramsNeeded;
  const affectedSpoolIds: string[] = [];
  const updatedSpools = [...spools];

  for (const spool of matchingSpools) {
    if (remaining <= 0) break;

    const spoolIndex = updatedSpools.findIndex(s => s.id === spool.id);
    if (spoolIndex === -1) continue;

    const consumeFromThis = Math.min(spool.gramsRemainingEst, remaining);
    const newRemaining = spool.gramsRemainingEst - consumeFromThis;

    updatedSpools[spoolIndex] = {
      ...updatedSpools[spoolIndex],
      gramsRemainingEst: Math.max(0, newRemaining),
      state: newRemaining <= 0 ? 'empty' : 'open',
      needsAudit: newRemaining < 100, // Flag for audit if low
    };

    remaining -= consumeFromThis;
    affectedSpoolIds.push(spool.id);
  }

  // Persist updated spools
  setItem(KEYS.SPOOLS, updatedSpools);
  
  // Schedule auto-replan after material consumption
  scheduleAutoReplan('material_consumed');

  return {
    success: true,
    gramsConsumed: gramsNeeded - remaining,
    spoolsAffected: affectedSpoolIds,
  };
};

/**
 * Check if there's enough material without consuming it.
 */
export const checkMaterialAvailability = (
  color: string,
  gramsNeeded: number
): { available: boolean; totalGrams: number; shortfall: number } => {
  const spools = getSpools();
  const colorLower = color.toLowerCase();
  
  const totalGrams = spools
    .filter(s => 
      s.color.toLowerCase() === colorLower && 
      s.state !== 'empty' &&
      s.gramsRemainingEst > 0
    )
    .reduce((sum, s) => sum + s.gramsRemainingEst, 0);

  return {
    available: totalGrams >= gramsNeeded,
    totalGrams,
    shortfall: Math.max(0, gramsNeeded - totalGrams),
  };
};

// ============= LOG CYCLE WITH MATERIAL CONSUMPTION =============

export interface LogCycleResult {
  success: boolean;
  log?: CycleLog;
  materialResult?: MaterialConsumptionResult;
  error?: string;
  errorHe?: string;
}

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

/**
 * Log a cycle with automatic material consumption.
 * This is the preferred method for production use.
 */
export const logCycleWithMaterialConsumption = (
  log: Omit<CycleLog, 'id' | 'timestamp'>,
  color: string,
  gramsPerUnit: number,
  printerId?: string
): LogCycleResult => {
  // Calculate total material consumed
  // For completed/completed_with_scrap: good units + scrap units
  // For failed: use the gramsWasted field (manually entered)
  let gramsToConsume: number;
  
  if (log.result === 'failed') {
    // For failed cycles, use the manually entered gramsWasted
    gramsToConsume = log.gramsWasted;
  } else {
    // For completed cycles, calculate from units
    const totalUnits = log.unitsCompleted + log.unitsScrap;
    gramsToConsume = totalUnits * gramsPerUnit;
  }

  // Check availability first
  const availability = checkMaterialAvailability(color, gramsToConsume);
  if (!availability.available) {
    return {
      success: false,
      error: `Insufficient ${color} filament: need ${gramsToConsume}g, have ${availability.totalGrams}g`,
      errorHe: `אין מספיק פילמנט ${color}: נדרשים ${gramsToConsume}g, זמינים ${availability.totalGrams}g`,
    };
  }

  // Consume material
  const materialResult = consumeMaterial(color, gramsToConsume, printerId);
  if (!materialResult.success) {
    return {
      success: false,
      materialResult,
      error: materialResult.error,
      errorHe: materialResult.errorHe,
    };
  }

  // Log the cycle
  const cycleLog = logCycle(log);

  return {
    success: true,
    log: cycleLog,
    materialResult,
  };
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

export const saveFactorySettings = (
  settings: FactorySettings, 
  printerNames?: string[],
  printerAMSConfigs?: Array<{ hasAMS: boolean; amsSlots: number; amsModes: { backupSameColor: boolean; multiColor: boolean } }>
): void => {
  setItem(KEYS.FACTORY_SETTINGS, settings);
  
  // Also update printers based on count
  const existingPrinters = getItem<Printer[]>(KEYS.PRINTERS, []);
  const newPrinters: Printer[] = Array.from({ length: settings.printerCount }, (_, i) => {
    const existing = existingPrinters[i];
    const amsConfig = printerAMSConfigs?.[i];
    const printerName = printerNames?.[i] || `Printer ${i + 1}`;
    
    if (existing) {
      // Update existing printer with new AMS config if provided
      return {
        ...existing,
        name: printerName,
        hasAMS: amsConfig?.hasAMS ?? existing.hasAMS ?? false,
        amsSlots: amsConfig?.hasAMS ? (amsConfig.amsSlots ?? existing.amsSlots) : undefined,
        amsModes: amsConfig?.hasAMS ? amsConfig.amsModes : undefined,
      };
    }
    
    // Create new printer with per-printer AMS config
    return {
      id: `printer-${i + 1}`,
      printerNumber: i + 1,
      name: printerName,
      active: true,
      status: 'active' as const,
      hasAMS: amsConfig?.hasAMS ?? false,
      amsSlots: amsConfig?.hasAMS ? amsConfig.amsSlots : undefined,
      amsModes: amsConfig?.hasAMS ? amsConfig.amsModes : undefined,
    };
  });
  setItem(KEYS.PRINTERS, newPrinters);
  
  // Schedule auto-replan after factory settings change
  scheduleAutoReplan('factory_settings_changed');
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

// ============= LOADED SPOOLS INITIALIZATION =============

export const isLoadedSpoolsInitialized = (): boolean => {
  return getItem<boolean>(KEYS.LOADED_SPOOLS_INITIALIZED, false);
};

export const setLoadedSpoolsInitialized = (value: boolean): void => {
  setItem(KEYS.LOADED_SPOOLS_INITIALIZED, value);
};

export const isMountedStateUnknown = (): boolean => {
  return getItem<boolean>(KEYS.MOUNTED_STATE_UNKNOWN, false);
};

export const setMountedStateUnknown = (value: boolean): void => {
  setItem(KEYS.MOUNTED_STATE_UNKNOWN, value);
};

/**
 * Check if any printer needs loaded spools setup
 * Returns true if there are planned cycles in next 7 days and at least one printer has no mounted state
 */
export const needsLoadedSpoolsSetup = (): boolean => {
  // Already initialized, no need to show modal
  if (isLoadedSpoolsInitialized()) return false;
  
  const printers = getPrinters().filter(p => p.status === 'active');
  if (printers.length === 0) return false;
  
  // Check if there are planned cycles in the next 7 days
  const cycles = getPlannedCycles();
  const now = new Date();
  const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  
  const hasUpcomingCycles = cycles.some(c => {
    const cycleDate = new Date(c.startTime);
    return cycleDate >= now && cycleDate <= weekFromNow && c.status !== 'completed';
  });
  
  if (!hasUpcomingCycles) return false;
  
  // Check if any printer has no mounted state defined
  return printers.some(p => {
    if (p.hasAMS) {
      // For AMS printers, check if amsSlotStates is undefined or empty
      return !p.amsSlotStates || p.amsSlotStates.length === 0;
    } else {
      // For non-AMS printers, check if mountedSpoolId/mountedColor is undefined
      return p.mountedSpoolId === undefined && p.mountedColor === undefined;
    }
  });
};

/**
 * Mount a spool on a printer (helper function for future integration)
 */
export const mountSpool = (
  printerId: string, 
  spoolId: string | null, 
  color: string,
  estimate: FilamentEstimate
): Printer | undefined => {
  const printer = getPrinter(printerId);
  if (!printer) return undefined;
  
  if (printer.hasAMS) {
    // For AMS, this would update a specific slot - not implemented here
    console.warn('Use updateAMSSlot for AMS printers');
    return printer;
  }
  
  // Update spool location if we have a spoolId
  if (spoolId) {
    const spools = getSpools();
    // First, unmount any spool currently on this printer
    spools.forEach(s => {
      if (s.assignedPrinterId === printerId && s.location === 'printer') {
        updateSpool(s.id, { location: 'stock', assignedPrinterId: undefined }, true);
      }
    });
    // Mount the new spool
    updateSpool(spoolId, { location: 'printer', assignedPrinterId: printerId }, true);
  }
  
  return updatePrinter(printerId, {
    mountedSpoolId: spoolId,
    mountedColor: color,
    mountedEstimate: estimate,
    currentColor: color,
  });
};

/**
 * Update AMS slot state
 */
export const updateAMSSlot = (
  printerId: string,
  slotIndex: number,
  spoolId: string | null,
  color: string,
  estimate: FilamentEstimate
): Printer | undefined => {
  const printer = getPrinter(printerId);
  if (!printer || !printer.hasAMS) return undefined;
  
  const currentSlots = printer.amsSlotStates || [];
  const slotExists = currentSlots.findIndex(s => s.slotIndex === slotIndex);
  
  let newSlots: AMSSlotState[];
  if (slotExists >= 0) {
    newSlots = [...currentSlots];
    newSlots[slotExists] = { slotIndex, spoolId, color, estimate };
  } else {
    newSlots = [...currentSlots, { slotIndex, spoolId, color, estimate }];
  }
  
  // Update spool location if we have a spoolId
  if (spoolId) {
    updateSpool(spoolId, { 
      location: 'ams', 
      assignedPrinterId: printerId,
      amsSlotIndex: slotIndex 
    }, true);
  }
  
  return updatePrinter(printerId, { amsSlotStates: newSlots });
};

/**
 * Clear all mounted spool states for a printer
 */
export const clearPrinterMountedState = (printerId: string): Printer | undefined => {
  const printer = getPrinter(printerId);
  if (!printer) return undefined;
  
  if (printer.hasAMS) {
    return updatePrinter(printerId, { amsSlotStates: [] });
  } else {
    return updatePrinter(printerId, { 
      mountedSpoolId: null, 
      mountedColor: undefined, 
      mountedEstimate: undefined 
    });
  }
};

/**
 * Placeholder for consuming material after cycle (future integration)
 */
export const consumeMaterialAfterCycle = (
  printerId: string,
  color: string,
  gramsUsed: number
): void => {
  // This will be implemented when we integrate with actual print data
  console.log(`[Future] Consume ${gramsUsed}g of ${color} from printer ${printerId}`);
};

// ============= BOOTSTRAP & RESET =============

/**
 * Check if the app has been bootstrapped (first run completed)
 */
export const isBootstrapped = (): boolean => {
  return getItem<boolean>(KEYS.BOOTSTRAPPED, false);
};

/**
 * Check if currently in demo mode
 */
export const isDemoMode = (): boolean => {
  return getItem<boolean>(KEYS.DEMO_MODE, false);
};

/**
 * Complete bootstrap with fresh start (no demo data)
 */
export const bootstrapFresh = (): void => {
  setItem(KEYS.BOOTSTRAPPED, true);
  setItem(KEYS.DEMO_MODE, false);
  // Initialize with empty arrays
  setItem(KEYS.PRODUCTS, []);
  setItem(KEYS.PROJECTS, []);
  setItem(KEYS.PRINTERS, []);
  setItem(KEYS.SPOOLS, []);
  setItem(KEYS.PLANNED_CYCLES, []);
  setItem(KEYS.CYCLE_LOGS, []);
  setItem(KEYS.ISSUE_REPORTS, []);
};

/**
 * Complete bootstrap with demo data loaded
 */
export const bootstrapWithDemo = (): void => {
  setItem(KEYS.BOOTSTRAPPED, true);
  setItem(KEYS.DEMO_MODE, true);
  // Load demo data
  setItem(KEYS.PRODUCTS, initialProducts);
  setItem(KEYS.PROJECTS, initialProjects);
  setItem(KEYS.PLANNED_CYCLES, getInitialPlannedCycles());
  // Printers will be created during onboarding based on count
  setItem(KEYS.PRINTERS, []);
  setItem(KEYS.SPOOLS, []);
  setItem(KEYS.CYCLE_LOGS, []);
  setItem(KEYS.ISSUE_REPORTS, []);
};

/**
 * Reset all PrintFlow data and return to first-run state
 */
export const resetAllPrintFlowData = (): void => {
  // Remove all keys that start with 'printflow_'
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('printflow_')) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach(key => localStorage.removeItem(key));
};

// ============= SPOOLS / INVENTORY =============

export const getSpools = (): Spool[] => {
  return getItem<Spool[]>(KEYS.SPOOLS, []);
};

export const createSpool = (spool: Omit<Spool, 'id'>): Spool => {
  const newSpool = { ...spool, id: generateId() };
  const spools = getSpools();
  setItem(KEYS.SPOOLS, [...spools, newSpool]);
  scheduleAutoReplan('spool_added');
  return newSpool;
};

export const updateSpool = (id: string, updates: Partial<Spool>, skipAutoReplan: boolean = false): Spool | undefined => {
  const spools = getSpools();
  const index = spools.findIndex(s => s.id === id);
  if (index === -1) return undefined;
  
  spools[index] = { ...spools[index], ...updates };
  setItem(KEYS.SPOOLS, spools);
  
  // Schedule auto-replan for inventory-affecting changes
  if (!skipAutoReplan) {
    const inventoryRelevantKeys = ['gramsRemainingEst', 'state', 'color'];
    const hasRelevantChange = Object.keys(updates).some(key => inventoryRelevantKeys.includes(key));
    if (hasRelevantChange) {
      scheduleAutoReplan('spool_updated');
    }
  }
  
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

// ============= PLANNING ENGINE =============

export interface PlanningMeta {
  lastRecalculatedAt: string | null;
  capacityChangedSinceLastRecalculation: boolean;
  lastCapacityChangeReason?: string;
}

export type RecalculateScope = 'from_now' | 'from_tomorrow' | 'whole_week';

const PLANNING_META_KEY = 'printflow_planning_meta';

export const getPlanningMeta = (): PlanningMeta => {
  return getItem<PlanningMeta>(PLANNING_META_KEY, {
    lastRecalculatedAt: null,
    capacityChangedSinceLastRecalculation: false,
  });
};

export const savePlanningMeta = (meta: PlanningMeta): void => {
  setItem(PLANNING_META_KEY, meta);
};

export const markCapacityChanged = (reason: string): void => {
  const meta = getPlanningMeta();
  savePlanningMeta({
    ...meta,
    capacityChangedSinceLastRecalculation: true,
    lastCapacityChangeReason: reason,
  });
};

// Re-export planning recalculation functions from separate module to avoid circular deps
export { recalculatePlan, triggerPlanningRecalculation } from './planningRecalculator';

// ============= RESET ALL DATA =============

export const resetAllData = (): void => {
  Object.values(KEYS).forEach(key => localStorage.removeItem(key));
};
