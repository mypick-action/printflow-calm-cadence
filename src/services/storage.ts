// Data service layer for PrintFlow
// This layer abstracts localStorage so we can swap to a real DB later

import { scheduleAutoReplan } from './autoReplan';
import { normalizeColor } from './colorNormalization';
import { pauseHydrationFor, setSyncInProgress } from './cloudBridge';

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
  quantityOverage?: number; // Units produced beyond target (from external suppliers or overproduction)
  dueDate: string; // ISO date string
  urgency: 'normal' | 'urgent' | 'critical';
  urgencyManualOverride: boolean; // true if user manually set urgency
  status: 'pending' | 'in_progress' | 'completed' | 'on_hold';
  color: string;
  createdAt: string;
  parentProjectId?: string; // Link to original project for remake/completion projects
  // Recovery project fields
  customCycleHours?: number; // Override cycle hours (from Recovery Input estimatedPrintHours)
  isRecoveryProject?: boolean; // True if this is a recovery/remake project
  // Planning inclusion
  includeInPlanning?: boolean; // If false, project is excluded from planning engine (default: true)
  // Cloud sync field - stores the cloud UUID when id is legacy_id
  cloudUuid?: string;
  // Local creation timestamp for hydration protection (prevents cloud overwriting new local projects)
  localCreatedAt?: number;
}

/**
 * Find a project by ID - handles both legacy_id and cloudUuid lookups
 * Use this instead of projects.find(p => p.id === projectId) to handle ID mismatches
 * 
 * @param projects - Array of projects to search
 * @param projectId - Primary project ID to search for
 * @param projectUuid - Optional: Cloud UUID from cycle (fallback if projectId not found)
 */
export function findProjectById(
  projects: Project[], 
  projectId: string, 
  projectUuid?: string
): Project | undefined {
  if (!projectId && !projectUuid) return undefined;
  
  // Try direct ID match first
  if (projectId) {
    const found = projects.find(p => p.id === projectId);
    if (found) return found;
    
    // Try cloudUuid match (projectId might be the cloud UUID)
    const foundByCloudUuid = projects.find(p => p.cloudUuid === projectId);
    if (foundByCloudUuid) return foundByCloudUuid;
  }
  
  // Fallback: try projectUuid from cycle if provided
  if (projectUuid) {
    const found = projects.find(p => p.id === projectUuid || p.cloudUuid === projectUuid);
    if (found) return found;
  }
  
  return undefined;
}

export interface AMSModes {
  backupSameColor: boolean; // Backup / auto refill (same color continues when spool ends)
  multiColor: boolean; // Multi-color printing
}

// DEPRECATED: FilamentEstimate removed in v2 - inventory grams is single source of truth
// Kept for backward compatibility during migration, will be removed from data
export type FilamentEstimate = 'unknown' | 'low' | 'medium' | 'high';

