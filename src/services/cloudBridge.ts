// Cloud Bridge - One-way sync from Cloud (Supabase) to localStorage
// Cloud = SSOT, localStorage = temporary cache for legacy engines

import { 
  getPrinters, 
  getFactorySettings, 
  getProjects, 
  getPlannedCycles, 
  upsertProjectByLegacyId, 
  upsertPlannedCycleByLegacyId,
  upsertProductByLegacyId,
  upsertPlatePresetByLegacyId,
  getMaterialInventory,
  upsertMaterialInventory,
  getProducts as getCloudProducts,
  getPlatePresets as getCloudPlatePresets,
  createProduct,
  createPlatePreset,
  createSpool,
  getSpools,
} from '@/services/cloudStorage';
import type { UpsertProjectData, UpsertPlannedCycleData, MaterialInventoryInput, DbProduct, DbPlatePreset, DbSpool } from '@/services/cloudStorage';
import { supabase } from '@/integrations/supabase/client';
import { formatDateStringLocal } from '@/services/dateUtils';
import {
  KEYS, 
  Printer, 
  Project,
  PlannedCycle,
  FactorySettings,
  ColorInventoryItem,
  WeeklySchedule, 
  DaySchedule,
  getDefaultWeeklySchedule,
  Product as LocalProduct,
  PlatePreset as LocalPlatePreset,
  Spool as LocalSpool,
} from '@/services/storage';
import type { DbPrinter, DbFactorySettings, DbProject as DbProjectType } from '@/services/cloudStorage';

// Bridge-specific localStorage keys for tracking hydration
const BRIDGE_KEYS = {
  lastHydratedAt: 'printflow_cloud_last_hydrated_at',
  lastHydratedWorkspace: 'printflow_cloud_last_hydrated_workspace',
} as const;

type AnyObj = Record<string, unknown>;

