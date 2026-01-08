-- Drop the problematic unique index that prevents multiple cycles with same start_time
-- This allows manual cycles to be created without conflicting with auto-planned cycles
DROP INDEX IF EXISTS idx_planned_cycles_unique_schedule;