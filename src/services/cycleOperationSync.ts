// Cycle Operation Sync Service
// Centralized service for syncing operational cycle changes to cloud
// Separates UI from cloud logic and ensures consistent field mapping

import { supabase } from '@/integrations/supabase/client';
import { getProjectsSync } from '@/services/storage';
import { isUuid, getCachedWorkspaceId } from '@/services/cloudBridge';
import type { DbPlannedCycle } from '@/services/cloudStorage';

// ============= TYPES =============

export interface CycleOperationResult {
  success: boolean;
  localSaved: boolean;
  cloudSynced: boolean;
  error?: string;
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
  const project = projects.find(p => p.id === projectId);
  
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

// ============= MAIN SYNC FUNCTION =============

/**
 * Sync a cycle operation to cloud immediately
 * Handles all the complexity of workspace lookup, field mapping, and error handling
 */
export async function syncCycleOperation(
  type: OperationType,
  payload: CycleOperationPayload
): Promise<CycleOperationResult> {
  console.log('[cycleOperationSync] Starting sync:', type, payload.cycleId);
  
  // Get cached workspace ID - NO fallback fetch, just return cloudSynced=false
  const workspaceId = getCachedWorkspaceId();
  
  if (!workspaceId) {
    console.warn('[cycleOperationSync] No cached workspaceId - skipping cloud sync');
    
    // Dispatch failure event for UI
    window.dispatchEvent(new CustomEvent('cycle-sync-result', {
      detail: { 
        type, 
        cycleId: payload.cycleId, 
        success: true, 
        localSaved: true,
        cloudSynced: false, 
        error: 'לא סונכרן - אין workspace בזיכרון',
        canRetry: true,
        payload, // Include payload for retry
      },
    }));
    
    return {
      success: true,
      localSaved: true,
      cloudSynced: false,
      error: 'לא סונכרן - אין workspace בזיכרון',
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
          printer_id: payload.printerId,
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
