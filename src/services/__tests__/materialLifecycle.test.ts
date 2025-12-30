// ============= MATERIAL LIFECYCLE TESTS =============
// Tests for Material Tracking v3 invariants and planning blocking rules

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] || null,
  };
})();

Object.defineProperty(global, 'localStorage', { value: localStorageMock });

// Mock window for event dispatching
global.window = {
  ...global.window,
  dispatchEvent: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
} as any;

// Import after mocks are set up
import {
  loadSpoolOnPrinter,
  unloadSpoolFromPrinter,
  finishPrinterJob,
  getColorInventory,
  getColorInventoryItem,
  getPrinters,
  getPrinter,
  getPlannedCycles,
  getShelfOpenSpoolsFree,
  getPrintersHoldingColor,
} from '../storage';

import {
  getReservedGramsByColor,
  getGramsAvailableForAllocation,
  isPrinterSpoolAvailable,
  canAllocateMaterial,
} from '../materialAdapter';

// Helper to set up test data
const setupTestData = (options: {
  colorInventory?: any[];
  printers?: any[];
  plannedCycles?: any[];
}) => {
  localStorage.clear();
  
  if (options.colorInventory) {
    localStorage.setItem('printflow_color_inventory', JSON.stringify(options.colorInventory));
  }
  if (options.printers) {
    localStorage.setItem('printflow_printers', JSON.stringify(options.printers));
  }
  if (options.plannedCycles) {
    localStorage.setItem('printflow_planned_cycles', JSON.stringify(options.plannedCycles));
  }
};

