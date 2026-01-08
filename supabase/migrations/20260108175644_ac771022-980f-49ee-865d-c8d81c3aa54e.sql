-- Mark stale in_progress cycles as completed (end_time passed)
UPDATE planned_cycles
SET 
  status = 'completed',
  updated_at = NOW()
WHERE status = 'in_progress'
  AND end_time < NOW();

-- Delete duplicates: keep only one in_progress per printer
-- (keep the one with the latest updated_at)
DELETE FROM planned_cycles a
USING planned_cycles b
WHERE a.status = 'in_progress'
  AND b.status = 'in_progress'
  AND a.printer_id = b.printer_id
  AND a.workspace_id = b.workspace_id
  AND a.updated_at < b.updated_at;