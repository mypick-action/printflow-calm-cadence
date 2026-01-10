-- Step 1: Add plan versioning columns to factory_settings
ALTER TABLE public.factory_settings 
ADD COLUMN IF NOT EXISTS active_plan_version UUID DEFAULT NULL,
ADD COLUMN IF NOT EXISTS active_plan_created_at TIMESTAMPTZ DEFAULT NULL,
ADD COLUMN IF NOT EXISTS active_plan_created_by UUID DEFAULT NULL;

-- Step 2: Add plan_version to planned_cycles
ALTER TABLE public.planned_cycles 
ADD COLUMN IF NOT EXISTS plan_version UUID DEFAULT NULL;

-- Step 3: Create index for efficient plan version queries
CREATE INDEX IF NOT EXISTS idx_planned_cycles_plan_version 
ON public.planned_cycles(workspace_id, plan_version);

-- Step 4: Create plan_history table for audit trail
CREATE TABLE IF NOT EXISTS public.plan_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  plan_version UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID DEFAULT NULL,
  cycle_count INT DEFAULT 0,
  reason TEXT,
  scope TEXT DEFAULT 'from_now',
  UNIQUE(workspace_id, plan_version)
);

-- Step 5: Enable RLS on plan_history
ALTER TABLE public.plan_history ENABLE ROW LEVEL SECURITY;

-- Step 6: RLS policies for plan_history
CREATE POLICY "Users can view workspace plan history" 
ON public.plan_history 
FOR SELECT 
USING (workspace_id = get_user_workspace_id());

CREATE POLICY "Users can create workspace plan history" 
ON public.plan_history 
FOR INSERT 
WITH CHECK (workspace_id = get_user_workspace_id());

-- Step 7: Add realtime for factory_settings (for plan version broadcasts)
ALTER PUBLICATION supabase_realtime ADD TABLE public.factory_settings;