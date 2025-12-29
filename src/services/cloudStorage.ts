// Cloud Storage Service for PrintFlow
// Replaces localStorage with Supabase database queries
// All operations are workspace-scoped via RLS policies

import { supabase } from '@/integrations/supabase/client';

// ============= TYPES =============
// These map to the database tables

export interface DbProduct {
  id: string;
  workspace_id: string;
  name: string;
  material: string;
  color: string;
  default_grams_per_unit: number;
  default_units_per_plate: number;
  default_print_time_hours: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbPlatePreset {
  id: string;
  workspace_id: string;
  product_id: string | null;
  name: string;
  units_per_plate: number;
  cycle_hours: number;
  grams_per_unit: number;
  allowed_for_night_cycle: boolean;
  created_at: string;
  updated_at: string;
}

export interface DbPrinter {
  id: string;
  workspace_id: string;
  name: string;
  model: string | null;
  status: string;
  current_preset_id: string | null;
  mounted_spool_id: string | null;
  can_start_new_cycles_after_hours: boolean;
  max_spool_weight: number | null;
  notes: string | null;
  has_ams: boolean;
  ams_slots: number | null;
  ams_backup_mode: boolean;
  ams_multi_color: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface DbSpool {
  id: string;
  workspace_id: string;
  material: string;
  color: string;
  color_hex: string | null;
  weight_grams: number;
  remaining_grams: number;
  cost_per_kg: number | null;
  supplier: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbProject {
  id: string;
  workspace_id: string;
  name: string;
  product_id: string | null;
  preset_id: string | null;
  quantity_target: number;
  quantity_completed: number;
  quantity_failed: number;
  status: string;
  priority: string;
  deadline: string | null;
  assigned_printer_id: string | null;
  custom_cycle_hours: number | null;
  is_recovery_project: boolean;
  parent_project_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbPlannedCycle {
  id: string;
  workspace_id: string;
  project_id: string;
  printer_id: string;
  preset_id: string | null;
  scheduled_date: string;
  start_time: string | null;
  end_time: string | null;
  units_planned: number;
  status: string;
  cycle_index: number;
  created_at: string;
  updated_at: string;
}

export interface DbCycleLog {
  id: string;
  workspace_id: string;
  project_id: string | null;
  printer_id: string | null;
  preset_id: string | null;
  spool_id: string | null;
  completed_at: string;
  units_completed: number;
  units_failed: number;
  grams_used: number;
  cycle_hours: number | null;
  decision: string | null;
  notes: string | null;
  created_at: string;
}

export interface DbFactorySettings {
  id: string;
  workspace_id: string;
  factory_name: string;
  weekly_work_hours: unknown; // JSONB from database
  transition_minutes: number;
  after_hours_behavior: string;
  created_at: string;
  updated_at: string;
}

// ============= PRODUCTS =============

export const getProducts = async (workspaceId: string): Promise<DbProduct[]> => {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false });
  
  if (error) {
    console.error('Error fetching products:', error);
    return [];
  }
  
  return data || [];
};

export const createProduct = async (
  workspaceId: string,
  product: Omit<DbProduct, 'id' | 'workspace_id' | 'created_at' | 'updated_at'>
): Promise<DbProduct | null> => {
  const { data, error } = await supabase
    .from('products')
    .insert({
      ...product,
      workspace_id: workspaceId,
    })
    .select()
    .single();
  
  if (error) {
    console.error('Error creating product:', error);
    return null;
  }
  
  return data;
};

export const updateProduct = async (id: string, updates: Partial<DbProduct>): Promise<DbProduct | null> => {
  const { data, error } = await supabase
    .from('products')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  
  if (error) {
    console.error('Error updating product:', error);
    return null;
  }
  
  return data;
};

export const deleteProduct = async (id: string): Promise<boolean> => {
  const { error } = await supabase
    .from('products')
    .delete()
    .eq('id', id);
  
  if (error) {
    console.error('Error deleting product:', error);
    return false;
  }
  
  return true;
};

// ============= PLATE PRESETS =============

export const getPlatePresets = async (workspaceId: string, productId?: string): Promise<DbPlatePreset[]> => {
  let query = supabase
    .from('plate_presets')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false });
  
  if (productId) {
    query = query.eq('product_id', productId);
  }
  