describe('Material Lifecycle - Invariant Tests', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // Test 1: load(closed) creates new open spool
  it('load(closed) creates new open spool in world', () => {
    setupTestData({
      colorInventory: [{
        id: 'PLA:Black',
        color: 'Black',
        material: 'PLA',
        closedCount: 2,
        closedSpoolSizeGrams: 1000,
        openTotalGrams: 0,
        openSpoolCount: 0,
      }],
      printers: [{
        id: 'printer-1',
        printerNumber: 1,
        name: 'Printer 1',
        active: true,
        status: 'active',
        hasAMS: false,
      }],
    });
    
    const result = loadSpoolOnPrinter('printer-1', 'Black', 1000, 'closed');
    
    expect(result).toBe(true);
    
    const item = getColorInventoryItem('Black', 'PLA');
    expect(item?.closedCount).toBe(1); // Was 2, now 1
    expect(item?.openSpoolCount).toBe(1); // Was 0, now 1
    expect(item?.openTotalGrams).toBe(1000); // Was 0, now 1000
    
    const printer = getPrinter('printer-1');
    expect(printer?.mountedColor).toBe('Black');
    expect(printer?.mountState).toBe('idle');
  });

  // Test 2: load(open) requires shelf free
  it('load(open) fails when shelfOpenSpoolsFree = 0', () => {
    setupTestData({
      colorInventory: [{
        id: 'PLA:Black',
        color: 'Black',
        material: 'PLA',
        closedCount: 0,
        closedSpoolSizeGrams: 1000,
        openTotalGrams: 1000,
        openSpoolCount: 2, // 2 open spools in world
      }],
      printers: [
        {
          id: 'printer-1',
          printerNumber: 1,
          name: 'Printer 1',
          active: true,
          status: 'active',
          hasAMS: false,
          mountedColor: 'Black', // Already has Black
        },
        {
          id: 'printer-2',
          printerNumber: 2,
          name: 'Printer 2',
          active: true,
          status: 'active',
          hasAMS: false,
          mountedColor: 'Black', // Already has Black
        },
        {
          id: 'printer-3',
          printerNumber: 3,
          name: 'Printer 3',
          active: true,
          status: 'active',
          hasAMS: false,
          // No color - wants to load
        },
      ],
    });
    
    // Both open spools are on printers, shelf is empty
    const shelfFree = getShelfOpenSpoolsFree('Black', 'PLA');
    expect(shelfFree).toBe(0); // 2 open - 2 on printers = 0
    
    // Trying to load open should fail
    const result = loadSpoolOnPrinter('printer-3', 'Black', 500, 'open');
    expect(result).toBe(false);
  });

  // Test 3: load(open) succeeds when shelf has spools
  it('load(open) succeeds when shelfOpenSpoolsFree > 0, counts unchanged', () => {
    setupTestData({
      colorInventory: [{
        id: 'PLA:Black',
        color: 'Black',
        material: 'PLA',
        closedCount: 0,
        closedSpoolSizeGrams: 1000,
        openTotalGrams: 1500,
        openSpoolCount: 3, // 3 open spools in world
      }],
      printers: [
        {
          id: 'printer-1',
          printerNumber: 1,
          name: 'Printer 1',
          active: true,
          status: 'active',
          hasAMS: false,
          mountedColor: 'Black', // 1 printer has Black
        },
        {
          id: 'printer-2',
          printerNumber: 2,
          name: 'Printer 2',
          active: true,
          status: 'active',
          hasAMS: false,
          // Empty - wants to load
        },
      ],
    });
    
    // 3 open - 1 on printer = 2 on shelf
    const shelfFreeBefore = getShelfOpenSpoolsFree('Black', 'PLA');
    expect(shelfFreeBefore).toBe(2);
    
    const itemBefore = getColorInventoryItem('Black', 'PLA');
    const countBefore = itemBefore?.openSpoolCount;
    const gramsBefore = itemBefore?.openTotalGrams;
    
    const result = loadSpoolOnPrinter('printer-2', 'Black', 500, 'open');
    expect(result).toBe(true);
    
    // Counts should NOT change for open source
    const itemAfter = getColorInventoryItem('Black', 'PLA');
    expect(itemAfter?.openSpoolCount).toBe(countBefore); // Unchanged
    expect(itemAfter?.openTotalGrams).toBe(gramsBefore); // Unchanged
  });

  // Test 4: finishPrinterJob deducts grams only
  it('finishPrinterJob deducts grams only, openSpoolCount unchanged', () => {
    setupTestData({
      colorInventory: [{
        id: 'PLA:Black',
        color: 'Black',
        material: 'PLA',
        closedCount: 2,
        closedSpoolSizeGrams: 1000,
        openTotalGrams: 1000,
        openSpoolCount: 2,
      }],
      printers: [{
        id: 'printer-1',
        printerNumber: 1,
        name: 'Printer 1',
        active: true,
        status: 'active',
        hasAMS: false,
        mountedColor: 'Black',
        loadedGramsEstimate: 800,
        mountState: 'in_use',
      }],
    });
    
    finishPrinterJob('printer-1', 50);
    
    const item = getColorInventoryItem('Black', 'PLA');
    expect(item?.openTotalGrams).toBe(950); // 1000 - 50
    expect(item?.openSpoolCount).toBe(2); // Unchanged
    
    const printer = getPrinter('printer-1');
    expect(printer?.mountState).toBe('idle');
    expect(printer?.loadedGramsEstimate).toBe(750); // 800 - 50
  });

  // Test 5: unload does not change world counts
  it('unload does not change world counts, only clears printer', () => {
    setupTestData({
      colorInventory: [{
        id: 'PLA:Black',
        color: 'Black',
        material: 'PLA',
        closedCount: 2,
        closedSpoolSizeGrams: 1000,
        openTotalGrams: 800,
        openSpoolCount: 2,
      }],
      printers: [{
        id: 'printer-1',
        printerNumber: 1,
        name: 'Printer 1',
        active: true,
        status: 'active',
        hasAMS: false,
        mountedColor: 'Black',
        loadedGramsEstimate: 600,
        mountState: 'idle',
      }],
    });
    
    const itemBefore = getColorInventoryItem('Black', 'PLA');
    const countBefore = itemBefore?.openSpoolCount;
    const gramsBefore = itemBefore?.openTotalGrams;
    
    const result = unloadSpoolFromPrinter('printer-1');
    expect(result).toBe(true);
    
    // Counts unchanged
    const itemAfter = getColorInventoryItem('Black', 'PLA');
    expect(itemAfter?.openSpoolCount).toBe(countBefore);
    expect(itemAfter?.openTotalGrams).toBe(gramsBefore);
    
    // Printer cleared
    const printer = getPrinter('printer-1');
    expect(printer?.mountedColor).toBeUndefined();
    expect(printer?.mountState).toBeUndefined();
  });

  // Test 6: shelfOpenSpoolsFree math
  it('shelfOpenSpoolsFree = openSpoolCount - printersHoldingColor', () => {
    setupTestData({
      colorInventory: [{
        id: 'PLA:Black',
        color: 'Black',
        material: 'PLA',
        closedCount: 0,
        closedSpoolSizeGrams: 1000,
        openTotalGrams: 2000,
        openSpoolCount: 4,
      }],
      printers: [
        { id: 'p1', printerNumber: 1, name: 'P1', active: true, status: 'active', hasAMS: false, mountedColor: 'Black' },
        { id: 'p2', printerNumber: 2, name: 'P2', active: true, status: 'active', hasAMS: false, mountedColor: 'Black' },
        { id: 'p3', printerNumber: 3, name: 'P3', active: true, status: 'active', hasAMS: false, mountedColor: 'Black' },
        { id: 'p4', printerNumber: 4, name: 'P4', active: true, status: 'active', hasAMS: false, mountedColor: 'Black' },
      ],
    });
    
    // 4 open - 4 on printers = 0 on shelf
    expect(getShelfOpenSpoolsFree('Black', 'PLA')).toBe(0);
    expect(getPrintersHoldingColor('Black').total).toBe(4);
  });
});

