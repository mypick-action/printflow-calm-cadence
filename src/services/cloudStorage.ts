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

export const getProducts = async (): Promise<DbProduct[]> => {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('created_at', { ascending: false });
  
  if (error) {
    console.error('Error fetching products:', error);
    return [];
  }
  
  return data || [];
};

export const createProduct = async (product: Omit<DbProduct, 'id' | 'workspace_id' | 'created_at' | 'updated_at'>): Promise<DbProduct | null> => {
  // Get current workspace from profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('current_workspace_id')
    .single();
  
  if (!profile?.current_workspace_id) {
    console.error('No workspace found');
    return null;
  }
  
  const { data, error } = await supabase
    .from('products')
    .insert({
      ...product,
      workspace_id: profile.current_workspace_id,
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

export const getPlatePresets = async (productId?: string): Promise<DbPlatePreset[]> => {
  let query = supabase
    .from('plate_presets')
    .select('*')
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

export const createPlatePreset = async (preset: Omit<DbPlatePreset, 'id' | 'workspace_id' | 'created_at' | 'updated_at'>): Promise<DbPlatePreset | null> => {
  const { data: profile } = await supabase
    .from('profiles')
    .select('current_workspace_id')
    .single();
  
  if (!profile?.current_workspace_id) return null;
  
  const { data, error } = await supabase
    .from('plate_presets')
    .insert({
      ...preset,
      workspace_id: profile.current_workspace_id,
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

export const getPrinters = async (): Promise<DbPrinter[]> => {
  const { data, error } = await supabase
    .from('printers')
    .select('*')
    .order('name', { ascending: true });
  
  if (error) {
    console.error('Error fetching printers:', error);
    return [];
  }
  
  return data || [];
};

export const createPrinter = async (printer: Omit<DbPrinter, 'id' | 'workspace_id' | 'created_at' | 'updated_at'>): Promise<DbPrinter | null> => {
  const { data: profile } = await supabase
    .from('profiles')
    .select('current_workspace_id')
    .single();
  
  if (!profile?.current_workspace_id) return null;
  
  const { data, error } = await supabase
    .from('printers')
    .insert({
      ...printer,
      workspace_id: profile.current_workspace_id,
    })
    .select()
    .single();
  
  if (error) {
    console.error('Error creating printer:', error);
    return null;
  }
  
  return data;
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
  
  return data;
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

// ============= SPOOLS (INVENTORY) =============

export const getSpools = async (): Promise<DbSpool[]> => {
  const { data, error } = await supabase
    .from('spools')
    .select('*')
    .order('created_at', { ascending: false });
  
  if (error) {
    console.error('Error fetching spools:', error);
    return [];
  }
  
  return data || [];
};

export const createSpool = async (spool: Omit<DbSpool, 'id' | 'workspace_id' | 'created_at' | 'updated_at'>): Promise<DbSpool | null> => {
  const { data: profile } = await supabase
    .from('profiles')
    .select('current_workspace_id')
    .single();
  
  if (!profile?.current_workspace_id) return null;
  
  const { data, error } = await supabase
    .from('spools')
    .insert({
      ...spool,
      workspace_id: profile.current_workspace_id,
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

export const getProjects = async (): Promise<DbProject[]> => {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .order('created_at', { ascending: false });
  
  if (error) {
    console.error('Error fetching projects:', error);
    return [];
  }
  
  return data || [];
};

export const createProject = async (project: Omit<DbProject, 'id' | 'workspace_id' | 'created_at' | 'updated_at'>): Promise<DbProject | null> => {
  const { data: profile } = await supabase
    .from('profiles')
    .select('current_workspace_id')
    .single();
  
  if (!profile?.current_workspace_id) return null;
  
  const { data, error } = await supabase
    .from('projects')
    .insert({
      ...project,
      workspace_id: profile.current_workspace_id,
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

export const getPlannedCycles = async (): Promise<DbPlannedCycle[]> => {
  const { data, error } = await supabase
    .from('planned_cycles')
    .select('*')
    .order('scheduled_date', { ascending: true });
  
  if (error) {
    console.error('Error fetching planned cycles:', error);
    return [];
  }
  
  return data || [];
};

export const createPlannedCycle = async (cycle: Omit<DbPlannedCycle, 'id' | 'workspace_id' | 'created_at' | 'updated_at'>): Promise<DbPlannedCycle | null> => {
  const { data: profile } = await supabase
    .from('profiles')
    .select('current_workspace_id')
    .single();
  
  if (!profile?.current_workspace_id) return null;
  
  const { data, error } = await supabase
    .from('planned_cycles')
    .insert({
      ...cycle,
      workspace_id: profile.current_workspace_id,
    })
    .select()
    .single();
  
  if (error) {
    console.error('Error creating planned cycle:', error);
    return null;
  }
  
  return data;
};

export const deletePlannedCycles = async (projectId?: string): Promise<boolean> => {
  let query = supabase.from('planned_cycles').delete();
  
  if (projectId) {
    query = query.eq('project_id', projectId);
  } else {
    // Delete all - need a condition that matches all rows
    query = query.neq('id', '00000000-0000-0000-0000-000000000000');
  }
  
  const { error } = await query;
  
  if (error) {
    console.error('Error deleting planned cycles:', error);
    return false;
  }
  
  return true;
};

// ============= CYCLE LOGS =============

export const getCycleLogs = async (): Promise<DbCycleLog[]> => {
  const { data, error } = await supabase
    .from('cycle_logs')
    .select('*')
    .order('completed_at', { ascending: false });
  
  if (error) {
    console.error('Error fetching cycle logs:', error);
    return [];
  }
  
  return data || [];
};

export const createCycleLog = async (log: Omit<DbCycleLog, 'id' | 'workspace_id' | 'created_at'>): Promise<DbCycleLog | null> => {
  const { data: profile } = await supabase
    .from('profiles')
    .select('current_workspace_id')
    .single();
  
  if (!profile?.current_workspace_id) return null;
  
  const { data, error } = await supabase
    .from('cycle_logs')
    .insert({
      ...log,
      workspace_id: profile.current_workspace_id,
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

export const getFactorySettings = async (): Promise<DbFactorySettings | null> => {
  const { data, error } = await supabase
    .from('factory_settings')
    .select('*')
    .maybeSingle();
  
  if (error) {
    console.error('Error fetching factory settings:', error);
    return null;
  }
  
  if (!data) return null;
  
  // Cast the data to our type
  return {
    ...data,
    weekly_work_hours: data.weekly_work_hours as unknown,
  } as DbFactorySettings;
};

export const updateFactorySettings = async (updates: Partial<Omit<DbFactorySettings, 'weekly_work_hours'>> & { weekly_work_hours?: Record<string, unknown> }): Promise<DbFactorySettings | null> => {
  const { data: profile } = await supabase
    .from('profiles')
    .select('current_workspace_id')
    .single();
  
  if (!profile?.current_workspace_id) return null;
  
  const { data, error } = await supabase
    .from('factory_settings')
    .update(updates as any)
    .eq('workspace_id', profile.current_workspace_id)
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

export const getCurrentWorkspace = async () => {
  const { data: profile } = await supabase
    .from('profiles')
    .select('current_workspace_id')
    .single();
  
  if (!profile?.current_workspace_id) return null;
  
  const { data, error } = await supabase
    .from('workspaces')
    .select('*')
    .eq('id', profile.current_workspace_id)
    .single();
  
  if (error) {
    console.error('Error fetching workspace:', error);
    return null;
  }
  
  return data;
};

// ============= CHECK IF WORKSPACE HAS DATA =============

export const checkWorkspaceHasData = async (): Promise<boolean> => {
  const [products, printers, projects] = await Promise.all([
    getProducts(),
    getPrinters(),
    getProjects(),
  ]);
  
  return products.length > 0 || printers.length > 0 || projects.length > 0;
};
