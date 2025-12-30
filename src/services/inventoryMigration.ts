// ============= INVENTORY MIGRATION =============
// Migration function for Material Tracking v3
// Runs once on app init to initialize missing fields

import {
  getColorInventory,
  getPrinters,
  updatePrinter,
  getPrintersHoldingColor,
} from './storage';
import { normalizeColor } from './colorNormalization';

const MIGRATION_FLAG_KEY = 'printflow_inventory_migration_v3';

/**
 * Check if migration has already been run
 */
export const isInventoryMigrationComplete = (): boolean => {
  try {
    return localStorage.getItem(MIGRATION_FLAG_KEY) === 'true';
  } catch {
    return false;
  }
};

/**
 * Mark migration as complete
 */
const markMigrationComplete = (): void => {
  localStorage.setItem(MIGRATION_FLAG_KEY, 'true');
};

/**
 * Migrate inventory data to v3 format
 * 
 * Conservative rules (don't invent data):
 * 
 * For ColorInventoryItem:
 * - If openSpoolCount is missing:
 *   - If openTotalGrams == 0 => openSpoolCount = 0
 *   - Else => openSpoolCount = max(printersHoldingColor, 1)
 * 
 * For Printer:
 * - If mountedColor exists but mountState is missing => mountState = 'idle'
 * - Don't invent loadedGramsEstimate
 * 
 * @returns object with migration stats
 */
export const migrateInventoryData = (): {
  migrated: boolean;
  colorItemsUpdated: number;
  printersUpdated: number;
} => {
  // Skip if already migrated
  if (isInventoryMigrationComplete()) {
    console.log('[InventoryMigration] Already complete, skipping');
    return { migrated: false, colorItemsUpdated: 0, printersUpdated: 0 };
  }

  console.log('[InventoryMigration] Starting v3 migration...');
  
  let colorItemsUpdated = 0;
  let printersUpdated = 0;

  // Migrate ColorInventory items
  const items = getColorInventory();
  const updatedItems = items.map(item => {
    // Check if openSpoolCount needs initialization
    if (item.openSpoolCount === undefined || item.openSpoolCount === null) {
      let newCount: number;
      
      if (item.openTotalGrams === 0) {
        // No open grams means no open spools
        newCount = 0;
      } else {
        // Has open grams - at minimum count printers holding this color, or 1
        const { total: printersHolding } = getPrintersHoldingColor(item.color);
        newCount = Math.max(printersHolding, 1);
      }
      
      colorItemsUpdated++;
      console.log(`[InventoryMigration] ${item.color}/${item.material}: openSpoolCount = ${newCount}`);
      
      return {
        ...item,
        openSpoolCount: newCount,
        updatedAt: new Date().toISOString(),
      };
    }
    
    return item;
  });
  
  // Save updated inventory if any changes
  if (colorItemsUpdated > 0) {
    localStorage.setItem('printflow_color_inventory', JSON.stringify(updatedItems));
  }

  // Migrate Printers
  const printers = getPrinters();
  for (const printer of printers) {
    // If printer has mountedColor but no mountState, set to idle
    if (printer.mountedColor && !printer.mountState) {
      updatePrinter(printer.id, { mountState: 'idle' });
      printersUpdated++;
      console.log(`[InventoryMigration] Printer ${printer.name}: mountState = 'idle'`);
    }
  }

  // Mark migration complete
  markMigrationComplete();
  
  console.log(`[InventoryMigration] Complete: ${colorItemsUpdated} color items, ${printersUpdated} printers updated`);
  
  return {
    migrated: true,
    colorItemsUpdated,
    printersUpdated,
  };
};

/**
 * Reset migration flag (for testing)
 */
export const resetInventoryMigration = (): void => {
  localStorage.removeItem(MIGRATION_FLAG_KEY);
};
