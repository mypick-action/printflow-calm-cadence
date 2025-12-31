-- Add last_plan_day to factory_settings for day-change detection
ALTER TABLE factory_settings 
ADD COLUMN IF NOT EXISTS last_plan_day DATE;

COMMENT ON COLUMN factory_settings.last_plan_day IS 
'Last business day planning was calculated (YYYY-MM-DD, Asia/Jerusalem). Used for atomic day-change detection.';

-- Create atomic function for day-change lock
-- Returns: 'acquired' if lock acquired and day updated, 'already_current' if same day, 'lost' if another device won
CREATE OR REPLACE FUNCTION public.try_acquire_day_change_lock(
  p_workspace_id UUID,
  p_today_date DATE
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_current_day DATE;
  v_rows_affected INTEGER;
BEGIN
  -- Get current last_plan_day
  SELECT last_plan_day INTO v_current_day
  FROM factory_settings
  WHERE workspace_id = p_workspace_id;
  
  -- If same day, no action needed
  IF v_current_day = p_today_date THEN
    RETURN 'already_current';
  END IF;
  
  -- Attempt atomic update with WHERE clause to ensure we win the race
  -- Only succeeds if last_plan_day is still the old value (or null)
  UPDATE factory_settings
  SET last_plan_day = p_today_date
  WHERE workspace_id = p_workspace_id
    AND (last_plan_day IS NULL OR last_plan_day = v_current_day);
  
  GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
  
  IF v_rows_affected = 1 THEN
    RETURN 'acquired';
  ELSE
    -- Another device already updated
    RETURN 'lost';
  END IF;
END;
$$;

-- Create function to update last_plan_day after successful replan
-- This is called ONLY after replan succeeds
CREATE OR REPLACE FUNCTION public.confirm_day_change(
  p_workspace_id UUID,
  p_date DATE
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