-- Replace partial indexes with full unique indexes
-- Postgres unique index allows multiple NULLs, so this is safe

DROP INDEX IF EXISTS projects_workspace_legacy_id_unique;
CREATE UNIQUE INDEX projects_workspace_legacy_id_unique
ON projects (workspace_id, legacy_id);

DROP INDEX IF EXISTS planned_cycles_workspace_legacy_id_unique;
CREATE UNIQUE INDEX planned_cycles_workspace_legacy_id_unique
ON planned_cycles (workspace_id, legacy_id);