// Helper to detect if a string is a UUID (cloud ID) vs legacy timestamp-based ID
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(s: string): boolean {
  return UUID_REGEX.test(s);
}
export function isLegacyId(s: string): boolean {
  return !isUuid(s);
}

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
  includeProducts?: boolean;
  includeInventory?: boolean;
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
    
    console.log('[CloudBridge] Projects hydration mode: OVERWRITE (cloud is SSOT)');
    console.log('[CloudBridge] Cloud projects count:', cloudProjects.length);
    
    // Build lookup: UUID → legacy_id for cycle mapping
    const projectUuidToLegacyId = new Map<string, string>();
    for (const p of cloudProjects) {
      // Accept both UUID-only projects and those with legacy_id
      const localId = p.legacy_id || p.id;
      projectUuidToLegacyId.set(p.id, localId);
    }
    
    // Map projects: cloud format → localStorage format
    // OVERWRITE MODE: No merge with existing - cloud is single source of truth
    const mappedProjects: Project[] = [];
    
    for (const p of cloudProjects || []) {
      // FIXED: Accept both UUID-only and legacy_id projects
      const localId = p.legacy_id || p.id; // Prefer legacy_id, fallback to UUID
      
      // NO existing lookup - pure overwrite from cloud!
      mappedProjects.push({
        id: localId,
        name: p.name ?? '',
        productId: p.product_id ?? '',
        productName: p.product_id ? '' : 'ללא מוצר', // Will be populated by product lookup
        preferredPresetId: p.preset_id ?? undefined,
        quantityTarget: p.quantity_target ?? 1,
        quantityGood: p.quantity_completed ?? 0,
        quantityScrap: p.quantity_failed ?? 0,
        dueDate: p.deadline ?? '',
        urgency: (p.priority === 'urgent' || p.priority === 'critical') 
          ? p.priority as 'urgent' | 'critical' 
          : 'normal',
        urgencyManualOverride: false, // Cloud is SSOT
        status: (p.status ?? 'pending') as 'pending' | 'in_progress' | 'completed' | 'on_hold',
        color: p.color ?? '',
        createdAt: p.created_at ?? new Date().toISOString(),
        parentProjectId: p.parent_project_id ?? undefined,
        customCycleHours: p.custom_cycle_hours ?? undefined,
        isRecoveryProject: p.is_recovery_project ?? false,
        includeInPlanning: (p as any).include_in_planning !== false, // Default true
        // Store UUID for future sync reference
        cloudUuid: p.id,
      } as Project & { cloudUuid?: string });
    }

    localStorage.setItem(KEYS.PROJECTS, JSON.stringify(mappedProjects));
    console.log('[CloudBridge] OVERWRITE projects to localStorage:', mappedProjects.length);
    
    // Also hydrate planned cycles if requested
    if (opts?.includePlannedCycles) {
      const cloudCycles = await getPlannedCycles(workspaceId);
      
      // Check existing local cycles BEFORE deciding to overwrite
      const existingCyclesRaw = localStorage.getItem(KEYS.PLANNED_CYCLES);
      const existingLocalCycles = existingCyclesRaw ? JSON.parse(existingCyclesRaw) : [];
      
      console.log('[CloudBridge] Cycles hydration - cloud:', cloudCycles.length, 'local:', existingLocalCycles.length);
      
      // If cloud is empty but local has cycles, PRESERVE local cycles
      // Local is source of truth until cycles are synced to cloud
      if (cloudCycles.length === 0 && existingLocalCycles.length > 0) {
        console.log('[CloudBridge] Cloud cycles empty → preserving', existingLocalCycles.length, 'local cycles');
        // Skip overwriting - local is source of truth until migration
      } else if (cloudCycles.length > 0) {
        // Cloud has cycles - proceed with hydration (cloud is SSOT)
        console.log('[CloudBridge] Cloud has cycles → overwriting localStorage');
        
        // Map cycles: cloud format → localStorage format
        const mappedCycles: PlannedCycle[] = (cloudCycles || []).map((c) => {
          // Map project UUID to legacy_id
          const projectLegacyId = projectUuidToLegacyId.get(c.project_id) || c.project_id;
          
          return {
            id: c.legacy_id || c.id,
            projectId: projectLegacyId,
            printerId: c.printer_id,
            unitsPlanned: c.units_planned ?? 1,
            gramsPlanned: 0, // Will be recalculated by planning engine
            plateType: 'full',
            startTime: c.start_time ?? '',
            endTime: c.end_time ?? '',
            shift: 'day',
            status: (c.status === 'scheduled' ? 'planned' : c.status) as PlannedCycle['status'],
            readinessState: undefined,
            requiredColor: undefined,
            requiredMaterial: undefined,
            requiredGrams: undefined,
            source: 'auto',
            locked: false,
            projectUuid: c.project_id,
            cycleUuid: c.id,
          } as PlannedCycle & { projectUuid?: string; cycleUuid?: string };
        });

        localStorage.setItem(KEYS.PLANNED_CYCLES, JSON.stringify(mappedCycles));
        console.log('[CloudBridge] OVERWRITE cycles to localStorage:', mappedCycles.length);
      } else {
        // Both are empty - nothing to do
        console.log('[CloudBridge] Both cloud and local cycles are empty');
      }
    }
  }

  // Optional: Hydrate products
  if (opts?.includeProducts) {
    const cloudProducts = await getCloudProducts(workspaceId);
    
    // CRITICAL: Check existing local products BEFORE overwriting
    const existingRaw = localStorage.getItem(KEYS.PRODUCTS);
    const existingLocal = existingRaw ? JSON.parse(existingRaw) : [];
    
    // If cloud is empty but local has products, DON'T overwrite - local is source of truth until migration
    if (cloudProducts.length === 0 && existingLocal.length > 0) {
      console.log('[CloudBridge] Cloud products empty → preserving', existingLocal.length, 'local products');
      // Skip product hydration entirely
    } else if (cloudProducts.length > 0) {
      // Cloud has products - proceed with hydration
      const cloudPresets = await getCloudPlatePresets(workspaceId);
      
      // Build preset lookup by product_id
      const presetsByProductId = new Map<string, DbPlatePreset[]>();
      for (const preset of cloudPresets) {
        if (preset.product_id) {
          const existing = presetsByProductId.get(preset.product_id) || [];
          existing.push(preset);
          presetsByProductId.set(preset.product_id, existing);
        }
      }
      
      // Map cloud products + presets to local Product format
      const mappedProducts: LocalProduct[] = cloudProducts.map((cp: DbProduct) => {
        const productPresets = presetsByProductId.get(cp.id) || [];
        
        return {
          id: cp.id, // Products don't have legacy_id, use UUID directly
          name: cp.name,
          gramsPerUnit: cp.default_grams_per_unit,
          platePresets: productPresets.length > 0 
            ? productPresets.map((preset, index) => ({
                id: preset.id,
                name: preset.name,
                unitsPerPlate: preset.units_per_plate,
                cycleHours: preset.cycle_hours,
                riskLevel: 'low' as const,
                allowedForNightCycle: preset.allowed_for_night_cycle,
                isRecommended: index === 0, // First preset is recommended
              }))
            : [{
                // Default preset if none exist
                id: `preset-${cp.id}-default`,
                name: 'Default',
                unitsPerPlate: cp.default_units_per_plate,
                cycleHours: cp.default_print_time_hours,
                riskLevel: 'low' as const,
                allowedForNightCycle: true,
                isRecommended: true,
              }],
        };
      });
      
      // Backup before overwriting
      if (existingLocal.length > 0) {
        localStorage.setItem('printflow_products_backup', JSON.stringify(existingLocal));
        console.log('[CloudBridge] Backed up', existingLocal.length, 'local products before overwrite');
      }
      
      localStorage.setItem(KEYS.PRODUCTS, JSON.stringify(mappedProducts));
      console.log('[CloudBridge] Wrote products to localStorage:', mappedProducts.length);
    }
  }

  // Hydrate material inventory if requested
  if (opts?.includeInventory) {
    await hydrateInventoryFromCloud(workspaceId);
    console.log('[CloudBridge] Hydrated material inventory from cloud');
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

/**
 * Idempotent migration: Push local projects to cloud using legacy_id
 * Always upserts (creates or updates) - safe to run multiple times
 */
export async function migrateLocalProjectsToCloud(
  workspaceId: string
): Promise<{ created: number; updated: number; errors: number; nullProductCount: number; nullPresetCount: number }> {
  if (!workspaceId) {
    return { created: 0, updated: 0, errors: 0, nullProductCount: 0, nullPresetCount: 0 };
  }

  console.log('[CloudBridge] Starting project migration for workspace:', workspaceId);

  // Get local projects
  const localProjects = safeJsonParse<Project[]>(localStorage.getItem(KEYS.PROJECTS)) || [];
  if (localProjects.length === 0) {
    console.log('[CloudBridge] No local projects to migrate');
    return { created: 0, updated: 0, errors: 0, nullProductCount: 0, nullPresetCount: 0 };
  }

  let created = 0;
  let updated = 0;
  let errors = 0;
  let nullProductCount = 0;
  let nullPresetCount = 0;

  for (const project of localProjects) {
    const legacyId = project.id;
    
    // CRITICAL: Only migrate projects with legacy IDs (not UUIDs)
    // This prevents the snowball effect where UUIDs become legacy_ids
    if (isUuid(legacyId)) {
      console.log('[CloudBridge] Skipping UUID project (cloud-first):', legacyId);
      continue;
    }
    
    // Track projects with local IDs that can't be mapped to cloud UUIDs
    if (project.productId) nullProductCount++;
    if (project.preferredPresetId) nullPresetCount++;
    
    try {
      // Note: product_id and preset_id are set to null because local IDs are not UUIDs
      // Phase 2: Add legacy_id to products/plate_presets tables for full mapping
      const projectData: UpsertProjectData = {
        name: project.name,
        product_id: null,  // Local product IDs are not UUIDs - requires Phase 2 mapping
        preset_id: null,   // Local preset IDs are not UUIDs - requires Phase 2 mapping
        quantity_target: project.quantityTarget,
        quantity_completed: project.quantityGood,
        quantity_failed: project.quantityScrap,
        status: project.status,
        priority: project.urgency,
        deadline: project.dueDate || null,
        assigned_printer_id: null,
        custom_cycle_hours: project.customCycleHours ?? null,
        is_recovery_project: project.isRecoveryProject ?? false,
        parent_project_id: project.parentProjectId || null,
        notes: null,
        color: project.color || null, // Save project color to cloud
        include_in_planning: project.includeInPlanning !== false, // Default true
      };
      
      const result = await upsertProjectByLegacyId(workspaceId, legacyId, projectData);
      
      if (result.data) {
        if (result.created) {
          console.log(`[CloudBridge] Created project: legacy_id=${legacyId} -> uuid=${result.data.id}`);
          created++;
        } else {
          console.log(`[CloudBridge] Updated project: legacy_id=${legacyId} -> uuid=${result.data.id}`);
          updated++;
        }
      } else {
        console.error(`[CloudBridge] Failed to upsert project: legacy_id=${legacyId}`);
        errors++;
      }
    } catch (e) {
      console.error(`[CloudBridge] Migration error for legacy_id=${legacyId}:`, e);
      errors++;
    }
  }

  console.log('[CloudBridge] Project migration complete:', { 
    created, 
    updated, 
    errors,
    nullProductCount,
    nullPresetCount,
    note: nullProductCount > 0 || nullPresetCount > 0 
      ? `⚠️ ${nullProductCount} projects had product_id set to null, ${nullPresetCount} had preset_id set to null (local IDs are not UUIDs)`
      : 'All projects migrated without product/preset data'
  });
  return { created, updated, errors, nullProductCount, nullPresetCount };
}

/**
 * Idempotent migration: Push local planned cycles to cloud using legacy_id
 * Always upserts (creates or updates) - safe to run multiple times
 * IMPORTANT: Must be called AFTER migrateLocalProjectsToCloud to have project UUID mapping
 */
export async function migrateLocalCyclesToCloud(
  workspaceId: string
): Promise<{ created: number; updated: number; errors: number; skippedNoProject: number }> {
  if (!workspaceId) {
    return { created: 0, updated: 0, errors: 0, skippedNoProject: 0 };
  }

  console.log('[CloudBridge] Starting planned cycles migration for workspace:', workspaceId);

  // Get local planned cycles
  const localCycles = safeJsonParse<PlannedCycle[]>(localStorage.getItem(KEYS.PLANNED_CYCLES)) || [];
  if (localCycles.length === 0) {
    console.log('[CloudBridge] No local planned cycles to migrate');
    return { created: 0, updated: 0, errors: 0, skippedNoProject: 0 };
  }

  // Get cloud projects to map legacy project IDs to UUIDs
  const cloudProjects = await getProjects(workspaceId);
  const projectLegacyToUuid = new Map<string, string>();
  for (const p of cloudProjects) {
    if (p.legacy_id) {
      projectLegacyToUuid.set(p.legacy_id, p.id);
    }
  }

  let created = 0;
  let updated = 0;
  let errors = 0;
  let skippedNoProject = 0;

  for (const cycle of localCycles) {
    const legacyId = cycle.id;
    const localProjectId = cycle.projectId;
    
    // Map local project ID to cloud UUID
    const cloudProjectId = projectLegacyToUuid.get(localProjectId);
    if (!cloudProjectId) {
      console.warn(`[CloudBridge] Skipping cycle ${legacyId}: project ${localProjectId} not found in cloud`);
      skippedNoProject++;
      continue;
    }
    
    try {
      // Extract scheduled_date from startTime using LOCAL time (not UTC)
      const scheduledDate = cycle.startTime 
        ? formatDateStringLocal(new Date(cycle.startTime)) 
        : formatDateStringLocal(new Date());
      
      const cycleData: UpsertPlannedCycleData = {
        project_id: cloudProjectId,
        printer_id: cycle.printerId,
        preset_id: null, // Not stored in local PlannedCycle
        scheduled_date: scheduledDate,
        start_time: cycle.startTime || null,
        end_time: cycle.endTime || null,
        units_planned: cycle.unitsPlanned,
        status: cycle.status === 'planned' ? 'scheduled' : cycle.status,
        cycle_index: 0, // Not tracked in local PlannedCycle
      };
      
      const result = await upsertPlannedCycleByLegacyId(workspaceId, legacyId, cycleData);
      
      if (result.data) {
        if (result.created) {
          console.log(`[CloudBridge] Created cycle: legacy_id=${legacyId} -> uuid=${result.data.id}`);
          created++;
        } else {
          console.log(`[CloudBridge] Updated cycle: legacy_id=${legacyId} -> uuid=${result.data.id}`);
          updated++;
        }
      } else {
        console.error(`[CloudBridge] Failed to upsert cycle: legacy_id=${legacyId}`);
        errors++;
      }
    } catch (e) {
      console.error(`[CloudBridge] Cycle migration error for legacy_id=${legacyId}:`, e);
      errors++;
    }
  }

  console.log('[CloudBridge] Cycle migration complete:', { created, updated, errors, skippedNoProject });
  return { created, updated, errors, skippedNoProject };
}

/**
 * Migrate local Products + PlatePresets to Cloud
 * Uses upsert by legacy_id for idempotent re-import
 */
export async function migrateLocalProductsToCloud(
  workspaceId: string
): Promise<{ products: number; presets: number; updated: number; errors: number }> {
  if (!workspaceId) {
    return { products: 0, presets: 0, updated: 0, errors: 0 };
  }

  console.log('[CloudBridge] Starting products migration for workspace:', workspaceId);

  // Get local products from localStorage
  const localProducts = safeJsonParse<LocalProduct[]>(localStorage.getItem(KEYS.PRODUCTS)) || [];
  if (localProducts.length === 0) {
    console.log('[CloudBridge] No local products to migrate');
    return { products: 0, presets: 0, updated: 0, errors: 0 };
  }

  let products = 0;
  let presets = 0;
  let updated = 0;
  let errors = 0;

  for (const product of localProducts) {
    try {
      // Skip if already a UUID (cloud-created) - these came FROM cloud
      if (isUuid(product.id)) {
        console.log(`[CloudBridge] Skipping cloud-created product: ${product.name}`);
        continue;
      }

      // Use legacy_id upsert (idempotent - safe to run multiple times)
      const legacyId = product.id; // Local ID becomes legacy_id in cloud
      
      const result = await upsertProductByLegacyId(workspaceId, legacyId, {
        name: product.name,
        material: 'PLA', // Default
        color: 'black', // Default
        default_grams_per_unit: product.gramsPerUnit,
        default_units_per_plate: product.platePresets[0]?.unitsPerPlate || 1,
        default_print_time_hours: product.platePresets[0]?.cycleHours || 1,
        notes: null,
      });

      if (!result.data) {
        errors++;
        continue;
      }

      const cloudProductId = result.data.id;
      if (result.created) {
        products++;
        console.log(`[CloudBridge] Created product: ${product.name} (legacy_id=${legacyId}) -> ${cloudProductId}`);
      } else {
        updated++;
        console.log(`[CloudBridge] Updated product: ${product.name} (legacy_id=${legacyId}) -> ${cloudProductId}`);
      }

      // Upsert plate presets with legacy_id
      for (const preset of product.platePresets) {
        const presetLegacyId = preset.id; // Local preset ID becomes legacy_id
        
        const presetResult = await upsertPlatePresetByLegacyId(workspaceId, presetLegacyId, {
          product_id: cloudProductId,
          name: preset.name,
          units_per_plate: preset.unitsPerPlate,
          cycle_hours: preset.cycleHours,
          grams_per_unit: product.gramsPerUnit,
          allowed_for_night_cycle: preset.allowedForNightCycle,
        });

        if (presetResult.data) {
          if (presetResult.created) {
            presets++;
          }
        } else {
          errors++;
        }
      }
    } catch (e) {
      console.error(`[CloudBridge] Product migration error for ${product.name}:`, e);
      errors++;
    }
  }

  console.log('[CloudBridge] Products migration complete:', { products, presets, updated, errors });
  return { products, presets, updated, errors };
}

/**
 * Migrate local Spools to Cloud
 * Uses upsert with color+material deduplication
 */
export async function migrateLocalSpoolsToCloud(
  workspaceId: string
): Promise<{ created: number; skipped: number; errors: number }> {
  if (!workspaceId) {
    return { created: 0, skipped: 0, errors: 0 };
  }

  console.log('[CloudBridge] Starting spools migration for workspace:', workspaceId);

  // Get local spools from localStorage
  const localSpools = safeJsonParse<LocalSpool[]>(localStorage.getItem(KEYS.SPOOLS)) || [];
  if (localSpools.length === 0) {
    console.log('[CloudBridge] No local spools to migrate');
    return { created: 0, skipped: 0, errors: 0 };
  }

  // Get existing cloud spools to avoid duplicates
  const existingSpools = await getSpools(workspaceId);
  const existingByColorMaterial = new Set(
    existingSpools.map(s => `${s.color.toLowerCase()}|${s.material.toLowerCase()}`)
  );

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const spool of localSpools) {
    try {
      // Skip if already a UUID (cloud-created)
      if (isUuid(spool.id)) {
        skipped++;
        continue;
      }

      // Check for existing spool by color+material
      const key = `${spool.color.toLowerCase()}|${spool.material.toLowerCase()}`;
      if (existingByColorMaterial.has(key)) {
        console.log(`[CloudBridge] Spool already exists: ${spool.color}/${spool.material}, skipping`);
        skipped++;
        continue;
      }

      const cloudSpool = await createSpool(workspaceId, {
        color: spool.color,
        material: spool.material,
        weight_grams: spool.packageSize,
        remaining_grams: spool.gramsRemainingEst,
        status: spool.state === 'empty' ? 'empty' : 'available',
        color_hex: null,
        cost_per_kg: null,
        supplier: null,
        notes: null,
      });

      if (cloudSpool) {
        created++;
        existingByColorMaterial.add(key); // Prevent duplicates in same batch
      } else {
        errors++;
      }
    } catch (e) {
      console.error(`[CloudBridge] Spool migration error for ${spool.color}/${spool.material}:`, e);
      errors++;
    }
  }

  console.log('[CloudBridge] Spools migration complete:', { created, skipped, errors });
  return { created, skipped, errors };
}

