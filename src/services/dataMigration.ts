// ============= DATA MIGRATION SERVICE =============
// Handles backward-compatible migrations for PrintFlow data model changes
// Version 2.0: Enforces spool selection from inventory, removes FilamentEstimate

import { scheduleAutoReplan } from './autoReplan';
import { normalizeColor } from './colorNormalization';

// Migration version key
const MIGRATION_VERSION_KEY = 'printflow_migration_version';
const MIGRATION_LOG_KEY = 'printflow_migration_log';
const CURRENT_MIGRATION_VERSION = 2;

export interface MigrationLogEntry {
  version: number;
  timestamp: string;
  summary: string;
  details: {
    printersProcessed: number;
    printersMigrated: number;
    printersNeedingSpool: string[];
    spoolsMatched: number;
    warnings: string[];
  };
}

export interface MigrationResult {
  success: boolean;
  migrated: boolean;
  version: number;
  summary: string;
  details: MigrationLogEntry['details'];
}

/**
 * Get current migration version
 */
export const getMigrationVersion = (): number => {
  try {
    const version = localStorage.getItem(MIGRATION_VERSION_KEY);
    return version ? parseInt(version, 10) : 0;
  } catch {
    return 0;
  }
};

/**
 * Get migration log entries
 */
export const getMigrationLog = (): MigrationLogEntry[] => {
  try {
    const log = localStorage.getItem(MIGRATION_LOG_KEY);
    return log ? JSON.parse(log) : [];
  } catch {
    return [];
  }
};

/**
 * Add migration log entry
 */
const addMigrationLogEntry = (entry: MigrationLogEntry): void => {
  const log = getMigrationLog();
  log.push(entry);
  localStorage.setItem(MIGRATION_LOG_KEY, JSON.stringify(log));
  localStorage.setItem(MIGRATION_VERSION_KEY, entry.version.toString());
};

/**
 * Run all pending migrations
 * This is called on app startup
 */
export const runMigrations = (): MigrationResult => {
  const currentVersion = getMigrationVersion();
  
  console.log(`[Migration] Current version: ${currentVersion}, Target version: ${CURRENT_MIGRATION_VERSION}`);
  
  if (currentVersion >= CURRENT_MIGRATION_VERSION) {
    return {
      success: true,
      migrated: false,
      version: currentVersion,
      summary: 'No migrations needed',
      details: {
        printersProcessed: 0,
        printersMigrated: 0,
        printersNeedingSpool: [],
        spoolsMatched: 0,
        warnings: [],
      },
    };
  }
  
  // Run migration from version 1 to 2 (or 0 to 2)
  if (currentVersion < 2) {
    return migrateToVersion2();
  }
  
  return {
    success: true,
    migrated: false,
    version: currentVersion,
    summary: 'Unknown migration state',
    details: {
      printersProcessed: 0,
      printersMigrated: 0,
      printersNeedingSpool: [],
      spoolsMatched: 0,
      warnings: [],
    },
  };
};

/**
 * Migration to Version 2:
 * - Remove FilamentEstimate-based logic
 * - Enforce mountedSpoolId as required for "ready" state
 * - Migrate mountedColor without mountedSpoolId to needs_spool state
 * - Match existing mounted colors to inventory spools where possible
 */
