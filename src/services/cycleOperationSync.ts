// Cycle Operation Sync Service
// Centralized service for syncing operational cycle changes to cloud
// Separates UI from cloud logic and ensures consistent field mapping

import { supabase } from '@/integrations/supabase/client';
import { getProjectsSync, findProjectById, getPrinters, getPlannedCycles, KEYS, PlannedCycle } from '@/services/storage';
import { isUuid, getCachedWorkspaceId, setCachedWorkspaceId } from '@/services/cloudBridge';
import type { DbPlannedCycle } from '@/services/cloudStorage';

// ============= TYPES =============

export interface CycleOperationResult {
  success: boolean;
  localSaved: boolean;
  cloudSynced: boolean;
  error?: string;
}

// ============= PENDING SYNC HELPERS =============

/**
 * Mark a cycle as pending cloud sync (when sync fails)
 * This prevents hydration from overwriting the local change
 */
export function markCycleAsPendingSync(cycleId: string, error?: string): void {
  const cycles = getPlannedCycles();
  const updated = cycles.map(c => 
    c.id === cycleId 
      ? { ...c, pendingCloudSync: true, lastSyncAttempt: new Date().toISOString(), syncError: error }
      : c
  );
  localStorage.setItem(KEYS.PLANNED_CYCLES, JSON.stringify(updated));
  console.log('[cycleOperationSync] Marked cycle as pendingCloudSync:', cycleId);
}

/**
 * Clear pending sync flag (after successful sync)
 */
export function clearCyclePendingSync(cycleId: string): void {
  const cycles = getPlannedCycles();
  const updated = cycles.map(c => 
    c.id === cycleId 
      ? { ...c, pendingCloudSync: false, syncError: undefined }
      : c
  );
  localStorage.setItem(KEYS.PLANNED_CYCLES, JSON.stringify(updated));
}

/**
 * Get all cycles that need to be synced (for retry queue)
 */
export function getPendingSyncCycles(): PlannedCycle[] {
  return getPlannedCycles().filter(c => c.pendingCloudSync === true);
}

export type OperationType = 'start_print' | 'manual_start' | 'complete' | 'cancel';

export interface CycleOperationPayload {
  cycleId: string;
  projectId: string;
  printerId: string;
  status: 'in_progress' | 'completed' | 'cancelled' | 'planned';
  startTime?: string;
  endTime?: string;
  presetId?: string | null;
  unitsPlanned?: number;
  scheduledDate?: string;
  cycleIndex?: number;
}

// ============= PROJECT ID RESOLUTION =============

/**
 * Resolve a local project ID to a valid cloud UUID
 * Priority: if already UUID → use as is, else check cloudId/cloudUuid fields
 */
export function resolveProjectCloudId(projectId: string): string | null {
  // Already a valid UUID
  if (isUuid(projectId)) {
    return projectId;
  }
  
  // Load projects from localStorage (sync call)
  const projects = getProjectsSync();
  const project = findProjectById(projects, projectId);
  
  if (!project) {
    console.error('[cycleOperationSync] Project not found:', projectId);
    return null;
  }
  
  // Priority: cloudId > cloudUuid > id (if UUID)
  const cloudId = (project as any).cloudId;
  const cloudUuid = (project as any).cloudUuid;
  
  if (cloudId && isUuid(cloudId)) return cloudId;
  if (cloudUuid && isUuid(cloudUuid)) return cloudUuid;
  if (isUuid(project.id)) return project.id;
  
  console.error('[cycleOperationSync] No valid UUID for project:', projectId, { cloudId, cloudUuid });
  return null;
}

// ============= PRINTER ID RESOLUTION =============

/**
 * Resolve a local printer ID to a valid cloud UUID
 * Priority: if already UUID → use as is, else find printer by ID or printer number
 */
export function resolvePrinterCloudId(printerId: string): string | null {
  // Already a valid UUID
  if (isUuid(printerId)) {
    return printerId;
  }
  
  // Load printers from localStorage
  const printers = getPrinters();
  
  // Try exact ID match first
  const exactMatch = printers.find(p => p.id === printerId);
  if (exactMatch && isUuid(exactMatch.id)) {
    return exactMatch.id;
  }
  
  // Try parsing printer-X format (e.g., "printer-10" → 10)
  const match = printerId.match(/^printer-(\d+)$/);
  if (match) {
    const printerNum = parseInt(match[1], 10);
    const byNumber = printers.find(p => p.printerNumber === printerNum);
    if (byNumber && isUuid(byNumber.id)) {
      return byNumber.id;
    }
  }
  
  console.error('[cycleOperationSync] Could not resolve printer UUID for:', printerId);
  return null;
}