export interface FullMigrationReport {
  projects: { created: number; updated: number; errors: number };
  cycles: { created: number; updated: number; errors: number; skippedNoProject: number };
  products: { products: number; presets: number; updated: number; errors: number };
  spools: { created: number; skipped: number; errors: number };
  inventory: { created: number; updated: number; errors: number };
  totalMigrated: number;
  totalErrors: number;
}

/**
 * Full migration: All entities from localStorage to Cloud
 * Runs migrations in correct order (products first, then projects, then cycles)
 * Returns comprehensive report with counts
 */
export async function migrateAllLocalDataToCloud(
  workspaceId: string
): Promise<FullMigrationReport> {
  console.log('[CloudBridge] Starting FULL migration for workspace:', workspaceId);
  
  // 1. Products + Presets (must be first - projects may reference them)
  const productsResult = await migrateLocalProductsToCloud(workspaceId);
  
  // 2. Spools
  const spoolsResult = await migrateLocalSpoolsToCloud(workspaceId);
  
  // 3. Projects
  const projectsResult = await migrateLocalProjectsToCloud(workspaceId);
  
  // 4. Cycles (after projects - references project UUIDs)
  const cyclesResult = await migrateLocalCyclesToCloud(workspaceId);
  
  // 5. Inventory (material_inventory table)
  const inventoryResult = await migrateInventoryToCloud(workspaceId);
  
  const totalMigrated = 
    productsResult.products + 
    productsResult.presets +
    spoolsResult.created +
    projectsResult.created + 
    cyclesResult.created + 
    inventoryResult.updated;
    
  const totalErrors =
    productsResult.errors +
    spoolsResult.errors +
    projectsResult.errors +
    cyclesResult.errors +
    inventoryResult.errors;

  const report: FullMigrationReport = {
    products: productsResult,
    spools: spoolsResult,
    projects: projectsResult,
    cycles: cyclesResult,
    inventory: inventoryResult,
    totalMigrated,
    totalErrors,
  };
  
  console.log('[CloudBridge] FULL migration complete:', report);
  
  return report;
}

