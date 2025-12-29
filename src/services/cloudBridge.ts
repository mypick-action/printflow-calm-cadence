// Cloud Bridge - One-way sync from Cloud (Supabase) to localStorage
// Cloud = SSOT, localStorage = temporary cache for legacy engines

import { getPrinters, getFactorySettings, getProjects } from '@/services/cloudStorage';
import { 
  KEYS, 
  Printer, 
  Project,
  FactorySettings, 
  WeeklySchedule, 
  DaySchedule,
  getDefaultWeeklySchedule 
} from '@/services/storage';
import type { DbPrinter, DbFactorySettings, DbProject } from '@/services/cloudStorage';

// Bridge-specific localStorage keys for tracking hydration
const BRIDGE_KEYS = {
  lastHydratedAt: 'printflow_cloud_last_hydrated_at',
  lastHydratedWorkspace: 'printflow_cloud_last_hydrated_workspace',
} as const;

type AnyObj = Record<string, unknown>;

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try { 
    return JSON.parse(raw) as T; 
  } catch { 
    return null; 
  }
}

function nowMs(): number {
  return Date.now();
}

function shouldHydrate(workspaceId: string, minIntervalMs = 30_000): boolean {
  const lastWs = localStorage.getItem(BRIDGE_KEYS.lastHydratedWorkspace);
  const lastAt = Number(localStorage.getItem(BRIDGE_KEYS.lastHydratedAt) || '0');
  if (lastWs !== workspaceId) return true;
  return nowMs() - lastAt > minIntervalMs;
}

function markHydrated(workspaceId: string): void {
  localStorage.setItem(BRIDGE_KEYS.lastHydratedWorkspace, workspaceId);
  localStorage.setItem(BRIDGE_KEYS.lastHydratedAt, String(nowMs()));
}

// Preserve printerNumber from existing localStorage data by matching on id or name
function preservePrinterNumbers(existing: Printer[] | null, next: Printer[]): Printer[] {
  if (!existing?.length) return next;

  const byId = new Map(existing.filter(p => p?.id).map(p => [p.id, p]));
  const byName = new Map(existing.filter(p => p?.name).map(p => [p.name, p]));

  return next.map((p) => {
    const old = (p.id && byId.get(p.id)) || (p.name && byName.get(p.name));
    return {
      ...p,
      printerNumber: old?.printerNumber ?? p.printerNumber,
    };
  });
}

// Preserve runtime-only fields that are not stored in cloud (mounted colors, AMS state)
// This prevents hydration from cloud from wiping local spool-loading state
function preserveRuntimePrinterFields(existing: Printer[] | null, next: Printer[]): Printer[] {
  if (!existing?.length) return next;

  const byId = new Map(existing.filter(p => p?.id).map(p => [p.id, p]));
  const byName = new Map(existing.filter(p => p?.name).map(p => [p.name, p]));

  return next.map((p) => {
    const old = (p.id && byId.get(p.id)) || (p.name && byName.get(p.name));
    if (!old) return p;

    return {
      ...p,
      // Preserve runtime-loaded state so "actions required" won't reappear after navigation
      mountedColor: old.mountedColor ?? p.mountedColor,
      currentColor: old.currentColor ?? p.currentColor,
      currentMaterial: old.currentMaterial ?? p.currentMaterial,
      mountedSpoolId: old.mountedSpoolId ?? p.mountedSpoolId,
      amsSlotStates: old.amsSlotStates ?? p.amsSlotStates,
    };
  });
}

// Validate and normalize weeklySchedule to the format the engine expects
function normalizeWeeklySchedule(schedule: unknown): WeeklySchedule {
  const defaultSchedule = getDefaultWeeklySchedule();
  
  if (!schedule || typeof schedule !== 'object') {
    return defaultSchedule;
  }
  
  const days: (keyof WeeklySchedule)[] = [
    'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'
  ];
  
  const result: WeeklySchedule = { ...defaultSchedule };
  const scheduleObj = schedule as Record<string, unknown>;
  
  for (const day of days) {
    const dayData = scheduleObj[day];
    if (dayData && typeof dayData === 'object') {
      const d = dayData as Record<string, unknown>;
      const daySchedule: DaySchedule = {
        enabled: typeof d.enabled === 'boolean' ? d.enabled : defaultSchedule[day].enabled,
        startTime: typeof d.startTime === 'string' ? d.startTime : defaultSchedule[day].startTime,
        endTime: typeof d.endTime === 'string' ? d.endTime : defaultSchedule[day].endTime,
      };
      result[day] = daySchedule;
    }
  }
  
  return result;
}

