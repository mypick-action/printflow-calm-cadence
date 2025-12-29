-- =====================================================
-- PrintFlow Multi-Tenant MVP Database Schema
-- =====================================================

-- 1. Create workspaces table (each user gets one workspace)
CREATE TABLE public.workspaces (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_user_id UUID NOT NULL,
  name TEXT NOT NULL DEFAULT 'המפעל שלי',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 2. Create profiles table (for user info)
CREATE TABLE public.profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  email TEXT,
  display_name TEXT,
  current_workspace_id UUID REFERENCES public.workspaces(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 3. Factory settings per workspace
CREATE TABLE public.factory_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  factory_name TEXT NOT NULL DEFAULT 'המפעל שלי',
  weekly_work_hours JSONB NOT NULL DEFAULT '{}',
  transition_minutes INTEGER NOT NULL DEFAULT 10,
  after_hours_behavior TEXT NOT NULL DEFAULT 'NONE',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(workspace_id)
);

-- 4. Products table
CREATE TABLE public.products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  material TEXT NOT NULL DEFAULT 'PLA',
  color TEXT NOT NULL DEFAULT 'black',
  default_grams_per_unit NUMERIC NOT NULL DEFAULT 10,
  default_units_per_plate INTEGER NOT NULL DEFAULT 1,
  default_print_time_hours NUMERIC NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 5. Plate presets table
CREATE TABLE public.plate_presets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  units_per_plate INTEGER NOT NULL DEFAULT 1,
  cycle_hours NUMERIC NOT NULL DEFAULT 1,
  grams_per_unit NUMERIC NOT NULL DEFAULT 10,
  allowed_for_night_cycle BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 6. Printers table
CREATE TABLE public.printers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  model TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  current_preset_id UUID REFERENCES public.plate_presets(id) ON DELETE SET NULL,
  mounted_spool_id UUID,
  can_start_new_cycles_after_hours BOOLEAN NOT NULL DEFAULT false,
  max_spool_weight INTEGER,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 7. Spools (inventory) table
CREATE TABLE public.spools (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  material TEXT NOT NULL DEFAULT 'PLA',
  color TEXT NOT NULL,
  color_hex TEXT,
  weight_grams INTEGER NOT NULL DEFAULT 1000,
  remaining_grams INTEGER NOT NULL DEFAULT 1000,
  cost_per_kg NUMERIC,
  supplier TEXT,
  status TEXT NOT NULL DEFAULT 'available',
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Update printer to reference spools
ALTER TABLE public.printers 
ADD CONSTRAINT printers_mounted_spool_fkey 
FOREIGN KEY (mounted_spool_id) REFERENCES public.spools(id) ON DELETE SET NULL;

-- 8. Projects table
CREATE TABLE public.projects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  preset_id UUID REFERENCES public.plate_presets(id) ON DELETE SET NULL,
  quantity_target INTEGER NOT NULL DEFAULT 1,
  quantity_completed INTEGER NOT NULL DEFAULT 0,
  quantity_failed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  priority TEXT NOT NULL DEFAULT 'normal',
  deadline TIMESTAMP WITH TIME ZONE,
  assigned_printer_id UUID REFERENCES public.printers(id) ON DELETE SET NULL,
  custom_cycle_hours NUMERIC,
  is_recovery_project BOOLEAN NOT NULL DEFAULT false,
  parent_project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 9. Planned cycles table
CREATE TABLE public.planned_cycles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  printer_id UUID NOT NULL REFERENCES public.printers(id) ON DELETE CASCADE,
  preset_id UUID REFERENCES public.plate_presets(id) ON DELETE SET NULL,
  scheduled_date DATE NOT NULL,
  start_time TIMESTAMP WITH TIME ZONE,
  end_time TIMESTAMP WITH TIME ZONE,
  units_planned INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'scheduled',
  cycle_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 10. Cycle logs table (history)
CREATE TABLE public.cycle_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  printer_id UUID REFERENCES public.printers(id) ON DELETE SET NULL,
  preset_id UUID REFERENCES public.plate_presets(id) ON DELETE SET NULL,
  spool_id UUID REFERENCES public.spools(id) ON DELETE SET NULL,
  completed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  units_completed INTEGER NOT NULL DEFAULT 0,
  units_failed INTEGER NOT NULL DEFAULT 0,
  grams_used NUMERIC NOT NULL DEFAULT 0,
  cycle_hours NUMERIC,
  decision TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- =====================================================
-- Enable Row Level Security on all tables
-- =====================================================

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.factory_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plate_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.printers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planned_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cycle_logs ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- Security definer function to get user's workspace
-- =====================================================

CREATE OR REPLACE FUNCTION public.get_user_workspace_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT current_workspace_id FROM public.profiles WHERE user_id = auth.uid()
$$;

-- =====================================================
-- RLS Policies
-- =====================================================

-- Workspaces: owner can do everything
CREATE POLICY "Users can view their own workspaces" ON public.workspaces
  FOR SELECT USING (owner_user_id = auth.uid());

CREATE POLICY "Users can create workspaces" ON public.workspaces
  FOR INSERT WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY "Users can update their own workspaces" ON public.workspaces
  FOR UPDATE USING (owner_user_id = auth.uid());

-- Profiles: users can manage their own profile
CREATE POLICY "Users can view their own profile" ON public.profiles
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can create their own profile" ON public.profiles
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own profile" ON public.profiles
  FOR UPDATE USING (user_id = auth.uid());

-- Factory settings: workspace members only
CREATE POLICY "Users can view their workspace settings" ON public.factory_settings
  FOR SELECT USING (workspace_id = public.get_user_workspace_id());

CREATE POLICY "Users can create workspace settings" ON public.factory_settings
  FOR INSERT WITH CHECK (workspace_id = public.get_user_workspace_id());

CREATE POLICY "Users can update their workspace settings" ON public.factory_settings
  FOR UPDATE USING (workspace_id = public.get_user_workspace_id());

-- Products: workspace members only
CREATE POLICY "Users can view workspace products" ON public.products
  FOR SELECT USING (workspace_id = public.get_user_workspace_id());

CREATE POLICY "Users can create workspace products" ON public.products
  FOR INSERT WITH CHECK (workspace_id = public.get_user_workspace_id());

CREATE POLICY "Users can update workspace products" ON public.products
  FOR UPDATE USING (workspace_id = public.get_user_workspace_id());

CREATE POLICY "Users can delete workspace products" ON public.products
  FOR DELETE USING (workspace_id = public.get_user_workspace_id());

-- Plate presets: workspace members only
CREATE POLICY "Users can view workspace presets" ON public.plate_presets
  FOR SELECT USING (workspace_id = public.get_user_workspace_id());

CREATE POLICY "Users can create workspace presets" ON public.plate_presets
  FOR INSERT WITH CHECK (workspace_id = public.get_user_workspace_id());

CREATE POLICY "Users can update workspace presets" ON public.plate_presets
  FOR UPDATE USING (workspace_id = public.get_user_workspace_id());

CREATE POLICY "Users can delete workspace presets" ON public.plate_presets
  FOR DELETE USING (workspace_id = public.get_user_workspace_id());

-- Printers: workspace members only
CREATE POLICY "Users can view workspace printers" ON public.printers
  FOR SELECT USING (workspace_id = public.get_user_workspace_id());

CREATE POLICY "Users can create workspace printers" ON public.printers
  FOR INSERT WITH CHECK (workspace_id = public.get_user_workspace_id());

CREATE POLICY "Users can update workspace printers" ON public.printers
  FOR UPDATE USING (workspace_id = public.get_user_workspace_id());

CREATE POLICY "Users can delete workspace printers" ON public.printers
  FOR DELETE USING (workspace_id = public.get_user_workspace_id());

-- Spools: workspace members only
CREATE POLICY "Users can view workspace spools" ON public.spools
  FOR SELECT USING (workspace_id = public.get_user_workspace_id());

CREATE POLICY "Users can create workspace spools" ON public.spools
  FOR INSERT WITH CHECK (workspace_id = public.get_user_workspace_id());

CREATE POLICY "Users can update workspace spools" ON public.spools
  FOR UPDATE USING (workspace_id = public.get_user_workspace_id());

CREATE POLICY "Users can delete workspace spools" ON public.spools
  FOR DELETE USING (workspace_id = public.get_user_workspace_id());

-- Projects: workspace members only
CREATE POLICY "Users can view workspace projects" ON public.projects
  FOR SELECT USING (workspace_id = public.get_user_workspace_id());

CREATE POLICY "Users can create workspace projects" ON public.projects
  FOR INSERT WITH CHECK (workspace_id = public.get_user_workspace_id());

CREATE POLICY "Users can update workspace projects" ON public.projects
  FOR UPDATE USING (workspace_id = public.get_user_workspace_id());

CREATE POLICY "Users can delete workspace projects" ON public.projects
  FOR DELETE USING (workspace_id = public.get_user_workspace_id());

-- Planned cycles: workspace members only
CREATE POLICY "Users can view workspace cycles" ON public.planned_cycles
  FOR SELECT USING (workspace_id = public.get_user_workspace_id());

CREATE POLICY "Users can create workspace cycles" ON public.planned_cycles
  FOR INSERT WITH CHECK (workspace_id = public.get_user_workspace_id());

CREATE POLICY "Users can update workspace cycles" ON public.planned_cycles
  FOR UPDATE USING (workspace_id = public.get_user_workspace_id());

CREATE POLICY "Users can delete workspace cycles" ON public.planned_cycles
  FOR DELETE USING (workspace_id = public.get_user_workspace_id());

-- Cycle logs: workspace members only
CREATE POLICY "Users can view workspace logs" ON public.cycle_logs
  FOR SELECT USING (workspace_id = public.get_user_workspace_id());

CREATE POLICY "Users can create workspace logs" ON public.cycle_logs
  FOR INSERT WITH CHECK (workspace_id = public.get_user_workspace_id());

-- =====================================================
-- Trigger to auto-create workspace and profile on signup
-- =====================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_workspace_id UUID;
BEGIN
  -- Create a new workspace for the user
  INSERT INTO public.workspaces (owner_user_id, name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'factory_name', 'המפעל שלי'))
  RETURNING id INTO new_workspace_id;
  
  -- Create a profile with the workspace linked
  INSERT INTO public.profiles (user_id, email, display_name, current_workspace_id)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email),
    new_workspace_id
  );
  
  -- Create default factory settings for the workspace
  INSERT INTO public.factory_settings (workspace_id, factory_name)
  VALUES (new_workspace_id, COALESCE(NEW.raw_user_meta_data->>'factory_name', 'המפעל שלי'));
  
  RETURN NEW;
END;
$$;

-- Trigger on auth.users insert
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =====================================================
-- Function to update updated_at timestamp
-- =====================================================

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Add triggers for updated_at
CREATE TRIGGER update_workspaces_updated_at BEFORE UPDATE ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_factory_settings_updated_at BEFORE UPDATE ON public.factory_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_plate_presets_updated_at BEFORE UPDATE ON public.plate_presets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_printers_updated_at BEFORE UPDATE ON public.printers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_spools_updated_at BEFORE UPDATE ON public.spools FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_planned_cycles_updated_at BEFORE UPDATE ON public.planned_cycles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();