/**
 * Migrate local inventory (color_inventory) to cloud material_inventory table
 * One-time migration: upserts by (workspace_id, color, material)
 */
export async function migrateInventoryToCloud(
  workspaceId: string
): Promise<{ created: number; updated: number; errors: number }> {
  if (!workspaceId) {
    return { created: 0, updated: 0, errors: 0 };
  }

  console.log('[CloudBridge] Starting inventory migration for workspace:', workspaceId);

  // Get local inventory
  const localInventory = safeJsonParse<ColorInventoryItem[]>(localStorage.getItem(KEYS.COLOR_INVENTORY)) || [];
  if (localInventory.length === 0) {
    console.log('[CloudBridge] No local inventory to migrate');
    return { created: 0, updated: 0, errors: 0 };
  }

  let created = 0;
  let updated = 0;
  let errors = 0;

  for (const item of localInventory) {
    try {
      const inventoryData: MaterialInventoryInput = {
        color: item.color,
        material: item.material || 'PLA',
        closed_count: item.closedCount || 0,
        closed_spool_size_grams: item.closedSpoolSizeGrams || 1000,
        open_total_grams: item.openTotalGrams || 0,
        open_spool_count: item.openSpoolCount || 0,
        reorder_point_grams: item.reorderPointGrams ?? 2000,
        updated_by: 'migration',
      };

      const result = await upsertMaterialInventory(workspaceId, inventoryData);

      if (result.data) {
        console.log(`[CloudBridge] Upserted inventory: ${item.color}/${item.material}`);
        // We don't know if it was created or updated, count as updated for safety
        updated++;
      } else {
        console.error(`[CloudBridge] Failed to upsert inventory: ${item.color}/${item.material}`);
        errors++;
      }
    } catch (e) {
      console.error(`[CloudBridge] Inventory migration error for ${item.color}/${item.material}:`, e);
      errors++;
    }
  }

  console.log('[CloudBridge] Inventory migration complete:', { created, updated, errors });
  return { created, updated, errors };
}

