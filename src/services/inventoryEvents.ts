// ============= INVENTORY EVENTS =============
// Event emitter for inventory changes to trigger UI updates
// This ensures material alerts refresh immediately when inventory changes

type InventoryEventCallback = () => void;

const listeners: Set<InventoryEventCallback> = new Set();

/**
 * Subscribe to inventory change events
 * @returns Unsubscribe function
 */
export const subscribeToInventoryChanges = (callback: InventoryEventCallback): (() => void) => {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
};

/**
 * Notify all subscribers that inventory has changed
 * Called from storage.ts when spools are created/updated/deleted
 */
export const notifyInventoryChanged = (): void => {
  listeners.forEach(callback => {
    try {
      callback();
    } catch (error) {
      console.error('[InventoryEvents] Error in callback:', error);
    }
  });
};

/**
 * Get number of active listeners (for debugging)
 */
export const getListenerCount = (): number => listeners.size;