const migrateToVersion2 = (): MigrationResult => {
  console.log('[Migration] Starting migration to version 2...');
  
  const details: MigrationLogEntry['details'] = {
    printersProcessed: 0,
    printersMigrated: 0,
    printersNeedingSpool: [],
    spoolsMatched: 0,
    warnings: [],
  };
  
  try {
    // Get current data
    const printersRaw = localStorage.getItem('printflow_printers');
    const spoolsRaw = localStorage.getItem('printflow_spools');
    
    if (!printersRaw) {
      console.log('[Migration] No printers data found, skipping migration');
      addMigrationLogEntry({
        version: 2,
        timestamp: new Date().toISOString(),
        summary: 'No printers to migrate',
        details,
      });
      return {
        success: true,
        migrated: false,
        version: 2,
        summary: 'No printers to migrate',
        details,
      };
    }
    
    const printers = JSON.parse(printersRaw) as any[];
    const spools = spoolsRaw ? JSON.parse(spoolsRaw) as any[] : [];
    
    details.printersProcessed = printers.length;
    
    // Process each printer
    const migratedPrinters = printers.map(printer => {
      const migrated = { ...printer };
      let wasMigrated = false;
      
      // Handle non-AMS printers
      if (!printer.hasAMS) {
        // Check if printer has mountedColor but no mountedSpoolId
        if (printer.mountedColor && !printer.mountedSpoolId) {
          console.log(`[Migration] Printer ${printer.name}: has mountedColor \"${printer.mountedColor}\" without spoolId`);
          
          // Try to find a matching spool in inventory
          const matchingSpool = spools.find(s => 
            normalizeColor(s.color) === normalizeColor(printer.mountedColor) &&
            s.state !== 'empty' &&
            s.gramsRemainingEst > 0 &&
            !s.assignedPrinterId // Not already assigned
          );
          
          if (matchingSpool) {
            console.log(`[Migration] Found matching spool ${matchingSpool.id} for printer ${printer.name}`);
            migrated.mountedSpoolId = matchingSpool.id;
            
            // Also update the spool to be assigned to this printer
            const spoolIndex = spools.findIndex(s => s.id === matchingSpool.id);
            if (spoolIndex >= 0) {
              spools[spoolIndex] = {
                ...spools[spoolIndex],
                location: 'printer',
                assignedPrinterId: printer.id,
              };
            }
            
            details.spoolsMatched++;
            wasMigrated = true;
          } else {
            console.log(`[Migration] No matching spool found for printer ${printer.name}, marking as needs_spool`);
            details.printersNeedingSpool.push(printer.name);
            // Keep mountedColor for display, but clear mountedSpoolId to indicate needs setup
            migrated.mountedSpoolId = null;
            wasMigrated = true;
          }
          
          // Remove deprecated mountedEstimate field
          delete migrated.mountedEstimate;
        }
        
        // Clean up mountedEstimate if it exists
        if ('mountedEstimate' in migrated) {
          delete migrated.mountedEstimate;
          wasMigrated = true;
        }
      } else {
        // Handle AMS printers
        if (printer.amsSlotStates && Array.isArray(printer.amsSlotStates)) {
          const migratedSlots = printer.amsSlotStates.map((slot: any) => {
            const migratedSlot = { ...slot };
            
            // Remove estimate field
            if ('estimate' in migratedSlot) {
              delete migratedSlot.estimate;
              wasMigrated = true;
            }
            
            // If slot has color but no spoolId, try to match
            if (slot.color && !slot.spoolId) {
              const matchingSpool = spools.find(s =>
                s.color?.toLowerCase() === slot.color?.toLowerCase() &&
                s.state !== 'empty' &&
                s.gramsRemainingEst > 0 &&
                !s.assignedPrinterId
              );
              
              if (matchingSpool) {
                migratedSlot.spoolId = matchingSpool.id;
                const spoolIndex = spools.findIndex(s => s.id === matchingSpool.id);
                if (spoolIndex >= 0) {
                  spools[spoolIndex] = {
                    ...spools[spoolIndex],
                    location: 'ams',
                    assignedPrinterId: printer.id,
                    amsSlotIndex: slot.slotIndex,
                  };
                }
                details.spoolsMatched++;
                wasMigrated = true;
              }
            }
            
            return migratedSlot;
          });
          
          migrated.amsSlotStates = migratedSlots;
        }
      }
      
      if (wasMigrated) {
        details.printersMigrated++;
      }
      
      return migrated;
    });
    
    // Save migrated data
    localStorage.setItem('printflow_printers', JSON.stringify(migratedPrinters));
    if (spools.length > 0) {
      localStorage.setItem('printflow_spools', JSON.stringify(spools));
    }
    
    // Create summary
    const summary = details.printersMigrated > 0
      ? `Migrated ${details.printersMigrated} printers. ${details.spoolsMatched} spools matched. ${details.printersNeedingSpool.length} printers need spool selection.`
      : 'No printers needed migration';
    
    console.log(`[Migration] Complete: ${summary}`);
    
    // Log migration
    addMigrationLogEntry({
      version: 2,
      timestamp: new Date().toISOString(),
      summary,
      details,
    });
    
    // Trigger replan if any changes were made
    if (details.printersMigrated > 0) {
      scheduleAutoReplan('data_migration');
    }
    
    return {
      success: true,
      migrated: details.printersMigrated > 0,
      version: 2,
      summary,
      details,
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Migration] Error during migration:', errorMessage);
    
    details.warnings.push(`Migration error: ${errorMessage}`);
    
    // Still mark as migrated to prevent infinite loops, but log the error
    addMigrationLogEntry({
      version: 2,
      timestamp: new Date().toISOString(),
      summary: `Migration failed: ${errorMessage}`,
      details,
    });
    
    return {
      success: false,
      migrated: false,
      version: 2,
      summary: `Migration failed: ${errorMessage}`,
      details,
    };
  }
};

/**
 * Check if there are printers that need spool selection
 */
export const getPrintersNeedingSpoolSetup = (): string[] => {
  try {
    const printersRaw = localStorage.getItem('printflow_printers');
    if (!printersRaw) return [];
    
    const printers = JSON.parse(printersRaw) as any[];
    const needsSetup: string[] = [];
    
    for (const printer of printers) {
      if (printer.status !== 'active') continue;
      
      if (!printer.hasAMS) {
        // Non-AMS: needs spool if mountedColor exists but no mountedSpoolId
        if (printer.mountedColor && !printer.mountedSpoolId) {
          needsSetup.push(printer.name || printer.id);
        }
      } else {
        // AMS: check if any slot has color but no spoolId
        if (printer.amsSlotStates && Array.isArray(printer.amsSlotStates)) {
          for (const slot of printer.amsSlotStates) {
            if (slot.color && !slot.spoolId) {
              needsSetup.push(`${printer.name || printer.id} (Slot ${slot.slotIndex + 1})`);
            }
          }
        }
      }
    }
    
    return needsSetup;
  } catch {
    return [];
  }
};