describe('Material Lifecycle - Planning Blocking Tests', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // Test 7: in_progress always blocks
  it('in_progress cycle always blocks printer availability', () => {
    const farFuture = new Date();
    farFuture.setDate(farFuture.getDate() + 30); // 30 days in future
    
    setupTestData({
      colorInventory: [{
        id: 'PLA:Black',
        color: 'Black',
        material: 'PLA',
        closedCount: 0,
        closedSpoolSizeGrams: 1000,
        openTotalGrams: 500,
        openSpoolCount: 1,
      }],
      printers: [{
        id: 'printer-1',
        printerNumber: 1,
        name: 'Printer 1',
        active: true,
        status: 'active',
        hasAMS: false,
        mountedColor: 'Black',
        mountState: 'idle', // Even idle state...
      }],
      plannedCycles: [{
        id: 'cycle-1',
        projectId: 'proj-1',
        printerId: 'printer-1',
        status: 'in_progress', // ...with in_progress cycle
        startTime: farFuture.toISOString(), // Far in future - should still block
        endTime: farFuture.toISOString(),
        gramsPlanned: 100,
        requiredColor: 'Black',
        unitsPlanned: 5,
        plateType: 'full',
        shift: 'day',
        readinessState: 'ready',
      }],
    });
    
    // in_progress ALWAYS blocks, regardless of time
    expect(isPrinterSpoolAvailable('printer-1', 24)).toBe(false);
  });

  // Test 8: planned blocks only within horizon
  it('planned cycle blocks only within horizon', () => {
    const in12Hours = new Date();
    in12Hours.setHours(in12Hours.getHours() + 12);
    
    const in48Hours = new Date();
    in48Hours.setHours(in48Hours.getHours() + 48);
    
    setupTestData({
      colorInventory: [{
        id: 'PLA:Black',
        color: 'Black',
        material: 'PLA',
        closedCount: 0,
        closedSpoolSizeGrams: 1000,
        openTotalGrams: 500,
        openSpoolCount: 1,
      }],
      printers: [
        {
          id: 'printer-1',
          printerNumber: 1,
          name: 'Printer 1',
          active: true,
          status: 'active',
          hasAMS: false,
          mountedColor: 'Black',
          mountState: 'idle',
        },
        {
          id: 'printer-2',
          printerNumber: 2,
          name: 'Printer 2',
          active: true,
          status: 'active',
          hasAMS: false,
          mountedColor: 'Black',
          mountState: 'idle',
        },
      ],
      plannedCycles: [
        {
          id: 'cycle-1',
          projectId: 'proj-1',
          printerId: 'printer-1',
          status: 'planned',
          startTime: in12Hours.toISOString(), // Within 24h horizon
          endTime: in12Hours.toISOString(),
          gramsPlanned: 100,
          requiredColor: 'Black',
          unitsPlanned: 5,
          plateType: 'full',
          shift: 'day',
          readinessState: 'ready',
        },
        {
          id: 'cycle-2',
          projectId: 'proj-1',
          printerId: 'printer-2',
          status: 'planned',
          startTime: in48Hours.toISOString(), // Outside 24h horizon
          endTime: in48Hours.toISOString(),
          gramsPlanned: 100,
          requiredColor: 'Black',
          unitsPlanned: 5,
          plateType: 'full',
          shift: 'day',
          readinessState: 'ready',
        },
      ],
    });
    
    // Printer 1 has planned cycle in 12h (within 24h horizon) - blocked
    expect(isPrinterSpoolAvailable('printer-1', 24)).toBe(false);
    
    // Printer 2 has planned cycle in 48h (outside 24h horizon) - available
    expect(isPrinterSpoolAvailable('printer-2', 24)).toBe(true);
  });

  // Test 9: waiting_for_spool triggers correctly
  it('canAllocate returns waiting_for_spool when grams exist but no physical spool', () => {
    setupTestData({
      colorInventory: [{
        id: 'PLA:Black',
        color: 'Black',
        material: 'PLA',
        closedCount: 0, // No closed spools
        closedSpoolSizeGrams: 1000,
        openTotalGrams: 500,
        openSpoolCount: 1, // Only 1 open spool
      }],
      printers: [
        {
          id: 'printer-1',
          printerNumber: 1,
          name: 'Printer 1',
          active: true,
          status: 'active',
          hasAMS: false,
          mountedColor: 'Black', // This printer has the only open spool
          mountState: 'idle',
        },
        {
          id: 'printer-2',
          printerNumber: 2,
          name: 'Printer 2',
          active: true,
          status: 'active',
          hasAMS: false,
          // No spool - wants to load Black
        },
      ],
      plannedCycles: [], // No cycles blocking
    });
    
    // Grams exist (500), but:
    // - shelfFree = 1 - 1 = 0
    // - closedCount = 0
    // So no physical spool available for printer-2
    
    const result = canAllocateMaterial('printer-2', 'Black', 100, 24);
    
    expect(result.canAllocate).toBe(false);
    expect(result.blockReason).toBe('waiting_for_spool');
    expect(result.suggestions).toBeDefined();
    expect(result.suggestions?.some(s => s.type === 'use_idle_printer')).toBe(true);
  });
});

