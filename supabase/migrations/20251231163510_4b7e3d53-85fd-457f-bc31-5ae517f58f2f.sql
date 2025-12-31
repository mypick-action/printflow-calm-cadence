-- Add include_in_planning column to projects table
ALTER TABLE public.projects 
ADD COLUMN include_in_planning boolean NOT NULL DEFAULT true;