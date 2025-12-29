-- Add display_order column to printers table for custom ordering
ALTER TABLE public.printers 
ADD COLUMN display_order integer DEFAULT 0;

-- Set initial display_order based on creation date
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY workspace_id ORDER BY created_at) as rn
  FROM public.printers
)
UPDATE public.printers 
SET display_order = ordered.rn
FROM ordered
WHERE printers.id = ordered.id;