export interface HydrateOptions {
  force?: boolean;
  includeProjects?: boolean;
  includePlannedCycles?: boolean;
}

export interface HydrateResult {
  ok: boolean;
  reason?: string;
  printersCount?: number;
  hasSettings?: boolean;
}

/**
 * One-way sync: Cloud → localStorage
 * Fetches printers and factory_settings from cloud and writes to localStorage
 * in the exact format expected by storage.ts/engines.
 */
export async function hydrateLocalFromCloud(
  workspaceId: string,
  opts?: HydrateOptions
): Promise<HydrateResult> {
  if (!workspaceId) {
    return { ok: false, reason: 'Missing workspaceId' };
  }

  const force = Boolean(opts?.force);

  if (!force && !shouldHydrate(workspaceId)) {
    return { ok: true, reason: 'Skipped (throttled)' };
  }

  console.log('[CloudBridge] Starting hydration for workspace:', workspaceId);

  // Get existing local data to preserve fields not in cloud
  const existingPrinters = safeJsonParse<Printer[]>(localStorage.getItem(KEYS.PRINTERS));
  const existingSettings = safeJsonParse<FactorySettings>(localStorage.getItem(KEYS.FACTORY_SETTINGS));

  // Fetch from cloud
  const [cloudPrinters, cloudSettings] = await Promise.all([
    getPrinters(workspaceId),
    getFactorySettings(workspaceId),
  ]);

  console.log('[CloudBridge] Cloud data:', {
    printersCount: cloudPrinters?.length ?? 0,
    hasSettings: !!cloudSettings,
  });

  // Map printers: cloud format → localStorage format
  const mappedPrinters: Printer[] = (cloudPrinters || []).map((p: DbPrinter, idx: number) => {
    const status = (p.status ?? 'active') as 'active' | 'out_of_service' | 'archived';

    return {
      id: p.id as string,
      printerNumber: idx + 1, // Will be preserved later if existing
      name: p.name as string,
      active: status === 'active',
      status,

      // AMS configuration
      hasAMS: Boolean(p.has_ams),
      amsSlots: (p.ams_slots as number) ?? undefined,
      amsModes: Boolean(p.has_ams)
        ? {
            backupSameColor: Boolean(p.ams_backup_mode),
            multiColor: Boolean(p.ams_multi_color),
          }
        : undefined,

      // Additional fields
      canStartNewCyclesAfterHours: Boolean(p.can_start_new_cycles_after_hours),
      maxSpoolWeight: (p.max_spool_weight as number) ?? undefined,
      
      // These fields are not in cloud, preserve from existing or leave undefined
      currentColor: undefined,
      currentMaterial: undefined,
      mountedSpoolId: (p.mounted_spool_id as string) ?? undefined,
    };
  });

  // Preserve printerNumber from existing data
  const printersWithNumbers = preservePrinterNumbers(existingPrinters, mappedPrinters);
  // Preserve runtime fields (mountedColor, amsSlotStates, etc.) that aren't in cloud
  const printersFinal = preserveRuntimePrinterFields(existingPrinters, printersWithNumbers);

  localStorage.setItem(KEYS.PRINTERS, JSON.stringify(printersFinal));
  console.log('[CloudBridge] Wrote printers to localStorage:', printersFinal.length);

  // Map factory_settings: cloud format → localStorage format
  const weeklySchedule = normalizeWeeklySchedule(cloudSettings?.weekly_work_hours);
  const afterHoursBehavior = (cloudSettings?.after_hours_behavior ?? 
    existingSettings?.afterHoursBehavior ?? 'NONE') as 'NONE' | 'ONE_CYCLE_END_OF_DAY' | 'FULL_AUTOMATION';
  const transitionMinutes = (cloudSettings?.transition_minutes ?? 
    existingSettings?.transitionMinutes ?? 10) as number;

  // CRITICAL: Don't invent data that doesn't exist
  // Use existing local values or empty/minimal defaults
  const localFactorySettings: FactorySettings = {
    printerCount: printersFinal.length,
    weeklySchedule,
    afterHoursBehavior,
    transitionMinutes,

    // Preserve from existing localStorage - don't invent
    colors: existingSettings?.colors ?? [],
    standardSpoolWeight: existingSettings?.standardSpoolWeight ?? 1000,
    deliveryDays: existingSettings?.deliveryDays ?? 2,
    priorityRules: existingSettings?.priorityRules ?? { 
      urgentDaysThreshold: 14, 
      criticalDaysThreshold: 7 
    },
    hasAMS: printersFinal.some(p => p.hasAMS),
    schedulingStrategy: existingSettings?.schedulingStrategy,
  };

  localStorage.setItem(KEYS.FACTORY_SETTINGS, JSON.stringify(localFactorySettings));
  console.log('[CloudBridge] Wrote factory_settings to localStorage');

  // Only mark onboarding complete if we actually have cloud data
  if (cloudPrinters?.length && cloudSettings) {
    localStorage.setItem(KEYS.ONBOARDING_COMPLETE, 'true');
  }

  // Optional: Hydrate projects
  if (opts?.includeProjects) {
    const cloudProjects = await getProjects(workspaceId);
    const existingProjects = safeJsonParse<Project[]>(localStorage.getItem(KEYS.PROJECTS));
    
    // Map projects: cloud format → localStorage format
    const mappedProjects: Project[] = (cloudProjects || []).map((p: DbProject) => {
      // Find existing project to preserve local-only fields
      const existing = existingProjects?.find(ep => ep.id === p.id);
      
      return {
        id: p.id,
        name: p.name,
        productId: p.product_id ?? '',
        productName: existing?.productName ?? '', // Not in cloud, preserve or empty
        preferredPresetId: p.preset_id ?? undefined,
        quantityTarget: p.quantity_target ?? 1,
        quantityGood: p.quantity_completed ?? 0,
        quantityScrap: p.quantity_failed ?? 0,
        dueDate: p.deadline ?? '',
        urgency: (p.priority === 'urgent' || p.priority === 'critical') 
          ? p.priority as 'urgent' | 'critical' 
          : 'normal',
        urgencyManualOverride: false, // Not in cloud
        status: (p.status ?? 'pending') as 'pending' | 'in_progress' | 'completed' | 'on_hold',
        color: existing?.color ?? '', // Not in cloud, preserve or empty
        createdAt: p.created_at ?? new Date().toISOString(),
        parentProjectId: p.parent_project_id ?? undefined,
        customCycleHours: p.custom_cycle_hours ?? undefined,
        isRecoveryProject: p.is_recovery_project ?? false,
      };
    });

    localStorage.setItem(KEYS.PROJECTS, JSON.stringify(mappedProjects));
    console.log('[CloudBridge] Wrote projects to localStorage:', mappedProjects.length);
  }

  markHydrated(workspaceId);
  
  return { 
    ok: true,
    printersCount: printersFinal.length,
    hasSettings: !!cloudSettings,
  };
}