/**
 * Hydrate local inventory cache from cloud
 * Cloud is source of truth - overwrites local cache
 */
export async function hydrateInventoryFromCloud(workspaceId: string): Promise<ColorInventoryItem[]> {
  if (!workspaceId) {
    return [];
  }

  console.log('[CloudBridge] Hydrating inventory from cloud for workspace:', workspaceId);

  try {
    const cloudInventory = await getMaterialInventory(workspaceId);
    
    // Map cloud format to local format
    const localInventory: ColorInventoryItem[] = cloudInventory.map(item => ({
      id: item.id,
      color: item.color,
      material: item.material,
      closedCount: item.closed_count,
      closedSpoolSizeGrams: item.closed_spool_size_grams,
      openTotalGrams: item.open_total_grams,
      openSpoolCount: item.open_spool_count,
      reorderPointGrams: item.reorder_point_grams ?? 2000,
      updatedAt: item.updated_at,
    }));

    // Update local cache
    localStorage.setItem(KEYS.COLOR_INVENTORY, JSON.stringify(localInventory));
    console.log('[CloudBridge] Hydrated inventory from cloud:', localInventory.length, 'items');

    return localInventory;
  } catch (error) {
    console.error('[CloudBridge] Error hydrating inventory from cloud:', error);
    // Return existing local data as fallback
    return safeJsonParse<ColorInventoryItem[]>(localStorage.getItem(KEYS.COLOR_INVENTORY)) || [];
  }
}