describe('Material Lifecycle - Reserved Grams from Cycles', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('getReservedGramsByColor sums from cycles, not printer estimates', () => {
    const in2Hours = new Date();
    in2Hours.setHours(in2Hours.getHours() + 2);
    
    const in48Hours = new Date();
    in48Hours.setHours(in48Hours.getHours() + 48);
    
    setupTestData({
      colorInventory: [{
        id: 'PLA:Black',
        color: 'Black',
        material: 'PLA',
        closedCount: 5,
        closedSpoolSizeGrams: 1000,
        openTotalGrams: 2000,
        openSpoolCount: 2,
      }],
      printers: [{
        id: 'printer-1',
        printerNumber: 1,
        name: 'Printer 1',
        active: true,
        status: 'active',
        hasAMS: false,
        mountedColor: 'Black',
        loadedGramsEstimate: 9999, // This should NOT be used!
        mountState: 'idle',
      }],
      plannedCycles: [
        {
          id: 'cycle-1',
          projectId: 'proj-1',
          printerId: 'printer-1',
          status: 'in_progress', // Always counts
          startTime: in48Hours.toISOString(), // Far future but in_progress
          endTime: in48Hours.toISOString(),
          gramsPlanned: 200,
          requiredColor: 'Black',
          unitsPlanned: 5,
          plateType: 'full',
          shift: 'day',
          readinessState: 'ready',
        },
        {
          id: 'cycle-2',
          projectId: 'proj-1',
          printerId: 'printer-1',
          status: 'planned', // Only counts if in horizon
          startTime: in2Hours.toISOString(), // Within 24h
          endTime: in2Hours.toISOString(),
          gramsPlanned: 150,
          requiredColor: 'Black',
          unitsPlanned: 3,
          plateType: 'full',
          shift: 'day',
          readinessState: 'ready',
        },
        {
          id: 'cycle-3',
          projectId: 'proj-1',
          printerId: 'printer-1',
          status: 'planned',
          startTime: in48Hours.toISOString(), // Outside 24h horizon
          endTime: in48Hours.toISOString(),
          gramsPlanned: 300, // Should NOT count
          requiredColor: 'Black',
          unitsPlanned: 6,
          plateType: 'full',
          shift: 'day',
          readinessState: 'ready',
        },
      ],
    });
    
    // Reserved = in_progress (200) + planned within horizon (150) = 350
    // NOT the printer's loadedGramsEstimate (9999)
    const reserved = getReservedGramsByColor('Black', 24);
    expect(reserved).toBe(350);
    
    // Available = openTotalGrams (2000) - reserved (350) = 1650
    const available = getGramsAvailableForAllocation('Black', 24);
    expect(available).toBe(1650);
  });
});
