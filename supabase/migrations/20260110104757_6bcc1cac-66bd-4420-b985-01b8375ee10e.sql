-- Create atomic publish_plan function that runs in a single transaction
-- This ensures no intermediate state where cloud is empty/partial

CREATE OR REPLACE FUNCTION public.publish_plan(
  p_workspace_id UUID,
  p_user_id UUID,
  p_cycles JSONB,  -- Array of cycle objects
  p_reason TEXT DEFAULT 'manual_replan',
  p_scope TEXT DEFAULT 'from_now'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_version UUID;
  v_deleted_count INT;
  v_created_count INT;
  v_cycle JSONB;
BEGIN
  -- Generate new plan version UUID
  v_plan_version := gen_random_uuid();
  
  -- STEP 1: Delete old planned/scheduled cycles (NOT in_progress, completed, failed)
  -- These are execution states that should be preserved
  DELETE FROM planned_cycles
  WHERE workspace_id = p_workspace_id
    AND status IN ('planned', 'scheduled');
  
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  
  -- STEP 2: Insert new cycles with plan_version
  v_created_count := 0;
  
  FOR v_cycle IN SELECT * FROM jsonb_array_elements(p_cycles)
  LOOP
    INSERT INTO planned_cycles (
      workspace_id,
      project_id,
      printer_id,
      scheduled_date,
      start_time,
      end_time,
      units_planned,
      status,
      preset_id,
      legacy_id,
      plan_version,
      cycle_index
    ) VALUES (
      p_workspace_id,
      (v_cycle->>'project_id')::UUID,
      (v_cycle->>'printer_id')::UUID,
      (v_cycle->>'scheduled_date')::DATE,
      CASE WHEN v_cycle->>'start_time' IS NOT NULL AND v_cycle->>'start_time' != 'null' 
           THEN (v_cycle->>'start_time')::TIMESTAMPTZ ELSE NULL END,
      CASE WHEN v_cycle->>'end_time' IS NOT NULL AND v_cycle->>'end_time' != 'null'
           THEN (v_cycle->>'end_time')::TIMESTAMPTZ ELSE NULL END,
      COALESCE((v_cycle->>'units_planned')::INT, 1),
      COALESCE(v_cycle->>'status', 'scheduled'),
      CASE WHEN v_cycle->>'preset_id' IS NOT NULL AND v_cycle->>'preset_id' != 'null'
           THEN (v_cycle->>'preset_id')::UUID ELSE NULL END,
      v_cycle->>'legacy_id',
      v_plan_version,
      0
    );
    v_created_count := v_created_count + 1;
  END LOOP;
  
  -- STEP 3: Update factory_settings with new active_plan_version
  -- NOTE: Do NOT update plan_version on in_progress/completed cycles - they are execution overlays
  UPDATE factory_settings
  SET 
    active_plan_version = v_plan_version,
    active_plan_created_at = NOW(),
    active_plan_created_by = p_user_id
  WHERE workspace_id = p_workspace_id;
  
  -- STEP 4: Record in plan_history for audit trail
  INSERT INTO plan_history (
    workspace_id,
    plan_version,
    created_by,
    cycle_count,
    reason,
    scope
  ) VALUES (
    p_workspace_id,
    v_plan_version,
    p_user_id,
    v_created_count,
    p_reason,
    p_scope
  );
  
  -- Return result
  RETURN jsonb_build_object(
    'success', true,
    'plan_version', v_plan_version,
    'cycles_created', v_created_count,
    'cycles_deleted', v_deleted_count
  );
  
EXCEPTION WHEN OTHERS THEN
  -- Transaction will automatically rollback
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'plan_version', NULL,
    'cycles_created', 0,
    'cycles_deleted', 0
  );
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.publish_plan TO authenticated;