-- Delete duplicate cycles where legacy_id matches another cycle's id
-- This cleans up the duplication created by sync vs edge function
DELETE FROM planned_cycles 
WHERE id IN (
  SELECT pc1.id 
  FROM planned_cycles pc1
  INNER JOIN planned_cycles pc2 ON pc1.legacy_id = pc2.id::text
  WHERE pc1.legacy_id IS NOT NULL
);