-- Step 1: Clean up duplicates - keep one per (workspace_id, printer_id, project_id, start_time)
-- Priority: in_progress > scheduled/planned > completed, then by updated_at DESC
WITH ranked_cycles AS (
  SELECT id, 
    ROW_NUMBER() OVER (
      PARTITION BY workspace_id, printer_id, project_id, start_time 
      ORDER BY 
        CASE status
          WHEN 'in_progress' THEN 1
          WHEN 'scheduled' THEN 2
          WHEN 'planned' THEN 3
          ELSE 4
        END,
        updated_at DESC
    ) as rn
  FROM planned_cycles
  WHERE start_time IS NOT NULL
)
DELETE FROM planned_cycles 
WHERE id IN (SELECT id FROM ranked_cycles WHERE rn > 1);

-- Step 2: Mark expired in_progress cycles as completed
UPDATE planned_cycles
SET status = 'completed', updated_at = NOW()
WHERE status = 'in_progress'
  AND end_time IS NOT NULL
  AND end_time < NOW();

-- Step 3: Add unique constraint to prevent future duplicates
CREATE UNIQUE INDEX idx_planned_cycles_unique_schedule 
ON planned_cycles (workspace_id, printer_id, project_id, start_time)
WHERE start_time IS NOT NULL;