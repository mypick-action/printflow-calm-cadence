// Realtime Sync Service
// Subscribes to Supabase realtime changes and updates local cache

import { supabase } from '@/integrations/supabase/client';
import { RealtimeChannel } from '@supabase/supabase-js';
import { KEYS } from './storage';
import { hydrateProductsFromCloud } from './productService';

// ============= TYPES =============

export type SyncStatus = 'synced' | 'pending' | 'offline' | 'error';

export interface SyncState {
  status: SyncStatus;
  pendingCount: number;
  lastSyncAt: string | null;
  error: string | null;
}

type TableName = 'products' | 'projects' | 'planned_cycles' | 'plate_presets' | 'material_inventory' | 'printers';

type ChangeCallback = (table: TableName, event: 'INSERT' | 'UPDATE' | 'DELETE', payload: unknown) => void;

// ============= STATE =============

let channel: RealtimeChannel | null = null;
let listeners: Set<ChangeCallback> = new Set();
let syncState: SyncState = {
  status: 'synced',
  pendingCount: 0,
  lastSyncAt: null,
  error: null,
};

// ============= SYNC STATE MANAGEMENT =============

export const getSyncState = (): SyncState => ({ ...syncState });

export const updateSyncState = (updates: Partial<SyncState>): void => {
  syncState = { ...syncState, ...updates };
  // Notify any sync state listeners
  window.dispatchEvent(new CustomEvent('sync-state-change', { detail: syncState }));
};

// ============= REALTIME SUBSCRIPTION =============

/**
 * Subscribe to workspace changes for realtime sync
 * @param workspaceId The workspace to subscribe to
 * @returns Unsubscribe function
 */
export const subscribeToWorkspaceChanges = (workspaceId: string): (() => void) => {
  // Clean up existing subscription
  if (channel) {
    supabase.removeChannel(channel);
  }

  const tables: TableName[] = ['products', 'projects', 'planned_cycles', 'plate_presets', 'material_inventory', 'printers'];

  channel = supabase.channel(`workspace:${workspaceId}`);

  // Subscribe to each table
  for (const table of tables) {
    channel = channel.on(
      'postgres_changes',
      { 
        event: '*', 
        schema: 'public', 
        table,
        filter: `workspace_id=eq.${workspaceId}`
      },
      (payload) => {
        console.log(`[RealtimeSync] ${table} ${payload.eventType}:`, payload);
        
        // Update last sync time
        updateSyncState({ 
          lastSyncAt: new Date().toISOString(),
          status: 'synced',
          error: null,
        });
        
        // Notify listeners
        const event = payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE';
        listeners.forEach(callback => {
          try {
            callback(table, event, payload.new || payload.old);
          } catch (error) {
            console.error('[RealtimeSync] Listener error:', error);
          }
        });
        
        // Auto-refresh local cache for products
        if (table === 'products' || table === 'plate_presets') {
          hydrateProductsFromCloud(workspaceId).catch(console.error);
        }
      }
    );
  }

  // Subscribe and handle status
  channel.subscribe((status) => {
    console.log('[RealtimeSync] Channel status:', status);
    
    if (status === 'SUBSCRIBED') {
      updateSyncState({ status: 'synced', error: null });
    } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
      updateSyncState({ status: 'offline', error: 'Connection lost' });
    }
  });

  // Return unsubscribe function
  return () => {
    if (channel) {
      supabase.removeChannel(channel);
      channel = null;
    }
  };
};

/**
 * Add a listener for realtime changes
 */
export const addChangeListener = (callback: ChangeCallback): (() => void) => {
  listeners.add(callback);
  return () => listeners.delete(callback);
};

/**
 * Check online status and update sync state
 */
export const checkOnlineStatus = (): boolean => {
  const isOnline = navigator.onLine;
  if (!isOnline) {
    updateSyncState({ status: 'offline', error: 'No internet connection' });
  }
  return isOnline;
};

// Listen for online/offline events
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    updateSyncState({ status: 'synced', error: null });
  });
  
  window.addEventListener('offline', () => {
    updateSyncState({ status: 'offline', error: 'No internet connection' });
  });
}

/**
 * Mark operations as pending (for sync queue integration)
 */
export const incrementPending = (): void => {
  updateSyncState({ 
    pendingCount: syncState.pendingCount + 1,
    status: syncState.pendingCount === 0 ? 'pending' : syncState.status,
  });
};

export const decrementPending = (): void => {
  const newCount = Math.max(0, syncState.pendingCount - 1);
  updateSyncState({ 
    pendingCount: newCount,
    status: newCount === 0 ? 'synced' : 'pending',
  });
};
