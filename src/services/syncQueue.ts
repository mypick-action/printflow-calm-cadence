// Sync Queue Service for PrintFlow
// Handles offline-first sync with queue coalescing
// CREATE+UPDATE => CREATE with latest data, DELETE removes prior items

import * as cloudStorage from '@/services/cloudStorage';
import { toast } from 'sonner';

const SYNC_QUEUE_KEY = 'printflow_sync_queue';
const MAX_RETRIES = 5;

export type SyncAction = 'create' | 'update' | 'delete';
export type SyncEntityType = 'project'; // Extend later: 'product' | 'cycle'

export interface SyncItem {
  id: string;
  action: SyncAction;
  entityType: SyncEntityType;
  entityId: string; // The ID of the project/product/etc
  data: unknown; // The full entity data for create/update
  timestamp: string;
  retries: number;
}

function generateQueueId(): string {
  return `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Get current queue from localStorage
export function getQueue(): SyncItem[] {
  try {
    const raw = localStorage.getItem(SYNC_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

// Save queue to localStorage
function saveQueue(queue: SyncItem[]): void {
  localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
}

// Coalesce logic: Merge operations for the same entity
function coalesceQueue(queue: SyncItem[], newItem: SyncItem): SyncItem[] {
  const { entityType, entityId, action, data } = newItem;
  
  // Find existing items for same entity
  const existingIdx = queue.findIndex(
    item => item.entityType === entityType && item.entityId === entityId
  );
  
  if (existingIdx === -1) {
    // No existing item - just add
    return [...queue, newItem];
  }
  
  const existing = queue[existingIdx];
  const newQueue = [...queue];
  
  // DELETE always wins - remove all prior operations for this entity
  if (action === 'delete') {
    newQueue.splice(existingIdx, 1);
    return [...newQueue, newItem];
  }
  
  // CREATE + UPDATE => CREATE with updated data
  if (existing.action === 'create' && action === 'update') {
    newQueue[existingIdx] = {
      ...existing,
      data: { ...existing.data as object, ...data as object },
      timestamp: newItem.timestamp,
    };
    return newQueue;
  }
  
  // UPDATE + UPDATE => UPDATE with merged data
  if (existing.action === 'update' && action === 'update') {
    newQueue[existingIdx] = {
      ...existing,
      data: { ...existing.data as object, ...data as object },
      timestamp: newItem.timestamp,
    };
    return newQueue;
  }
  
  // Any other case: replace with new item
  newQueue[existingIdx] = newItem;
  return newQueue;
}

// Add operation to sync queue with coalescing
export function addToSyncQueue(
  action: SyncAction,
  entityType: SyncEntityType,
  entityId: string,
  data: unknown
): void {
  const queue = getQueue();
  
  const newItem: SyncItem = {
    id: generateQueueId(),
    action,
    entityType,
    entityId,
    data,
    timestamp: new Date().toISOString(),
    retries: 0,
  };
  
  const coalescedQueue = coalesceQueue(queue, newItem);
  saveQueue(coalescedQueue);
  
  console.log('[SyncQueue] Added to queue:', action, entityType, entityId);
}

// Remove item from queue by ID
function removeFromQueue(itemId: string): void {
  const queue = getQueue();
  saveQueue(queue.filter(item => item.id !== itemId));
}

// Process a single sync item
async function syncItem(item: SyncItem, workspaceId: string): Promise<boolean> {
  const { action, entityType, entityId, data } = item;
  
  if (entityType !== 'project') {
    console.warn('[SyncQueue] Unknown entity type:', entityType);
    return false;
  }
  
  try {
    switch (action) {
      case 'create': {
        const result = await cloudStorage.createProjectWithId(workspaceId, data as never);
        return result !== null;
      }
      case 'update': {
        const result = await cloudStorage.updateProject(entityId, data as never);
        return result !== null;
      }
      case 'delete': {
        return await cloudStorage.deleteProject(entityId);
      }
      default:
        return false;
    }
  } catch (e) {
    console.error('[SyncQueue] Error syncing item:', e);
    return false;
  }
}

// Process all pending items in queue
export async function processSyncQueue(workspaceId: string): Promise<{
  processed: number;
  failed: number;
  remaining: number;
}> {
  const queue = getQueue();
  if (queue.length === 0) {
    return { processed: 0, failed: 0, remaining: 0 };
  }
  
  console.log('[SyncQueue] Processing queue, items:', queue.length);
  
  let processed = 0;
  let failed = 0;
  
  for (const item of queue) {
    const success = await syncItem(item, workspaceId);
    
    if (success) {
      removeFromQueue(item.id);
      processed++;
    } else {
      // Update retry count
      item.retries++;
      
      if (item.retries >= MAX_RETRIES) {
        // Max retries reached - notify user and keep in queue
        console.error('[SyncQueue] Max retries reached for item:', item.id);
        failed++;
      }
      
      // Update the item in queue with new retry count
      const currentQueue = getQueue();
      const idx = currentQueue.findIndex(i => i.id === item.id);
      if (idx !== -1) {
        currentQueue[idx] = item;
        saveQueue(currentQueue);
      }
    }
  }
  
  const remaining = getQueue().length;
  
  if (processed > 0) {
    console.log('[SyncQueue] Processed:', processed, 'items');
  }
  
  if (failed > 0) {
    toast.error(`${failed} פעולות לא הצליחו להסתנכרן לאחר ${MAX_RETRIES} נסיונות`);
  }
  
  return { processed, failed, remaining };
}

// Get queue status for UI
export function getQueueStatus(): {
  pending: number;
  hasFailedItems: boolean;
} {
  const queue = getQueue();
  return {
    pending: queue.length,
    hasFailedItems: queue.some(item => item.retries >= MAX_RETRIES),
  };
}

// Clear the entire queue (for testing/reset)
export function clearSyncQueue(): void {
  localStorage.removeItem(SYNC_QUEUE_KEY);
}

// Start background sync processor
let syncInterval: ReturnType<typeof setInterval> | null = null;

export function startSyncProcessor(getWorkspaceId: () => string | null): void {
  if (syncInterval) return;
  
  const process = async () => {
    const workspaceId = getWorkspaceId();
    if (!workspaceId) return;
    
    const queue = getQueue();
    if (queue.length === 0) return;
    
    await processSyncQueue(workspaceId);
  };
  
  // Process every 60 seconds
  syncInterval = setInterval(process, 60_000);
  
  // Also process when coming back online
  window.addEventListener('online', process);
  
  console.log('[SyncQueue] Background processor started');
}

export function stopSyncProcessor(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}
