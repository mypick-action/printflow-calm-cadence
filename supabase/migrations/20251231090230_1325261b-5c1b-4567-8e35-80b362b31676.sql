-- Create material_inventory table for cloud-first inventory sync
-- Matches ColorInventoryItem structure from localStorage
CREATE TABLE public.material_inventory (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  color TEXT NOT NULL,
  material TEXT NOT NULL DEFAULT 'PLA',
  closed_count INTEGER NOT NULL DEFAULT 0,
  closed_spool_size_grams INTEGER NOT NULL DEFAULT 1000,
  open_total_grams INTEGER NOT NULL DEFAULT 0,
  open_spool_count INTEGER NOT NULL DEFAULT 0,
  reorder_point_grams INTEGER DEFAULT 2000,
  updated_by TEXT, -- For tracing who made the change
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, color, material)
);

-- Enable Row Level Security
ALTER TABLE public.material_inventory ENABLE ROW LEVEL SECURITY;

-- Create policies for workspace access (using get_user_workspace_id function)
CREATE POLICY "material_inventory_select" 
ON public.material_inventory 
FOR SELECT 
USING (workspace_id = get_user_workspace_id());

CREATE POLICY "material_inventory_insert" 
ON public.material_inventory 
FOR INSERT 
WITH CHECK (workspace_id = get_user_workspace_id());

CREATE POLICY "material_inventory_update" 
ON public.material_inventory 
FOR UPDATE 
USING (workspace_id = get_user_workspace_id());

CREATE POLICY "material_inventory_delete" 
ON public.material_inventory 
FOR DELETE 
USING (workspace_id = get_user_workspace_id());

-- Create trigger for automatic updated_at
CREATE TRIGGER update_material_inventory_updated_at
BEFORE UPDATE ON public.material_inventory
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();