// AMS slot state for loaded spools tracking
// NOTE: In v2, spoolId is REQUIRED for execution. color alone = needs_spool state.
export interface AMSSlotState {
  slotIndex: number;
  spoolId?: string | null; // Required for "ready" state - must reference inventory spool
  color?: string; // Derived from spool, or legacy color-only (needs migration)
  // estimate field REMOVED in v2 - use spool.gramsRemainingEst instead
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
  // Night operation capability
  // If true + FULL_AUTOMATION: printer can START new cycles after hours (belt printer, auto plate swap)
  // If false: printer can only CONTINUE running cycles after hours, not start new ones
  canStartNewCyclesAfterHours?: boolean;
  // Physical plate capacity for autonomous/overnight cycles
  // Default 999 = unlimited, typical values: 3-8
  physicalPlateCapacity?: number;
  // Loaded spools state (for non-AMS printers)
  // NOTE: In v2, mountedSpoolId is REQUIRED for "ready" state
  mountedSpoolId?: string | null; // Required for ready - must reference inventory spool
  mountedColor?: string; // Derived from mounted spool, or legacy value (needs migration)
  // mountedEstimate field REMOVED in v2 - use spool.gramsRemainingEst instead
  // AMS slots state (for AMS printers)
  amsSlotStates?: AMSSlotState[];
  // Material tracking fields (v3)
  mountState?: 'idle' | 'reserved' | 'in_use'; // Printer job state
  loadedGramsEstimate?: number; // Display only - NOT source of truth for calculations
  bambu_serial?: string; // For Bambu printer event matching
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
export type CycleReadinessState = 'ready' | 'waiting_for_spool' | 'blocked_inventory' | 'waiting_for_plate_reload';

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
  status: 'planned' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  // Cancellation fields (when status = 'cancelled')
  cancelledAt?: string;
  cancelReason?: string;
  // New fields for execution readiness
  readinessState: CycleReadinessState;
  readinessDetails?: string; // Human-readable explanation
  requiredColor?: string;
  requiredMaterial?: string;
  requiredGrams?: number;
  // Manual job assignment fields
  source?: 'auto' | 'manual'; // 'auto' = generated by planning engine, 'manual' = user created
  locked?: boolean; // If true, this cycle cannot be moved/deleted by replanning
  actualStartTime?: string; // When the print actually started
  actualEndTime?: string; // When the print actually ended
  spoolStartGrams?: number; // Grams on spool when cycle started (for material tracking)
  // Preset selection fields
  presetId?: string; // Selected preset ID
  presetName?: string; // Preset name for display
  presetSelectionReason?: string; // Why this preset was chosen (for auto-selection)
  // Physical plate constraint fields
  plateIndex?: number; // Which plate (1..4) this cycle uses
  plateReleaseTime?: string; // When this plate will be available again (ISO string)
  // Cloud sync fields - stores cloud UUIDs for reference
  projectUuid?: string; // Cloud UUID of the project
  cycleUuid?: string; // Cloud UUID of the cycle itself
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
  // Enhanced spool selection info
  totalGramsForSequence?: number; // Total grams for all sequential same-color cycles
  sequentialCyclesCount?: number; // Number of sequential same-color cycles
  canUsePartialSpool?: boolean; // Whether a partial spool can cover the current job
  partialSpoolRecommendation?: 'use_partial' | 'use_full' | 'either';
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
  result: 'completed' | 'completed_with_scrap' | 'failed' | 'cancelled';
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

export type SchedulingStrategy = 'compress' | 'balance';

// Planning objective for printer selection
export type PlanningObjective = 'MIN_PRINTERS' | 'HYBRID' | 'MAX_UTILIZATION';

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
  // Scheduling strategy: compress = finish ASAP, balance = spread load
  schedulingStrategy?: SchedulingStrategy;
  // Planning horizon for material reservation (default 24 hours)
  planningHorizonHours?: number;
  // Lead time for material procurement in hours (default 48)
  materialLeadTimeHours?: number;
  // Planning objective settings (used with PLANNING_HYBRID_OBJECTIVE FF)
  planningObjective?: PlanningObjective;        // Default: MIN_PRINTERS
  maxPrintersDuringWorkHours?: number;          // Default: 5
  minImprovementThreshold?: number;             // Default: 0.05 (5%)
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

// Get temporary schedule overrides from localStorage
const OVERRIDES_STORAGE_KEY = 'printflow_week_overrides';

export const getTemporaryOverrides = (): TemporaryScheduleOverride[] => {
  try {
    const data = localStorage.getItem(OVERRIDES_STORAGE_KEY);
    if (!data) return [];
    
    // Parse and convert to TemporaryScheduleOverride format
    const overrides = JSON.parse(data);
    
    // Handle both old format (WeekOverride[]) and new format (TemporaryScheduleOverride[])
    if (Array.isArray(overrides) && overrides.length > 0) {
      // Check if it's the new format
      if (overrides[0].dayOverrides) {
        return overrides as TemporaryScheduleOverride[];
      }
      
      // Convert old WeekOverride format
      return overrides.map((o: any) => ({
        id: o.id || `override_${Date.now()}`,
        startDate: o.startDate || new Date().toISOString().split('T')[0],
        endDate: o.endDate || new Date().toISOString().split('T')[0],
        dayOverrides: o.days || {},
      }));
    }
    
    return [];
  } catch {
    return [];
  }
};

// Helper to calculate available filament for a printer (considering AMS)
export const getAvailableFilamentForPrinter = (
  printerId: string,
  color: string,
  printer: Printer
): { totalGrams: number; spools: Spool[]; recommendation?: string } => {
  const spools = getSpools();
  const colorKey = normalizeColor(color);
  const matchingSpools = spools.filter(s => 
    normalizeColor(s.color) === colorKey &&
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

// ============= COLOR INVENTORY (NEW MODEL) =============
// Tracks inventory per color+material, not individual spools

export interface ColorInventoryItem {
  id: string;              // `${material}:${color}` or uuid
  color: string;           // e.g. "White"
  material: string;        // e.g. "PLA"
  closedCount: number;     // number of sealed spools
  closedSpoolSizeGrams: number; // default 1000
  openTotalGrams: number;  // total grams across all open spools (shelf + printers)
  openSpoolCount?: number; // WORLD count: total open spools (shelf + printers)
  reorderPointGrams?: number; // optional, default 2000
  updatedAt?: string;
}

// Helper to compute total grams from a ColorInventoryItem
export const getTotalGrams = (item: ColorInventoryItem): number => {
  return item.closedCount * item.closedSpoolSizeGrams + item.openTotalGrams;
};

// ============= STORAGE KEYS =============

export const KEYS = {
  PRODUCTS: 'printflow_products',
  PROJECTS: 'printflow_projects',
  PRINTERS: 'printflow_printers',
  SPOOLS: 'printflow_spools',
  COLOR_INVENTORY: 'printflow_color_inventory',
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

// Keys to clear on hard reset - NOT including protected ones
const HARD_RESET_KEYS = [
  // Core data (will be re-hydrated from cloud)
  'printflow_projects',
  'printflow_planned_cycles',
  'printflow_cycle_logs',
  
  // Planning state
  'printflow_planning_meta',
  'printflow_planning_log',
  'printflow_last_plan_snapshot',
  'printflow_last_auto_replan',
  
  // Sync/hydration state
  'printflow_sync_queue',
  'printflow_cloud_last_hydrated_at',
  'printflow_cloud_last_hydrated_workspace',
  
  // Decision/event logs
  'decision_log',
  'end_cycle_event_log',
];

// PROTECTED keys - NOT included in hard reset:
// 'printflow_products' - Protected until migration complete
// 'printflow_printers' - Synced from cloud
// 'printflow_factory_settings' - Synced from cloud
// 'printflow_onboarding_complete' - User state
// 'printflow_bootstrapped' - User state

/**
 * Hard reset local cache - clears all sync/planning data
 * Preserves: products, printers, factory_settings, onboarding state
 */
export const hardResetLocalCache = (): void => {
  console.log('[Storage] === HARD RESET START ===');
  console.log('[Storage] Clearing', HARD_RESET_KEYS.length, 'localStorage keys...');
  
  HARD_RESET_KEYS.forEach(key => {
    const existed = localStorage.getItem(key) !== null;
    localStorage.removeItem(key);
    if (existed) {
      console.log('[Storage] Cleared:', key);
    }
  });
  
  console.log('[Storage] === HARD RESET COMPLETE ===');
  console.log('[Storage] Protected keys preserved: products, printers, factory_settings, onboarding');
};

// ============= HELPERS =============

// Generate legacy ID for backward compatibility (timestamp-based)
const generateLegacyId = (): string => {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

// Generate proper UUID for cloud storage
const generateUUID = (): string => {
  return crypto.randomUUID();
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
  const newProduct = { ...product, id: generateUUID() };
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
  const projects = getProjectsLocal();
  const idsSet = new Set(ids);
  const filtered = projects.filter(p => !idsSet.has(p.id));
  const deletedCount = projects.length - filtered.length;
  if (deletedCount > 0) {
    setItem(KEYS.PROJECTS, filtered);
    scheduleAutoReplan('projects_deleted');
    // Queue cloud deletes
    ids.forEach(id => {
      if (idsSet.has(id)) {
        addToSyncQueue('delete', 'project', id, null);
      }
    });
  }
  return deletedCount;
};

// ============= PROJECTS =============

// Sync-related imports and state
import * as cloudStorage from '@/services/cloudStorage';
import { addToSyncQueue, getQueueStatus } from '@/services/syncQueue';
import { toast } from 'sonner';

// Get workspaceId from auth context - this will be set by the app
let _workspaceIdGetter: (() => string | null) | null = null;

export const setWorkspaceIdGetter = (getter: () => string | null): void => {
  _workspaceIdGetter = getter;
};

const getWorkspaceId = (): string | null => {
  return _workspaceIdGetter ? _workspaceIdGetter() : null;
};

// SYNC local projects to localStorage (always available, no async)
export const getProjectsLocal = (): Project[] => {
  const projects = getItem<Project[]>(KEYS.PROJECTS, []);
  return projects;
};

// ASYNC: Read from cloud first, fallback to local
// This is the main function - all UI should call this
export const getProjects = async (): Promise<Project[]> => {
  const workspaceId = getWorkspaceId();
  
  if (!workspaceId) {
    console.log('[Projects] No workspaceId, using local');
    return getProjectsLocal();
  }
  
  try {
    const cloudProjects = await cloudStorage.getProjects(workspaceId);
    
    if (cloudProjects && cloudProjects.length > 0) {
      // Map cloud format to local format
      const localProjects: Project[] = cloudProjects.map(mapCloudProjectToLocal);
      // Update local cache
      setItem(KEYS.PROJECTS, localProjects);
      console.log('[Projects] Loaded from cloud:', localProjects.length);
      return localProjects;
    }
  } catch (e) {
    console.warn('[Projects] Cloud unavailable, using local:', e);
  }
  
  return getProjectsLocal();
};

// Legacy alias for backward compatibility during migration
export const getProjectsFromCloud = getProjects;

// Synchronous version - for internal services that need sync access (planning engine, etc.)
// These read from the local cache which is updated by getProjects() when UI loads
export const getProjectsSync = (): Project[] => {
  return getProjectsLocal();
};

// Map cloud project format to local format
const mapCloudProjectToLocal = (p: cloudStorage.DbProject): Project => {
  return {
    id: p.id,
    name: p.name,
    productId: p.product_id ?? '',
    productName: p.product_id ? '' : 'ללא מוצר', // If no product_id, show "No product" in Hebrew
    preferredPresetId: p.preset_id ?? undefined,
    quantityTarget: p.quantity_target ?? 1,
    quantityGood: p.quantity_completed ?? 0,
    quantityScrap: p.quantity_failed ?? 0,
    dueDate: p.deadline ?? '',
    urgency: (p.priority === 'urgent' || p.priority === 'critical') 
      ? p.priority as 'urgent' | 'critical' 
      : 'normal',
    urgencyManualOverride: false,
    status: (p.status ?? 'pending') as Project['status'],
    color: p.color || '',
    createdAt: p.created_at ?? new Date().toISOString(),
    parentProjectId: p.parent_project_id ?? undefined,
    customCycleHours: p.custom_cycle_hours ?? undefined,
    isRecoveryProject: p.is_recovery_project ?? false,
    includeInPlanning: p.include_in_planning !== false,
  };
};

// Map local project to cloud format
const mapLocalProjectToCloud = (p: Project): Omit<cloudStorage.DbProject, 'workspace_id' | 'created_at' | 'updated_at' | 'legacy_id'> => {
  return {
    id: p.id,
    name: p.name,
    product_id: p.productId || null,
    preset_id: p.preferredPresetId || null,
    quantity_target: p.quantityTarget,
    quantity_completed: p.quantityGood,
    quantity_failed: p.quantityScrap,
    status: p.status,
    priority: p.urgency,
    deadline: p.dueDate || null,
    assigned_printer_id: null,
    custom_cycle_hours: p.customCycleHours ?? null,
    is_recovery_project: p.isRecoveryProject ?? false,
    parent_project_id: p.parentProjectId || null,
    notes: null,
    color: p.color || null,
    include_in_planning: p.includeInPlanning !== false, // Default true
  };
};

export const getProject = (id: string): Project | undefined => {
  return getProjectsLocal().find(p => p.id === id);
};

export const getActiveProjects = (): Project[] => {
  return getProjectsLocal().filter(p => p.status !== 'completed');
};

// CREATE: Save locally first, then try cloud
// FIXED: Use proper UUID for cloud compatibility
export const createProject = (project: Omit<Project, 'id' | 'createdAt' | 'quantityGood' | 'quantityScrap'>): Project => {
  // Generate proper UUID (not timestamp-based) for cloud compatibility
  const projectId = generateUUID();
  const legacyId = generateLegacyId(); // Keep for backward compatibility
  
  const newProject: Project = {
    ...project,
    id: projectId,
    createdAt: new Date().toISOString().split('T')[0],
    quantityGood: 0,
    quantityScrap: 0,
    localCreatedAt: Date.now(), // Track creation time for hydration protection
  };
  
  // 1. Save locally first (always works)
  const projects = getProjectsLocal();
  setItem(KEYS.PROJECTS, [...projects, newProject]);
  
  // 2. Pause hydration for 15 seconds to allow cloud sync to complete
  pauseHydrationFor(15000, 'project_create');
  
  // 3. Try to save to cloud (async, non-blocking)
  const workspaceId = getWorkspaceId();
  if (workspaceId) {
    setSyncInProgress(true); // Prevent hydration during sync
    const cloudData = {
      ...mapLocalProjectToCloud(newProject),
      legacy_id: legacyId, // Store timestamp-based ID separately for migration
    };
    cloudStorage.createProjectWithId(workspaceId, cloudData)
      .then(result => {
        setSyncInProgress(false);
        if (result) {
          console.log('[Projects] Saved to cloud:', newProject.id);
        } else {
          // Cloud failed - show error toast
          toast.error('שגיאה בשמירת הפרויקט לענן');
          addToSyncQueue('create', 'project', newProject.id, cloudData);
        }
      })
      .catch((err) => {
        setSyncInProgress(false);
        console.error('[Projects] Cloud save error:', err);
        toast.error('שגיאה בשמירת הפרויקט לענן');
        addToSyncQueue('create', 'project', newProject.id, cloudData);
      });
  }
  
  // 4. Schedule auto-replan after sync setup
  scheduleAutoReplan('project_created');
  
  return newProject;
};

// UPDATE: Update locally first, then try cloud
export const updateProject = (id: string, updates: Partial<Project>, skipAutoReplan: boolean = false): Project | undefined => {
  const projects = getProjectsLocal();
  const index = projects.findIndex(p => p.id === id);
  if (index === -1) return undefined;
  
  projects[index] = { ...projects[index], ...updates };
  setItem(KEYS.PROJECTS, projects);
  
  // Schedule auto-replan for planning-relevant changes
  if (!skipAutoReplan) {
    const planningRelevantKeys = ['quantityTarget', 'quantityGood', 'dueDate', 'status', 'urgency', 'preferredPresetId', 'productId', 'includeInPlanning'];
    const hasRelevantChange = Object.keys(updates).some(key => planningRelevantKeys.includes(key));
    if (hasRelevantChange) {
      scheduleAutoReplan('project_updated');
    }
  }
  
  // Try to update in cloud (async, non-blocking)
  const workspaceId = getWorkspaceId();
  if (workspaceId) {
    const cloudUpdates = mapLocalProjectToCloud(projects[index]);
    cloudStorage.updateProject(id, cloudUpdates)
      .then(result => {
        if (result) {
          console.log('[Projects] Updated in cloud:', id);
        } else {
          addToSyncQueue('update', 'project', id, cloudUpdates);
        }
      })
      .catch(() => {
        addToSyncQueue('update', 'project', id, cloudUpdates);
      });
  }
  
  return projects[index];
};

// DELETE: Delete locally first, then try cloud
export const deleteProject = (id: string): boolean => {
  const projects = getProjectsLocal();
  const filtered = projects.filter(p => p.id !== id);
  if (filtered.length === projects.length) return false;
  setItem(KEYS.PROJECTS, filtered);
  scheduleAutoReplan('project_deleted');
  
  // Try to delete from cloud (async, non-blocking)
  const workspaceId = getWorkspaceId();
  if (workspaceId) {
    cloudStorage.deleteProject(id)
      .then(result => {
        if (result) {
          console.log('[Projects] Deleted from cloud:', id);
        } else {
          addToSyncQueue('delete', 'project', id, null);
        }
      })
      .catch(() => {
        addToSyncQueue('delete', 'project', id, null);
      });
  }
  
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
  const newPrinter: Printer = { ...printer, id: generateUUID() };
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
  
  // Notify UI components that printers have changed
  window.dispatchEvent(new CustomEvent('printflow:printers-changed'));
  
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

/**
 * Ensure only one in_progress cycle per printer
 * If setting a cycle to in_progress, complete any other in_progress cycles for that printer
 */
const ensureSingleInProgressPerPrinter = (cycles: PlannedCycle[], printerId: string, newInProgressId: string): PlannedCycle[] => {
  return cycles.map(c => {
    if (c.printerId === printerId && c.status === 'in_progress' && c.id !== newInProgressId) {
      console.warn(`[Storage] Auto-completing conflicting in_progress cycle ${c.id} for printer ${printerId}`);
      return { ...c, status: 'completed' as const, endTime: new Date().toISOString() };
    }
    return c;
  });
};

export const updatePlannedCycle = (id: string, updates: Partial<PlannedCycle>): PlannedCycle | undefined => {
  let cycles = getPlannedCycles();
  const index = cycles.findIndex(c => c.id === id);
  if (index === -1) return undefined;
  
  const updatedCycle = { ...cycles[index], ...updates };
  cycles[index] = updatedCycle;
  
  // VALIDATION: If setting to in_progress, ensure no other in_progress cycles for this printer
  if (updates.status === 'in_progress') {
    cycles = ensureSingleInProgressPerPrinter(cycles, updatedCycle.printerId, id);
  }
  
  setItem(KEYS.PLANNED_CYCLES, cycles);
  return cycles[index];
};

// Add a new manual cycle (user-created)
export const addManualCycle = (cycle: PlannedCycle): PlannedCycle => {
  let cycles = getPlannedCycles();
  
  // VALIDATION: If new cycle is in_progress, ensure no other in_progress cycles for this printer
  if (cycle.status === 'in_progress') {
    cycles = ensureSingleInProgressPerPrinter(cycles, cycle.printerId, cycle.id);
  }
  
  cycles.push(cycle);
  setItem(KEYS.PLANNED_CYCLES, cycles);
  return cycle;
};

// Delete a planned cycle by ID
export const deletePlannedCycle = (id: string): boolean => {
  const cycles = getPlannedCycles();
  const filteredCycles = cycles.filter(c => c.id !== id);
  if (filteredCycles.length === cycles.length) {
    return false; // No cycle was deleted
  }
  setItem(KEYS.PLANNED_CYCLES, filteredCycles);
  return true;
};

// Mark in_progress cycles for a printer as failed (cleanup utility)
export const markPrinterCyclesAsFailed = (printerId: string): number => {
  const cycles = getPlannedCycles();
  let count = 0;
  const updatedCycles = cycles.map(c => {
    if (c.printerId === printerId && c.status === 'in_progress') {
      count++;
      return { ...c, status: 'failed' as const };
    }
    return c;
  });
  if (count > 0) {
    setItem(KEYS.PLANNED_CYCLES, updatedCycles);
  }
  return count;
};

/**
 * Clean up stale "in_progress" cycles whose end_time has passed.
 * These cycles are auto-completed to prevent "printer busy" false positives.
 * Returns the IDs of cycles that were cleaned up.
 */
export const cleanupStaleCycles = (): string[] => {
  const now = new Date();
  const cycles = getPlannedCycles();
  const cleanedIds: string[] = [];
  
  const updatedCycles = cycles.map(c => {
    if (c.status === 'in_progress' && c.endTime) {
      const endTime = new Date(c.endTime);
      if (now > endTime) {
        console.log(`[storage] Auto-completing stale cycle ${c.id} (ended at ${c.endTime})`);
        cleanedIds.push(c.id);
        return {
          ...c,
          status: 'completed' as const,
        };
      }
    }
    return c;
  });
  
  if (cleanedIds.length > 0) {
    setItem(KEYS.PLANNED_CYCLES, updatedCycles);
  }
  
  return cleanedIds;
};

// Clean up orphaned cycles (cycles with projectId that doesn't exist)
export const cleanupOrphanedCycles = (): { removed: number; orphanedProjectIds: string[] } => {
  const cycles = getPlannedCycles();
  const projects = getProjectsLocal();
  
  // CRITICAL FIX: Use findProjectById to handle ID mismatches (legacy_id vs cloudUuid)
  // This prevents falsely identifying cycles as orphaned after hydration
  const orphanedProjectIds: string[] = [];
  const validCycles = cycles.filter(c => {
    // Use findProjectById to check both projectId and projectUuid
    const project = findProjectById(projects, c.projectId, c.projectUuid);
    if (project) {
      return true;
    }
    if (!orphanedProjectIds.includes(c.projectId)) {
      orphanedProjectIds.push(c.projectId);
    }
    return false;
  });
  
  const removed = cycles.length - validCycles.length;
  if (removed > 0) {
    console.log(`[storage] Cleaned up ${removed} orphaned cycles with invalid project IDs:`, orphanedProjectIds);
    setItem(KEYS.PLANNED_CYCLES, validCycles);
  }
  
  return { removed, orphanedProjectIds };
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
  printerId?: string,
  forceConsume: boolean = false // For execution mode - consume even if insufficient (already used)
): MaterialConsumptionResult => {
  if (gramsNeeded <= 0) {
    return { success: true, gramsConsumed: 0, spoolsAffected: [] };
  }

  const spools = getSpools();
  const colorKey = normalizeColor(color);
  
  // Find matching spools (same color, not empty)
  // Sort by: assigned to printer first, then open before new, then by remaining grams (FIFO approximation)
  const matchingSpools = spools
    .filter(s => 
      normalizeColor(s.color) === colorKey && 
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
  
  // EXECUTION vs PLANNING separation:
  // - forceConsume=true: Execution mode - material was already physically consumed,
  //   we just deduct what we can from inventory (may go to 0 or leave remaining)
  // - forceConsume=false: Planning mode - check availability before consuming
  if (!forceConsume && totalAvailable < gramsNeeded) {
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
  
  // Immediately notify UI components to refresh material alerts
  notifyInventoryChanged();

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
  const colorKey = normalizeColor(color);
  
  const totalGrams = spools
    .filter(s => 
      normalizeColor(s.color) === colorKey && 
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
  remakeProject?: Project; // Auto-created project for scrap units
  error?: string;
  errorHe?: string;
}

export interface LogCycleWithRemakeResult {
  log: CycleLog;
  remakeProject?: Project;
}

export const logCycle = (log: Omit<CycleLog, 'id' | 'timestamp'>): LogCycleWithRemakeResult => {
  const newLog: CycleLog = {
    ...log,
    id: generateUUID(),
    timestamp: new Date().toISOString(),
  };
  const logs = getCycleLogs();
  setItem(KEYS.CYCLE_LOGS, [...logs, newLog]);
  
  // Update project quantities
  const project = getProject(log.projectId);
  let remakeProject: Project | undefined;
  
  if (project) {
    const newGood = project.quantityGood + log.unitsCompleted;
    const newScrap = project.quantityScrap + log.unitsScrap;
    const isCompleted = newGood >= project.quantityTarget;
    
    updateProject(log.projectId, {
      quantityGood: newGood,
      quantityScrap: newScrap,
      status: isCompleted ? 'completed' : 'in_progress',
    });
    
    // If there are scrap units, ALWAYS create a remake project
    // This ensures the missing units get scheduled immediately
    // The user will adjust the plate settings as needed
    if (log.unitsScrap > 0) {
      const product = getProduct(project.productId);
      if (product) {
        remakeProject = createProject({
          name: `${project.name} - השלמה`,
          productId: project.productId,
          productName: project.productName,
          preferredPresetId: undefined, // User needs to select new plate setup
          quantityTarget: log.unitsScrap,
          dueDate: project.dueDate, // Same due date as original
          urgency: 'urgent', // Mark as urgent by default
          urgencyManualOverride: false,
          status: 'pending',
          color: project.color,
          isRecoveryProject: true, // Mark as recovery project
          // Note: customCycleHours not set here - will use preset default
          // Manual EndCycleLog flow sets customCycleHours from user input
        });
      }
    }
  }
  
  // Update planned cycle status if linked
  if (log.plannedCycleId) {
    updatePlannedCycle(log.plannedCycleId, {
      status: (log.result === 'failed' || log.result === 'cancelled') ? 'failed' : 'completed',
    });
  }
  
  return { log: newLog, remakeProject };
};

/**
 * Log a cycle with automatic material consumption.
 * This is the preferred method for production use.
 */
export const logCycleWithMaterialConsumption = (
  log: Omit<CycleLog, 'id' | 'timestamp'>,
  color: string,
  gramsPerUnit: number,
  printerId?: string,
  skipAvailabilityCheck: boolean = false // For execution mode - material already consumed
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

  // EXECUTION mode - material was already physically consumed during printing.
  // This applies to ALL end-cycle results (completed, completed_with_scrap, failed)
  // because we're recording what ALREADY happened, not planning future consumption.
  // Availability check is only needed for PLANNING scenarios (not end-cycle logging).
  const isExecutionMode = log.result === 'completed' || 
                          log.result === 'completed_with_scrap' ||
                          log.result === 'failed' ||
                          log.result === 'cancelled';
  
  // Skip availability check for execution mode - the material was already used
  // Only check availability for planning validation scenarios
  if (!skipAvailabilityCheck && !isExecutionMode) {
    const availability = checkMaterialAvailability(color, gramsToConsume);
    if (!availability.available) {
      return {
        success: false,
        error: `Insufficient ${color} filament: need ${gramsToConsume}g, have ${availability.totalGrams}g`,
        errorHe: `אין מספיק פילמנט ${color}: נדרשים ${gramsToConsume}g, זמינים ${availability.totalGrams}g`,
      };
    }
  }

  // Consume material (deduct from inventory records)
  // For execution: force consume even if insufficient (material was already physically used)
  const materialResult = consumeMaterial(color, gramsToConsume, printerId, isExecutionMode);
  if (!materialResult.success) {
    return {
      success: false,
      materialResult,
      error: materialResult.error,
      errorHe: materialResult.errorHe,
    };
  }

  // Also consume from new ColorInventory model (if exists)
  // This keeps both models in sync during transition
  // Uses 'PLA' as default material - in future could be passed as param
  const colorInvResult = consumeFromColorInventory(color, 'PLA', gramsToConsume);
  if (colorInvResult.remaining === 0 && colorInvResult.consumed > 0) {
    console.log(`[ColorInventory] ${color} open spool depleted`);
  }

  // Log the cycle
  const cycleResult = logCycle(log);

  return {
    success: true,
    log: cycleResult.log,
    materialResult,
    remakeProject: cycleResult.remakeProject,
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
    id: generateUUID(),
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
 * Update cycle readiness states after a spool is mounted.
 * This directly marks cycles as 'ready' if they match the mounted color/printer,
 * then promotes any pending projects that now have ready cycles.
 * 
 * This avoids requiring a full replan just for readiness state updates.
 */
export const updateCycleReadinessAfterMount = (printerId: string, mountedColor: string): void => {
  const cycles = getPlannedCycles();
  const colorKey = mountedColor.toLowerCase();
  let updatedCount = 0;
  
  const updatedCycles = cycles.map(cycle => {
    // Only update cycles for this printer that are waiting for a spool
    if (cycle.printerId !== printerId) return cycle;
    if (cycle.readinessState !== 'waiting_for_spool') return cycle;
    if (cycle.status !== 'planned') return cycle;
    
    // Check if the mounted color matches what this cycle needs
    const requiredColor = cycle.requiredColor?.toLowerCase();
    if (requiredColor && requiredColor === colorKey) {
      updatedCount++;
      return {
        ...cycle,
        readinessState: 'ready' as const,
        readinessDetails: undefined,
      };
    }
    
    return cycle;
  });
  
  if (updatedCount > 0) {
    setItem(KEYS.PLANNED_CYCLES, updatedCycles);
    console.log(`[CycleReadiness] Updated ${updatedCount} cycles to ready for printer ${printerId}`);
    
    // Now promote any pending projects that have ready cycles
    promoteProjectsWithReadyCycles();
  }
};

/**
 * Mount a spool on a printer from inventory
 * In v2, spoolId is REQUIRED - we don't support color-only mounting anymore
 * @param printerId - The printer to mount on
 * @param spoolId - REQUIRED: The spool ID from inventory
 */
export const mountSpool = (
  printerId: string, 
  spoolId: string
): Printer | undefined => {
  const printer = getPrinter(printerId);
  if (!printer) return undefined;
  
  if (printer.hasAMS) {
    console.warn('Use updateAMSSlot for AMS printers');
    return printer;
  }
  
  // Get the spool to derive color
  const spool = getSpools().find(s => s.id === spoolId);
  if (!spool) {
    console.error(`Spool ${spoolId} not found in inventory`);
    return undefined;
  }
  
  // First, unmount any spool currently on this printer
  const allSpools = getSpools();
  allSpools.forEach(s => {
    if (s.assignedPrinterId === printerId && s.location === 'printer') {
      updateSpool(s.id, { location: 'stock', assignedPrinterId: undefined }, true);
    }
  });
  
  // Mount the new spool
  updateSpool(spoolId, { location: 'printer', assignedPrinterId: printerId }, true);
  
  // Update printer - color derived from spool
  const updatedPrinter = updatePrinter(printerId, {
    mountedSpoolId: spoolId,
    mountedColor: spool.color, // Derived from spool
    currentColor: spool.color,
  });
  
  // Update cycle readiness states and promote projects
  updateCycleReadinessAfterMount(printerId, spool.color);
  
  // Notify UI components to refresh material alerts after mount
  notifyInventoryChanged();
  
  return updatedPrinter;
};

/**
 * Update AMS slot state
 * In v2, spoolId is REQUIRED - we don't support color-only mounting anymore
 * @param printerId - The printer to update
 * @param slotIndex - The AMS slot index
 * @param spoolId - REQUIRED: The spool ID from inventory
 */
export const updateAMSSlot = (
  printerId: string,
  slotIndex: number,
  spoolId: string
): Printer | undefined => {
  const printer = getPrinter(printerId);
  if (!printer || !printer.hasAMS) return undefined;
  
  // Get the spool to derive color
  const spool = getSpools().find(s => s.id === spoolId);
  if (!spool) {
    console.error(`Spool ${spoolId} not found in inventory`);
    return undefined;
  }
  
  const currentSlots = printer.amsSlotStates || [];
  const slotExists = currentSlots.findIndex(s => s.slotIndex === slotIndex);
  
  const newSlotData: AMSSlotState = { 
    slotIndex, 
    spoolId, 
    color: spool.color 
  };
  
  let newSlots: AMSSlotState[];
  if (slotExists >= 0) {
    newSlots = [...currentSlots];
    newSlots[slotExists] = newSlotData;
  } else {
    newSlots = [...currentSlots, newSlotData];
  }
  
  // Update spool location
  updateSpool(spoolId, { 
    location: 'ams', 
    assignedPrinterId: printerId,
    amsSlotIndex: slotIndex 
  }, true);
  
  const updatedPrinter = updatePrinter(printerId, { amsSlotStates: newSlots });
  
  // Update cycle readiness states and promote projects
  updateCycleReadinessAfterMount(printerId, spool.color);
  
  // Notify UI components to refresh material alerts after AMS slot update
  notifyInventoryChanged();
  
  return updatedPrinter;
};

/**
 * Clear all mounted spool states for a printer
 */
export const clearPrinterMountedState = (printerId: string): Printer | undefined => {
  const printer = getPrinter(printerId);
  if (!printer) return undefined;
  
  let result: Printer | undefined;
  if (printer.hasAMS) {
    result = updatePrinter(printerId, { amsSlotStates: [] });
  } else {
    result = updatePrinter(printerId, { 
      mountedSpoolId: null, 
      mountedColor: undefined,
    });
  }
  
  // Notify UI components to refresh material alerts after clearing mounted state
  notifyInventoryChanged();
  
  return result;
};

// ============= MATERIAL LIFECYCLE FUNCTIONS (v3) =============
// These functions implement the material tracking invariants:
// - openTotalGrams = all grams in open spools (shelf + printers)
// - openSpoolCount = all open spools in world (shelf + printers)
// - Cycles are source of truth for reserved grams (NOT loadedGramsEstimate)

/**
 * Get printers holding a specific color (physical spool mounted)
 */
export const getPrintersHoldingColor = (color: string): { total: number; printerIds: string[] } => {
  const colorKey = normalizeColor(color);
  const printers = getPrinters().filter(p => 
    p.status === 'active' && 
    normalizeColor(p.mountedColor || '') === colorKey
  );
  return {
    total: printers.length,
    printerIds: printers.map(p => p.id),
  };
};

/**
 * Get number of open spools free on shelf (not on printers)
 */
export const getShelfOpenSpoolsFree = (color: string, material: string = 'PLA'): number => {
  const item = getColorInventoryItem(color, material);
  if (!item) return 0;
  
  const worldOpenSpools = item.openSpoolCount || 0;
  const { total: printersHolding } = getPrintersHoldingColor(color);
  
  return Math.max(0, worldOpenSpools - printersHolding);
};

/**
 * Load a spool onto a printer from shelf or closed inventory
 * 
 * Invariants:
 * - load(open): does NOT change counts (spool moves location, stays in world)
 * - load(closed): closedCount--, openSpoolCount++, openTotalGrams += gramsEstimate
 * 
 * @returns true if successful
 */
export const loadSpoolOnPrinter = (
  printerId: string,
  color: string,
  gramsEstimate: number,
  source: 'open' | 'closed'
): boolean => {
  const printer = getPrinter(printerId);
  if (!printer) return false;
  
  const items = getColorInventory();
  const colorKey = normalizeColor(color);
  const index = items.findIndex(i => 
    normalizeColor(i.color) === colorKey && 
    i.material.toLowerCase() === 'pla'
  );
  
  if (index < 0) return false;
  const item = items[index];
  
  if (source === 'open') {
    // Taking existing open spool from SHELF
    // Check if there's a free spool on shelf
    const shelfFree = getShelfOpenSpoolsFree(color, 'PLA');
    if (shelfFree <= 0) {
      console.warn(`[loadSpoolOnPrinter] No open spools on shelf for ${color}`);
      return false;
    }
    // openSpoolCount stays the same (WORLD count unchanged)
    // openTotalGrams stays the same (grams already counted)
  } else if (source === 'closed') {
    // Opening a closed spool - creating NEW open spool in world
    if (item.closedCount <= 0) {
      console.warn(`[loadSpoolOnPrinter] No closed spools for ${color}`);
      return false;
    }
    // Update inventory: closed -> open
    items[index] = {
      ...items[index],
      closedCount: items[index].closedCount - 1,
      openSpoolCount: (items[index].openSpoolCount || 0) + 1,
      openTotalGrams: items[index].openTotalGrams + gramsEstimate,
      updatedAt: new Date().toISOString(),
    };
    setItem(KEYS.COLOR_INVENTORY, items);
    notifyInventoryChanged();
  }
  
  // Update printer state
  updatePrinter(printerId, {
    mountedColor: color,
    loadedGramsEstimate: gramsEstimate,
    mountState: 'idle', // Starts as idle until reserved/started
    currentColor: color,
  });
  
  console.log(`[loadSpoolOnPrinter] Loaded ${color} on printer ${printerId} from ${source}, estimate: ${gramsEstimate}g`);
  return true;
};

/**
 * Unload a spool from printer back to shelf
 * 
 * Invariant: does NOT change counts (spool moves location, stays in world)
 */
export const unloadSpoolFromPrinter = (printerId: string): boolean => {
  const printer = getPrinter(printerId);
  if (!printer || !printer.mountedColor) return false;
  
  const color = printer.mountedColor;
  
  // Just clear printer mount state - counts stay the same
  updatePrinter(printerId, {
    mountedColor: undefined,
    loadedGramsEstimate: undefined,
    mountState: undefined,
    currentColor: undefined,
  });
  
  console.log(`[unloadSpoolFromPrinter] Unloaded ${color} from printer ${printerId}`);
  return true;
};

/**
 * Mark printer as reserved for upcoming job (material allocated)
 */
export const reservePrinterMaterial = (printerId: string): void => {
  updatePrinter(printerId, { mountState: 'reserved' });
  console.log(`[reservePrinterMaterial] Printer ${printerId} reserved`);
};

/**
 * Mark printer as in_use (job started)
 */
export const startPrinterJob = (printerId: string): void => {
  updatePrinter(printerId, { mountState: 'in_use' });
  console.log(`[startPrinterJob] Printer ${printerId} started`);
};

/**
 * Finish printer job and deduct consumed material
 * 
 * Invariant: openTotalGrams -= gramsConsumed (actual consumption)
 * The spool stays on the printer (idle state)
 */
export const finishPrinterJob = (printerId: string, gramsConsumed: number): void => {
  const printer = getPrinter(printerId);
  if (!printer || !printer.mountedColor) {
    console.warn(`[finishPrinterJob] Printer ${printerId} has no mounted color`);
    return;
  }
  
  const color = printer.mountedColor;
  
  // Deduct actual consumption from global openTotalGrams
  const items = getColorInventory();
  const colorKey = normalizeColor(color);
  const index = items.findIndex(i => 
    normalizeColor(i.color) === colorKey && 
    i.material.toLowerCase() === 'pla'
  );
  
  if (index >= 0) {
    const newOpenTotalGrams = Math.max(0, items[index].openTotalGrams - gramsConsumed);
    let newOpenSpoolCount = items[index].openSpoolCount || 0;
    
    // If openTotalGrams drops below 50g, consider a spool empty and decrement count
    if (newOpenTotalGrams < 50 && newOpenSpoolCount > 0) {
      newOpenSpoolCount = Math.max(0, newOpenSpoolCount - 1);
      console.log(`[finishPrinterJob] Spool emptied for ${color}, openSpoolCount now: ${newOpenSpoolCount}`);
    }
    
    items[index] = {
      ...items[index],
      openTotalGrams: newOpenTotalGrams < 50 ? 0 : newOpenTotalGrams, // Zero out if below threshold
      openSpoolCount: newOpenSpoolCount,
      updatedAt: new Date().toISOString(),
    };
    setItem(KEYS.COLOR_INVENTORY, items);
    notifyInventoryChanged();
  }
  
  // Update printer estimate and set to idle (spool stays mounted)
  const remaining = Math.max(0, (printer.loadedGramsEstimate || 0) - gramsConsumed);
  updatePrinter(printerId, {
    mountState: 'idle',
    loadedGramsEstimate: remaining,
  });
  
  console.log(`[finishPrinterJob] Printer ${printerId} finished, consumed ${gramsConsumed}g of ${color}, remaining estimate: ${remaining}g`);
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
  setItem(KEYS.COLOR_INVENTORY, []);
  setItem(KEYS.CYCLE_LOGS, []);
  setItem(KEYS.ISSUE_REPORTS, []);
  // Seed color inventory with demo data
  seedColorInventoryDemo();
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

// Import inventory events for immediate UI updates
import { notifyInventoryChanged } from './inventoryEvents';

export const createSpool = (spool: Omit<Spool, 'id'>): Spool => {
  const newSpool = { ...spool, id: generateUUID() };
  const spools = getSpools();
  setItem(KEYS.SPOOLS, [...spools, newSpool]);
  scheduleAutoReplan('spool_added');
  // Immediately notify UI components to refresh material status
  notifyInventoryChanged();
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
  
  // Immediately notify UI components to refresh material status
  notifyInventoryChanged();
  
  return spools[index];
};

export const deleteSpool = (id: string): boolean => {
  const spools = getSpools();
  const filtered = spools.filter(s => s.id !== id);
  if (filtered.length === spools.length) return false;
  setItem(KEYS.SPOOLS, filtered);
  scheduleAutoReplan('spool_deleted');
  notifyInventoryChanged();
  return true;
};

export const deleteSpools = (ids: string[]): number => {
  const spools = getSpools();
  const idsSet = new Set(ids);
  const filtered = spools.filter(s => !idsSet.has(s.id));
  const deletedCount = spools.length - filtered.length;
  if (deletedCount > 0) {
    setItem(KEYS.SPOOLS, filtered);
    scheduleAutoReplan('spools_deleted');
    notifyInventoryChanged();
  }
  return deletedCount;
};

// ============= COLOR INVENTORY FUNCTIONS =============

export const getColorInventory = (): ColorInventoryItem[] => {
  return getItem<ColorInventoryItem[]>(KEYS.COLOR_INVENTORY, []);
};

export const getColorInventoryItem = (color: string, material: string): ColorInventoryItem | undefined => {
  const colorKey = normalizeColor(color);
  const items = getColorInventory();
  return items.find(item => 
    normalizeColor(item.color) === colorKey && 
    item.material.toLowerCase() === material.toLowerCase()
  );
};

export const upsertColorInventoryItem = (item: Omit<ColorInventoryItem, 'id' | 'updatedAt'>): ColorInventoryItem => {
  const items = getColorInventory();
  const colorKey = normalizeColor(item.color);
  const existingIndex = items.findIndex(i => 
    normalizeColor(i.color) === colorKey && 
    i.material.toLowerCase() === item.material.toLowerCase()
  );
  
  const now = new Date().toISOString();
  
  if (existingIndex >= 0) {
    // Update existing
    items[existingIndex] = {
      ...items[existingIndex],
      ...item,
      updatedAt: now,
    };
    setItem(KEYS.COLOR_INVENTORY, items);
    scheduleAutoReplan('inventory_updated');
    notifyInventoryChanged();
    return items[existingIndex];
  } else {
    // Create new
    const newItem: ColorInventoryItem = {
      ...item,
      id: `${item.material}:${item.color}`,
      updatedAt: now,
    };
    setItem(KEYS.COLOR_INVENTORY, [...items, newItem]);
    scheduleAutoReplan('inventory_updated');
    notifyInventoryChanged();
    return newItem;
  }
};

export const adjustClosedCount = (color: string, material: string, delta: number): ColorInventoryItem | undefined => {
  const items = getColorInventory();
  const colorKey = normalizeColor(color);
  const index = items.findIndex(i => 
    normalizeColor(i.color) === colorKey && 
    i.material.toLowerCase() === material.toLowerCase()
  );
  
  if (index >= 0) {
    items[index] = {
      ...items[index],
      closedCount: Math.max(0, items[index].closedCount + delta),
      updatedAt: new Date().toISOString(),
    };
    setItem(KEYS.COLOR_INVENTORY, items);
    scheduleAutoReplan('inventory_updated');
    notifyInventoryChanged();
    return items[index];
  }
  
  // If item doesn't exist and delta is positive, create it
  if (delta > 0) {
    return upsertColorInventoryItem({
      color,
      material,
      closedCount: delta,
      closedSpoolSizeGrams: 1000,
      openTotalGrams: 0,
    });
  }
  
  return undefined;
};

export const setOpenTotalGrams = (color: string, material: string, grams: number): ColorInventoryItem | undefined => {
  const items = getColorInventory();
  const colorKey = normalizeColor(color);
  const index = items.findIndex(i => 
    normalizeColor(i.color) === colorKey && 
    i.material.toLowerCase() === material.toLowerCase()
  );
  
  if (index >= 0) {
    items[index] = {
      ...items[index],
      openTotalGrams: Math.max(0, grams),
      updatedAt: new Date().toISOString(),
    };
    setItem(KEYS.COLOR_INVENTORY, items);
    scheduleAutoReplan('inventory_updated');
    notifyInventoryChanged();
    return items[index];
  }
  
  // If item doesn't exist and grams > 0, create it
  if (grams > 0) {
    return upsertColorInventoryItem({
      color,
      material,
      closedCount: 0,
      closedSpoolSizeGrams: 1000,
      openTotalGrams: grams,
    });
  }
  
  return undefined;
};

export const adjustOpenTotalGrams = (color: string, material: string, delta: number): ColorInventoryItem | undefined => {
  const items = getColorInventory();
  const colorKey = normalizeColor(color);
  const index = items.findIndex(i => 
    normalizeColor(i.color) === colorKey && 
    i.material.toLowerCase() === material.toLowerCase()
  );
  
  if (index >= 0) {
    const newOpenGrams = Math.max(0, items[index].openTotalGrams + delta);
    items[index] = {
      ...items[index],
      openTotalGrams: newOpenGrams,
      updatedAt: new Date().toISOString(),
    };
    setItem(KEYS.COLOR_INVENTORY, items);
    scheduleAutoReplan('material_consumed');
    notifyInventoryChanged();
    return items[index];
  }
  
  return undefined;
};

/**
 * Rename the color of an inventory item
 */
export const renameColorInventoryItem = (oldColor: string, material: string, newColor: string): ColorInventoryItem | undefined => {
  if (!newColor.trim()) return undefined;
  
  const items = getColorInventory();
  const oldColorKey = normalizeColor(oldColor);
  const index = items.findIndex(i => 
    normalizeColor(i.color) === oldColorKey && 
    i.material.toLowerCase() === material.toLowerCase()
  );
  
  if (index >= 0) {
    items[index] = {
      ...items[index],
      color: newColor.trim(),
      id: `${items[index].material}:${newColor.trim()}`,
      updatedAt: new Date().toISOString(),
    };
    setItem(KEYS.COLOR_INVENTORY, items);
    scheduleAutoReplan('inventory_updated');
    notifyInventoryChanged();
    return items[index];
  }
  
  return undefined;
};

/**
 * Open a new closed spool - decrements closed count, adds to open grams
 * @param sizeGrams - optional size override (defaults to item's closedSpoolSizeGrams)
 */
export const openNewSpool = (color: string, material: string, sizeGrams?: number): ColorInventoryItem | undefined => {
  const item = getColorInventoryItem(color, material);
  if (!item || item.closedCount <= 0) return undefined;
  
  const items = getColorInventory();
  const colorKey = normalizeColor(color);
  const index = items.findIndex(i => 
    normalizeColor(i.color) === colorKey && 
    i.material.toLowerCase() === material.toLowerCase()
  );
  
  if (index >= 0) {
    const gramsToAdd = sizeGrams ?? items[index].closedSpoolSizeGrams;
    items[index] = {
      ...items[index],
      closedCount: items[index].closedCount - 1,
      openTotalGrams: items[index].openTotalGrams + gramsToAdd,
      updatedAt: new Date().toISOString(),
    };
    setItem(KEYS.COLOR_INVENTORY, items);
    scheduleAutoReplan('spool_opened');
    notifyInventoryChanged();
    return items[index];
  }
  
  return undefined;
};

/**
 * Consume material from color inventory (called after cycle completion)
 */
export const consumeFromColorInventory = (
  color: string, 
  material: string, 
  gramsToConsume: number
): { success: boolean; consumed: number; remaining: number } => {
  const item = getColorInventoryItem(color, material);
  if (!item) {
    return { success: false, consumed: 0, remaining: 0 };
  }
  
  const actualConsume = Math.min(item.openTotalGrams, gramsToConsume);
  const newOpenGrams = item.openTotalGrams - actualConsume;
  
  if (actualConsume > 0) {
    adjustOpenTotalGrams(color, material, -actualConsume);
  }
  
  return { 
    success: true, 
    consumed: actualConsume, 
    remaining: Math.max(0, newOpenGrams),
  };
};

/**
 * Seed color inventory with demo data
 */
export const seedColorInventoryDemo = (): void => {
  const demoInventory: Omit<ColorInventoryItem, 'id' | 'updatedAt'>[] = [
    { color: 'Black', material: 'PLA', closedCount: 8, closedSpoolSizeGrams: 1000, openTotalGrams: 650, reorderPointGrams: 2000 },
    { color: 'White', material: 'PLA', closedCount: 10, closedSpoolSizeGrams: 1000, openTotalGrams: 420, reorderPointGrams: 2000 },
    { color: 'Gray', material: 'PLA', closedCount: 4, closedSpoolSizeGrams: 1000, openTotalGrams: 300, reorderPointGrams: 2000 },
    { color: 'Red', material: 'PLA', closedCount: 3, closedSpoolSizeGrams: 1000, openTotalGrams: 0, reorderPointGrams: 1000 },
    { color: 'Blue', material: 'PLA', closedCount: 5, closedSpoolSizeGrams: 1000, openTotalGrams: 180, reorderPointGrams: 1000 },
    { color: 'Green', material: 'PLA', closedCount: 2, closedSpoolSizeGrams: 1000, openTotalGrams: 0, reorderPointGrams: 1000 },
    { color: 'White', material: 'PETG', closedCount: 2, closedSpoolSizeGrams: 1000, openTotalGrams: 0, reorderPointGrams: 1000 },
  ];
  
  demoInventory.forEach(item => upsertColorInventoryItem(item));
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

// ============= PROJECT STATUS PROMOTION =============

/**
 * Promotes projects from 'pending' to 'in_progress' when they have ready cycles.
 * This ensures projects appear in execution views once planning has created
 * executable cycles with mounted spools.
 * 
 * Rules:
 * - Only promotes 'pending' projects
 * - Requires at least one PlannedCycle with readinessState === 'ready'
 * - Does NOT require startTime or running state
 * 
 * Returns the count of promoted projects.
 */
export const promoteProjectsWithReadyCycles = (): number => {
  const projects = getProjectsLocal();
  const plannedCycles = getPlannedCycles();
  
  let promotedCount = 0;
  
  for (const project of projects) {
    if (project.status !== 'pending') continue;
    
    // Check if this project has any ready cycles
    const hasReadyCycle = plannedCycles.some(
      cycle => cycle.projectId === project.id && cycle.readinessState === 'ready'
    );
    
    if (hasReadyCycle) {
      updateProject(project.id, { status: 'in_progress' }, true); // skip auto-replan
      promotedCount++;
      console.log(`[ProjectPromotion] Promoted "${project.name}" to in_progress (has ready cycles)`);
    }
  }
  
  if (promotedCount > 0) {
    console.log(`[ProjectPromotion] Total promoted: ${promotedCount} projects`);
  }
  
  return promotedCount;
};

/**
 * Gets all projects that have planned cycles (regardless of status).
 * Use this for execution views that should show all schedulable work.
 */
export const getProjectsWithPlannedCycles = (): Project[] => {
  const projects = getProjectsLocal();
  const plannedCycles = getPlannedCycles();
  
  const projectIdsWithCycles = new Set(plannedCycles.map(c => c.projectId));
  
  return projects.filter(p => 
    projectIdsWithCycles.has(p.id) && p.status !== 'completed'
  );
};

// ============= FORCE COMPLETE PROJECT =============

/**
 * Check if a project has any in_progress cycles
 * Use this before opening force complete dialog
 */
export const hasActivePrintForProject = (projectId: string): boolean => {
  return getPlannedCycles().some(c => c.projectId === projectId && c.status === 'in_progress');
};

/**
 * Force complete a project early (even if not all units produced)
 * - Updates project status to 'completed'
 * - Cancels all future cycles (marked as 'cancelled', not deleted)
 * - Releases printers that were reserved for cancelled cycles
 * - Triggers replan to fill the gaps
 */
export const forceCompleteProject = (
  projectId: string, 
  confirmNoActivePrint: boolean = false
): { 
  success: boolean; 
  cancelledCycles: number;
  finalQuantity: number;
  hasActivePrint: boolean;
  error?: string;
} => {
  // 1. Get the project
  const project = getProject(projectId);
  if (!project) {
    return { success: false, cancelledCycles: 0, finalQuantity: 0, hasActivePrint: false, error: 'project_not_found' };
  }
  
  // 2. Check if there's an in_progress cycle (only check, don't modify)
  const hasActive = hasActivePrintForProject(projectId);
  
  if (hasActive && !confirmNoActivePrint) {
    // Don't proceed - return early so UI can show warning
    return { 
      success: false, 
      cancelledCycles: 0, 
      finalQuantity: project.quantityGood, 
      hasActivePrint: true,
      error: 'active_print_running' 
    };
  }
  
  // 3. Cancel future cycles (don't delete - mark as cancelled)
  const cycles = getPlannedCycles();
  const now = new Date().toISOString();
  
  const updated = cycles.map(c => {
    const isThisProject = c.projectId === projectId;
    const isCancellable = c.status === 'planned' || 
                          c.readinessState === 'waiting_for_spool';
    
    if (isThisProject && isCancellable) {
      return {
        ...c,
        status: 'cancelled' as const,
        cancelledAt: now,
        cancelReason: 'project_force_completed',
      };
    }
    return c;
  });
  
  const cancelledCount = updated.filter(c => 
    c.projectId === projectId && 
    c.status === 'cancelled' && 
    c.cancelledAt === now
  ).length;
  
  setItem(KEYS.PLANNED_CYCLES, updated);
  
  // 4. Release printers that were reserved ONLY for cancelled cycles
  const printers = getPrinters();
  const cancelledCyclesForProject = updated.filter(
    c => c.projectId === projectId && c.status === 'cancelled' && c.cancelledAt === now
  );
  const affectedPrinterIds = new Set(cancelledCyclesForProject.map(c => c.printerId));
  
  for (const printerId of affectedPrinterIds) {
    const printer = printers.find(p => p.id === printerId);
    if (!printer) continue;
    
    // CRITICAL: Only release if printer is in 'reserved' state (NOT 'in_use')
    if (printer.mountState !== 'reserved') continue;
    
    // Check if there are any remaining active cycles for this printer
    const hasOtherActiveCycles = updated.some(c => 
      c.printerId === printerId && 
      c.status !== 'cancelled' && 
      c.status !== 'completed' && 
      c.status !== 'failed'
    );
    
    if (!hasOtherActiveCycles) {
      updatePrinter(printerId, { mountState: 'idle' });
    }
  }
  
  // 5. Update project to completed
  updateProject(projectId, { status: 'completed' }, true); // skipAutoReplan = true
  
  // 6. Trigger replan to fill the gaps
  scheduleAutoReplan('project_force_completed');
  
  return { 
    success: true, 
    cancelledCycles: cancelledCount,
    finalQuantity: project.quantityGood,
    hasActivePrint: false,
  };
};

// ============= RESET ALL DATA =============

export const resetAllData = (): void => {
  Object.values(KEYS).forEach(key => localStorage.removeItem(key));
};
