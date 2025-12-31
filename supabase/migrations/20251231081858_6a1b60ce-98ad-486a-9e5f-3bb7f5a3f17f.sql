-- Add legacy_id column to projects table for local-first sync
ALTER TABLE projects ADD COLUMN legacy_id text;

-- Create unique constraint per workspace (allows multiple workspaces to have same legacy_id)
CREATE UNIQUE INDEX projects_workspace_legacy_id_unique 
ON projects (workspace_id, legacy_id) 
WHERE legacy_id IS NOT NULL;

-- Add legacy_id column to planned_cycles table for local-first sync
ALTER TABLE planned_cycles ADD COLUMN legacy_id text;

-- Create unique constraint per workspace for planned_cycles
CREATE UNIQUE INDEX planned_cycles_workspace_legacy_id_unique 
ON planned_cycles (workspace_id, legacy_id) 
WHERE legacy_id IS NOT NULL;

-- Comment for documentation
COMMENT ON COLUMN projects.legacy_id IS 'Original local ID from localStorage migration';
COMMENT ON COLUMN planned_cycles.legacy_id IS 'Original local ID from localStorage migration';