-- Add physical_plate_capacity column to printers table
-- Default 999 to not affect current behavior (no practical limit)
ALTER TABLE public.printers 
ADD COLUMN IF NOT EXISTS physical_plate_capacity INTEGER NOT NULL DEFAULT 999;

-- Add comment for documentation
COMMENT ON COLUMN public.printers.physical_plate_capacity IS 'Number of physical plates available for this printer. Used to limit consecutive autonomous cycles during night/weekend. Default 999 = unlimited.';