  const { data, error } = await query;
  
  if (error) {
    console.error('Error fetching presets:', error);
    return [];
  }
  
  return data || [];
};

export const createPlatePreset = async (
  workspaceId: string,
  preset: Omit<DbPlatePreset, 'id' | 'workspace_id' | 'created_at' | 'updated_at'>
): Promise<DbPlatePreset | null> => {
  const { data, error } = await supabase
    .from('plate_presets')
    .insert({
      ...preset,
      workspace_id: workspaceId,
    })
    .select()
    .single();
  
  if (error) {
    console.error('Error creating preset:', error);
    return null;
  }
  
  return data;
};

// ============= PRINTERS =============

export const getPrinters = async (workspaceId: string): Promise<DbPrinter[]> => {
  const { data, error } = await supabase
    .from('printers')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('display_order', { ascending: true })
    .order('name', { ascending: true });
  
  if (error) {
    console.error('Error fetching printers:', error);
    return [];
  }
  
  return (data || []) as DbPrinter[];
};

export const createPrinter = async (
  workspaceId: string,
  printer: Partial<DbPrinter> & { name: string }
): Promise<DbPrinter | null> => {
  const { data, error } = await supabase
    .from('printers')
    .insert({
      name: printer.name,
      model: printer.model || null,
      status: printer.status || 'active',
      current_preset_id: printer.current_preset_id || null,
      mounted_spool_id: printer.mounted_spool_id || null,
      can_start_new_cycles_after_hours: printer.can_start_new_cycles_after_hours || false,
      max_spool_weight: printer.max_spool_weight || null,
      notes: printer.notes || null,
      has_ams: printer.has_ams || false,
      ams_slots: printer.ams_slots || null,
      ams_backup_mode: printer.ams_backup_mode || false,
      ams_multi_color: printer.ams_multi_color || false,
      workspace_id: workspaceId,
    })
    .select()
    .single();
  
  if (error) {
    console.error('Error creating printer:', error);
    return null;
  }
  
  return data as DbPrinter;
};

export const updatePrinter = async (id: string, updates: Partial<DbPrinter>): Promise<DbPrinter | null> => {
  const { data, error } = await supabase
    .from('printers')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  
  if (error) {
    console.error('Error updating printer:', error);
    return null;
  }
  
  return data as DbPrinter;
};

export const deletePrinter = async (id: string): Promise<boolean> => {
  const { error } = await supabase
    .from('printers')
    .delete()
    .eq('id', id);
  
  if (error) {
    console.error('Error deleting printer:', error);
    return false;
  }
  
  return true;
};

export const deleteAllPrinters = async (workspaceId: string): Promise<boolean> => {
  const { error } = await supabase
    .from('printers')
    .delete()
    .eq('workspace_id', workspaceId);
  
  if (error) {
    console.error('Error deleting all printers:', error);
    return false;
  }
  
  return true;
};

export const updatePrintersOrder = async (
  printerOrders: { id: string; display_order: number }[]
): Promise<boolean> => {
  try {
    // Update each printer's display_order
    const promises = printerOrders.map(({ id, display_order }) =>
      supabase
        .from('printers')
        .update({ display_order })
        .eq('id', id)
    );
    
    await Promise.all(promises);
    return true;
  } catch (error) {
    console.error('Error updating printers order:', error);
    return false;
  }
};

// ============= SPOOLS (INVENTORY) =============

export const getSpools = async (workspaceId: string): Promise<DbSpool[]> => {
  const { data, error } = await supabase
    .from('spools')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false });
  
  if (error) {
    console.error('Error fetching spools:', error);
    return [];
  }
  
  return data || [];
};

export const createSpool = async (
  workspaceId: string,
  spool: Omit<DbSpool, 'id' | 'workspace_id' | 'created_at' | 'updated_at'>
): Promise<DbSpool | null> => {
  const { data, error } = await supabase
    .from('spools')
    .insert({
      ...spool,
      workspace_id: workspaceId,
    })
    .select()
    .single();
  
  if (error) {
    console.error('Error creating spool:', error);
    return null;
  }
  
  return data;
};