// ============= FIELD MAPPING =============

/**
 * Map local cycle fields to cloud database format
 */
function mapLocalToCloudFields(payload: CycleOperationPayload): Partial<DbPlannedCycle> {
  const cloudFields: Partial<DbPlannedCycle> = {
    status: payload.status,
  };
  
  if (payload.startTime !== undefined) {
    cloudFields.start_time = payload.startTime;
  }
  if (payload.endTime !== undefined) {
    cloudFields.end_time = payload.endTime;
  }
  if (payload.presetId !== undefined) {
    cloudFields.preset_id = payload.presetId;
  }
  if (payload.unitsPlanned !== undefined) {
    cloudFields.units_planned = payload.unitsPlanned;
  }
  if (payload.scheduledDate !== undefined) {
    cloudFields.scheduled_date = payload.scheduledDate;
  }
  if (payload.cycleIndex !== undefined) {
    cloudFields.cycle_index = payload.cycleIndex;
  }
  
  return cloudFields;
}

// ============= WORKSPACE FETCH =============

/**
 * Fetch workspace ID from profile (one-time, then cache)
 */
async function fetchAndCacheWorkspaceId(): Promise<string | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.warn('[cycleOperationSync] No authenticated user');
      return null;
    }
    
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('current_workspace_id')
      .eq('user_id', user.id)
      .single();
    
    if (error || !profile?.current_workspace_id) {
      console.error('[cycleOperationSync] Failed to fetch workspace:', error);
      return null;
    }
    
    // Cache for future calls
    setCachedWorkspaceId(profile.current_workspace_id);
    console.log('[cycleOperationSync] Fetched and cached workspaceId:', profile.current_workspace_id);
    
    return profile.current_workspace_id;
  } catch (err) {
    console.error('[cycleOperationSync] Error fetching workspace:', err);
    return null;
  }
}

// ============= MAIN SYNC FUNCTION =============

/**
 * Sync a cycle operation to cloud immediately
 * Handles all the complexity of workspace lookup, field mapping, and error handling
 * Option A: Always syncs to cloud - fetches workspace if not cached
 */
export async function syncCycleOperation(
  type: OperationType,
  payload: CycleOperationPayload
): Promise<CycleOperationResult> {
  console.log('[cycleOperationSync] Starting sync:', type, payload.cycleId);
  
  // Get cached workspace ID, or fetch once if missing
  let workspaceId = getCachedWorkspaceId();
  
  if (!workspaceId) {
    console.log('[cycleOperationSync] No cached workspaceId - fetching from profile...');
    workspaceId = await fetchAndCacheWorkspaceId();
  }
  
  if (!workspaceId) {
    console.error('[cycleOperationSync] Could not get workspaceId - sync failed');
    
    // Dispatch failure event for UI
    window.dispatchEvent(new CustomEvent('cycle-sync-result', {
      detail: { 
        type, 
        cycleId: payload.cycleId, 
        success: true, 
        localSaved: true,
        cloudSynced: false, 
        error: 'לא ניתן לסנכרן - אין חיבור לענן',
        canRetry: true,
        payload, // Include payload for retry
      },
    }));
    
    return {
      success: true,
      localSaved: true,
      cloudSynced: false,
      error: 'לא ניתן לסנכרן - אין חיבור לענן',
    };
  }
  
  return await performCloudSync(type, payload, workspaceId);
}

/**
 * Internal function to perform the actual cloud sync
 */
