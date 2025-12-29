-- Add printer capability columns
ALTER TABLE public.printers
ADD COLUMN IF NOT EXISTS has_ams boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS ams_slots integer,
ADD COLUMN IF NOT EXISTS ams_backup_mode boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS ams_multi_color boolean DEFAULT false;

-- Add comment for documentation
COMMENT ON COLUMN public.printers.has_ams IS 'Whether this printer has AMS (Automatic Material System)';
COMMENT ON COLUMN public.printers.ams_slots IS 'Number of AMS slots (typically 4)';
COMMENT ON COLUMN public.printers.ams_backup_mode IS 'AMS backup mode - switch to same color when empty';
COMMENT ON COLUMN public.printers.ams_multi_color IS 'AMS multi-color printing mode';