export const updateSpool = async (id: string, updates: Partial<DbSpool>): Promise<DbSpool | null> => {
  const { data, error } = await supabase
    .from('spools')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  
  if (error) {
    console.error('Error updating spool:', error);
    return null;
  }
  
  return data;
};

export const deleteSpool = async (id: string): Promise<boolean> => {
  const { error } = await supabase
    .from('spools')
    .delete()
    .eq('id', id);
  
  if (error) {
    console.error('Error deleting spool:', error);
    return false;
  }
  
  return true;
};

// ============= PROJECTS =============

export const getProjects = async (workspaceId: string): Promise<DbProject[]> => {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false });
  
  if (error) {
    console.error('Error fetching projects:', error);
    return [];
  }
  
  return data || [];
};

export const createProject = async (
  workspaceId: string,
  project: Omit<DbProject, 'id' | 'workspace_id' | 'created_at' | 'updated_at'>
): Promise<DbProject | null> => {
  const { data, error } = await supabase
    .from('projects')
    .insert({
      ...project,
      workspace_id: workspaceId,
    })
    .select()
    .single();
  
  if (error) {
    console.error('Error creating project:', error);
    return null;
  }
  
  return data;
};

export const updateProject = async (id: string, updates: Partial<DbProject>): Promise<DbProject | null> => {
  const { data, error } = await supabase
    .from('projects')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  
  if (error) {
    console.error('Error updating project:', error);
    return null;
  }
  
  return data;
};

export const deleteProject = async (id: string): Promise<boolean> => {
  const { error } = await supabase
    .from('projects')
    .delete()
    .eq('id', id);
  
  if (error) {
    console.error('Error deleting project:', error);
    return false;
  }
  
  return true;
};

// ============= PLANNED CYCLES =============

export const getPlannedCycles = async (workspaceId: string): Promise<DbPlannedCycle[]> => {
  const { data, error } = await supabase
    .from('planned_cycles')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('scheduled_date', { ascending: true });
  
  if (error) {
    console.error('Error fetching planned cycles:', error);
    return [];
  }
  
  return data || [];
};

export const createPlannedCycle = async (
  workspaceId: string,
  cycle: Omit<DbPlannedCycle, 'id' | 'workspace_id' | 'created_at' | 'updated_at'>
): Promise<DbPlannedCycle | null> => {
  const { data, error } = await supabase
    .from('planned_cycles')
    .insert({
      ...cycle,
      workspace_id: workspaceId,
    })
    .select()
    .single();
  
  if (error) {
    console.error('Error creating planned cycle:', error);
    return null;
  }
  
  return data;
};

export const deletePlannedCycles = async (workspaceId: string, projectId?: string): Promise<boolean> => {
  let query = supabase.from('planned_cycles').delete().eq('workspace_id', workspaceId);
  
  if (projectId) {
    query = query.eq('project_id', projectId);
  }
  
  const { error } = await query;
  
  if (error) {
    console.error('Error deleting planned cycles:', error);
    return false;
  }
  
  return true;
};

// ============= CYCLE LOGS =============

export const getCycleLogs = async (workspaceId: string): Promise<DbCycleLog[]> => {
  const { data, error } = await supabase
    .from('cycle_logs')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('completed_at', { ascending: false });
  
  if (error) {
    console.error('Error fetching cycle logs:', error);
    return [];
  }
  
  return data || [];
};

export const createCycleLog = async (
  workspaceId: string,
  log: Omit<DbCycleLog, 'id' | 'workspace_id' | 'created_at'>
): Promise<DbCycleLog | null> => {
  const { data, error } = await supabase
    .from('cycle_logs')
    .insert({
      ...log,
      workspace_id: workspaceId,
    })
    .select()
    .single();
  
  if (error) {
    console.error('Error creating cycle log:', error);
    return null;
  }
  
  return data;
};

// ============= FACTORY SETTINGS =============

export const getFactorySettings = async (workspaceId: string): Promise<DbFactorySettings | null> => {
  const { data, error } = await supabase
    .from('factory_settings')
    .select('*')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  
  if (error) {
    console.error('Error fetching factory settings:', error);
    return null;
  }
  
  if (!data) return null;
  
  return {
    ...data,
    weekly_work_hours: data.weekly_work_hours as unknown,
  } as DbFactorySettings;
};

