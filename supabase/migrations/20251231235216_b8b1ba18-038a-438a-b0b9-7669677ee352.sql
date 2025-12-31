-- Add legacy_id column to products table for migration upsert
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS legacy_id TEXT;

-- Create unique index for upsert by legacy_id
CREATE UNIQUE INDEX IF NOT EXISTS products_workspace_legacy_id_unique 
ON products (workspace_id, legacy_id) 
WHERE legacy_id IS NOT NULL;

-- Fix confirm_day_change to allow NULL for rollback
DROP FUNCTION IF EXISTS public.confirm_day_change(UUID, DATE);

CREATE OR REPLACE FUNCTION public.confirm_day_change(
  p_workspace_id UUID,
  p_date DATE DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  UPDATE factory_settings
  SET last_plan_day = p_date
  WHERE workspace_id = p_workspace_id;
  
  RETURN FOUND;
END;
$$;

-- Also add legacy_id to plate_presets for proper migration
ALTER TABLE plate_presets 
ADD COLUMN IF NOT EXISTS legacy_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS plate_presets_workspace_legacy_id_unique 
ON plate_presets (workspace_id, legacy_id) 
WHERE legacy_id IS NOT NULL;