-- Add color column to projects table for display purposes
ALTER TABLE projects ADD COLUMN IF NOT EXISTS color TEXT;