export const updateFactorySettings = async (
  workspaceId: string,
  updates: {
    factory_name?: string;
    weekly_work_hours?: Record<string, unknown>;
    transition_minutes?: number;
    after_hours_behavior?: string;
  }
): Promise<DbFactorySettings | null> => {
  const { data, error } = await supabase
    .from('factory_settings')
    .update(updates as any)
    .eq('workspace_id', workspaceId)
    .select()
    .single();
  
  if (error) {
    console.error('Error updating factory settings:', error);
    return null;
  }
  
  return {
    ...data,
    weekly_work_hours: data.weekly_work_hours as unknown,
  } as DbFactorySettings;
};

// ============= WORKSPACE INFO =============

export const getCurrentWorkspace = async (workspaceId: string) => {
  const { data, error } = await supabase
    .from('workspaces')
    .select('*')
    .eq('id', workspaceId)
    .single();
  
  if (error) {
    console.error('Error fetching workspace:', error);
    return null;
  }
  
  return data;
};

// ============= CHECK IF WORKSPACE HAS DATA =============

export const checkWorkspaceHasData = async (workspaceId: string): Promise<boolean> => {
  const [products, printers, projects] = await Promise.all([
    getProducts(workspaceId),
    getPrinters(workspaceId),
    getProjects(workspaceId),
  ]);
  
  return products.length > 0 || printers.length > 0 || projects.length > 0;
};

// ============= ONBOARDING: Save factory settings and printers =============

export interface OnboardingCloudData {
  factoryName?: string;
  weeklySchedule: Record<string, unknown>;
  afterHoursBehavior: string;
  transitionMinutes: number;
  printers: Array<{
    name: string;
    hasAMS: boolean;
    amsSlots?: number;
    amsBackupMode?: boolean;
    amsMultiColor?: boolean;
    canStartNewCyclesAfterHours?: boolean;
  }>;
}

export const saveOnboardingToCloud = async (workspaceId: string, data: OnboardingCloudData): Promise<boolean> => {
  try {
    // 1. Update factory settings
    const settingsResult = await updateFactorySettings(workspaceId, {
      factory_name: data.factoryName,
      weekly_work_hours: data.weeklySchedule,
      after_hours_behavior: data.afterHoursBehavior,
      transition_minutes: data.transitionMinutes,
    });
    
    if (!settingsResult) {
      console.error('Failed to update factory settings');
      return false;
    }
    
    // 2. Delete existing printers to avoid duplicates
    await deleteAllPrinters(workspaceId);
    
    // 3. Create printers with full AMS data
    for (const printer of data.printers) {
      const printerResult = await createPrinter(workspaceId, {
        name: printer.name,
        status: 'active',
        can_start_new_cycles_after_hours: printer.canStartNewCyclesAfterHours || false,
        has_ams: printer.hasAMS,
        ams_slots: printer.amsSlots || null,
        ams_backup_mode: printer.amsBackupMode || false,
        ams_multi_color: printer.amsMultiColor || false,
      });
      
      if (!printerResult) {
        console.error('Failed to create printer:', printer.name);
        // Continue with other printers
      }
    }
    
    console.log('[CloudStorage] Onboarding saved successfully');
    return true;
  } catch (error) {
    console.error('Error saving onboarding to cloud:', error);
    return false;
  }
};

// ============= CHECK ONBOARDING STATUS =============
// Checks if factory_settings has valid weekly_work_hours AND printers exist

export const isOnboardingCompleteCloud = async (workspaceId: string): Promise<boolean> => {
  const [printers, settings] = await Promise.all([
    getPrinters(workspaceId),
    getFactorySettings(workspaceId),
  ]);
  
  // Must have at least one printer
  if (printers.length === 0) {
    return false;
  }
  
  // Must have factory settings with configured work hours and behavior
  if (!settings) {
    return false;
  }
  
  // Check if weekly_work_hours has been configured (not empty default)
  const workHours = settings.weekly_work_hours as Record<string, unknown> | null;
  const hasWorkHours = workHours && Object.keys(workHours).length > 0;
  
  // Check if after_hours_behavior has been set (not the default 'NONE')
  const hasBehavior = settings.after_hours_behavior && settings.after_hours_behavior !== 'NONE';
  
  return hasWorkHours || hasBehavior;
};
