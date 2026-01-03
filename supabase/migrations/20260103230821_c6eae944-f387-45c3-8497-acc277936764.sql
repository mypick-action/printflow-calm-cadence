-- Add lead_time_hours column to factory_settings table for material procurement
ALTER TABLE public.factory_settings 
ADD COLUMN IF NOT EXISTS material_lead_time_hours INTEGER NOT NULL DEFAULT 48;