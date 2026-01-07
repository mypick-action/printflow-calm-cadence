-- Update all existing printers to have physical_plate_capacity = 5
-- Only update printers that still have the old default of 999 (unlimited)
UPDATE public.printers 
SET physical_plate_capacity = 5 
WHERE physical_plate_capacity = 999;

-- Change the default value for new printers from 999 to 5
ALTER TABLE public.printers 
ALTER COLUMN physical_plate_capacity SET DEFAULT 5;