async function performCloudSync(
  type: OperationType,
  payload: CycleOperationPayload,
  workspaceId: string
): Promise<CycleOperationResult> {
  try {
    // Resolve project ID to cloud UUID
    const projectUuid = resolveProjectCloudId(payload.projectId);
    
    if (!projectUuid) {
      console.error('[cycleOperationSync] Could not resolve project UUID for:', payload.projectId);
      
      window.dispatchEvent(new CustomEvent('cycle-sync-result', {
        detail: { 
          type, 
          cycleId: payload.cycleId, 
          success: true, 
          localSaved: true,
          cloudSynced: false, 
          error: 'לא נמצא UUID לפרויקט',
          canRetry: false,
        },
      }));
      
      return {
        success: true,
        localSaved: true,
        cloudSynced: false,
        error: 'לא נמצא UUID לפרויקט - נשמר מקומית בלבד',
      };
    }
    
    // Resolve printer ID to cloud UUID
    const printerUuid = resolvePrinterCloudId(payload.printerId);
    
    if (!printerUuid) {
      console.error('[cycleOperationSync] Could not resolve printer UUID for:', payload.printerId);
      
      window.dispatchEvent(new CustomEvent('cycle-sync-result', {
        detail: { 
          type, 
          cycleId: payload.cycleId, 
          success: true, 
          localSaved: true,
          cloudSynced: false, 
          error: 'לא נמצא UUID למדפסת',
          canRetry: false,
        },
      }));
      
      return {
        success: true,
        localSaved: true,
        cloudSynced: false,
        error: 'לא נמצא UUID למדפסת - נשמר מקומית בלבד',
      };
    }
    
    // Map fields to cloud format
    const cloudFields = mapLocalToCloudFields(payload);
    
    if (type === 'manual_start') {
      // For new manual cycles, use UPSERT for idempotency (retry-safe)
      const { data, error } = await supabase
        .from('planned_cycles')
        .upsert({
          id: payload.cycleId,
          workspace_id: workspaceId,
          project_id: projectUuid,
          printer_id: printerUuid,
          scheduled_date: payload.scheduledDate || new Date().toISOString().split('T')[0],
          units_planned: payload.unitsPlanned || 1,
          cycle_index: payload.cycleIndex || 0,
          status: payload.status,
          start_time: payload.startTime || null,
          end_time: payload.endTime || null,
          preset_id: payload.presetId || null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'id' })
        .select()
        .single();
      
      if (error) {
        console.error('[cycleOperationSync] Upsert failed:', error);
        
        // Mark cycle as pending sync to protect from hydration overwrite
        markCycleAsPendingSync(payload.cycleId, error.message);
        
        window.dispatchEvent(new CustomEvent('cycle-sync-result', {
          detail: { 
            type, 
            cycleId: payload.cycleId, 
            success: true, 
            localSaved: true,
            cloudSynced: false, 
            error: error.message,
            canRetry: true,
            payload,
          },
        }));
        
        return {
          success: true,
          localSaved: true,
          cloudSynced: false,
          error: `שגיאת סנכרון: ${error.message}`,
        };
      }
      
      // Sync succeeded - clear pending flag
      clearCyclePendingSync(payload.cycleId);
      
      console.log('[cycleOperationSync] Manual cycle synced:', data?.id);
    } else {
      // For updates to existing cycles (start_print, complete, cancel)
      const { data, error } = await supabase
        .from('planned_cycles')
        .update({
          ...cloudFields,
          updated_at: new Date().toISOString(),
        })
        .eq('id', payload.cycleId)
        .eq('workspace_id', workspaceId) // Workspace filter for safety
        .select()
        .single();
      
      if (error) {
        console.error('[cycleOperationSync] Update failed:', error);
        
        // Mark cycle as pending sync to protect from hydration overwrite
        markCycleAsPendingSync(payload.cycleId, error.message);
        
        window.dispatchEvent(new CustomEvent('cycle-sync-result', {
          detail: { 
            type, 
            cycleId: payload.cycleId, 
            success: true, 
            localSaved: true,
            cloudSynced: false, 
            error: error.message,
            canRetry: true,
            payload,
          },
        }));
        
        return {
          success: true,
          localSaved: true,
          cloudSynced: false,
          error: `שגיאת עדכון: ${error.message}`,
        };
      }
      
      // Sync succeeded - clear pending flag
      clearCyclePendingSync(payload.cycleId);
      console.log('[cycleOperationSync] Cycle updated:', data?.id);
    }
    
    // Dispatch success event for UI feedback
    window.dispatchEvent(new CustomEvent('cycle-sync-result', {
      detail: { 
        type, 
        cycleId: payload.cycleId, 
        success: true, 
        localSaved: true,
        cloudSynced: true,
      },
    }));
    
    return {
      success: true,
      localSaved: true,
      cloudSynced: true,
    };
    
  } catch (err) {
    console.error('[cycleOperationSync] Unexpected error:', err);
    
    // Mark cycle as pending sync to protect from hydration overwrite
    markCycleAsPendingSync(payload.cycleId, String(err));
    
    // Dispatch failure event with retry info
    window.dispatchEvent(new CustomEvent('cycle-sync-result', {
      detail: { 
        type, 
        cycleId: payload.cycleId, 
        success: true, 
        localSaved: true,
        cloudSynced: false, 
        error: String(err),
        canRetry: true,
        payload,
      },
    }));
    
    return {
      success: true,
      localSaved: true,
      cloudSynced: false,
      error: `שגיאה לא צפויה: ${err}`,
    };
  }
}