/**
 * Debug helper: Compare cloud vs localStorage data
 */
export async function getCloudLocalComparison(workspaceId: string): Promise<{
  cloud: { printersCount: number; hasSettings: boolean; afterHoursBehavior?: string };
  local: { printersCount: number; hasSettings: boolean; afterHoursBehavior?: string };
  lastHydratedAt: string | null;
}> {
  const [cloudPrinters, cloudSettings] = await Promise.all([
    getPrinters(workspaceId),
    getFactorySettings(workspaceId),
  ]);

  const localPrinters = safeJsonParse<Printer[]>(localStorage.getItem(KEYS.PRINTERS));
  const localSettings = safeJsonParse<FactorySettings>(localStorage.getItem(KEYS.FACTORY_SETTINGS));

  const lastHydratedAt = localStorage.getItem(BRIDGE_KEYS.lastHydratedAt);

  return {
    cloud: {
      printersCount: cloudPrinters?.length ?? 0,
      hasSettings: !!cloudSettings,
      afterHoursBehavior: cloudSettings?.after_hours_behavior,
    },
    local: {
      printersCount: localPrinters?.length ?? 0,
      hasSettings: !!localSettings,
      afterHoursBehavior: localSettings?.afterHoursBehavior,
    },
    lastHydratedAt: lastHydratedAt ? new Date(Number(lastHydratedAt)).toISOString() : null,
  };
}
