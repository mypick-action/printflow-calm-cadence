// ============= PHASE B TESTS =============
// Tests for planningPhaseB - especially night window per cycle date

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { phaseB_validateNightCycles, PhaseBInput } from '../planningPhaseB';
import { PlannedCycle, ColorInventoryItem, FactorySettings } from '../storage';
import { PrinterTimeSlot } from '../schedulingHelpers';

// ============= MOCK DATA =============

const createMockSettings = (afterHoursBehavior: 'NONE' | 'ONE_CYCLE_END_OF_DAY' | 'FULL_AUTOMATION'): FactorySettings => ({
  printerCount: 2,
  weeklySchedule: {
    sunday: { enabled: true, startTime: '08:30', endTime: '17:30' },
    monday: { enabled: true, startTime: '08:30', endTime: '17:30' },
    tuesday: { enabled: true, startTime: '08:30', endTime: '17:30' },
    wednesday: { enabled: true, startTime: '08:30', endTime: '17:30' },
    thursday: { enabled: true, startTime: '08:30', endTime: '17:30' },
    friday: { enabled: true, startTime: '09:00', endTime: '14:00' },
    saturday: { enabled: false, startTime: '09:00', endTime: '14:00' },
  },
  afterHoursBehavior,
  colors: ['White', 'Black'],
  standardSpoolWeight: 1000,
  deliveryDays: 3,
  transitionMinutes: 10,
  priorityRules: { urgentDaysThreshold: 14, criticalDaysThreshold: 7 },
  hasAMS: false,
});

const createMockSlot = (printerId: string, printerName: string): PrinterTimeSlot => ({
  printerId,
  printerName,
  currentTime: new Date('2025-01-10T08:30:00'),
  endOfDayTime: new Date('2025-01-10T17:30:00'),
  endOfWorkHours: new Date('2025-01-10T17:30:00'),
  workDayStart: new Date('2025-01-10T08:30:00'),
  hasAMS: false,
  canStartNewCyclesAfterHours: true,
  physicalPlateCapacity: 4,
  platesInUse: [],
});

const createMockCycle = (
  printerId: string,
  startTime: string,
  gramsPlanned: number,
  color: string = 'White'
): PlannedCycle => ({
  id: `cycle-${Math.random().toString(36).slice(2)}`,
  projectId: 'project-1',
  printerId,
  unitsPlanned: 10,
  gramsPlanned,
  plateType: 'full',
  startTime,
  endTime: new Date(new Date(startTime).getTime() + 4 * 60 * 60 * 1000).toISOString(),
  shift: 'end_of_day',
  status: 'planned',
  readinessState: 'ready',
  requiredColor: color,
});

const createMockInventory = (color: string, closedCount: number, openGrams: number): ColorInventoryItem => ({
  id: `${color.toLowerCase()}-pla`,
  color,
  material: 'PLA',
  closedCount,
  closedSpoolSizeGrams: 1000,
  openTotalGrams: openGrams,
});

// ============= TESTS =============

describe('phaseB_validateNightCycles', () => {
  describe('night window per cycle date', () => {
    it('should get correct night window for Saturday cycle (not Friday) - Saturday disabled should skip', () => {
      // This tests that a Saturday night cycle uses Saturday's night window, not planningStart's
      const settings = createMockSettings('FULL_AUTOMATION');
      const slots = [createMockSlot('printer-1', 'Printer 1')];
      
      // Planning starts Friday morning
      const planningStart = new Date('2025-01-10T09:00:00'); // Friday
      
      // Cycle is on Saturday night - should have no night window (Saturday disabled)
      const saturdayNightCycle = createMockCycle(
        'printer-1',
        '2025-01-11T20:00:00', // Saturday 8pm
        200,
        'White'
      );
      
      const colorInventory = new Map<string, ColorInventoryItem>();
      colorInventory.set('White', createMockInventory('White', 5, 0)); // Plenty of inventory
      
      const input: PhaseBInput = {
        allocations: [],
        printerSlots: slots,
        existingCycles: [saturdayNightCycle],
        settings,
        colorInventory,
        planningStart,
      };
      
      const result = phaseB_validateNightCycles(input);
      
      // Saturday is disabled in settings, so Saturday night cycle should be SKIPPED
      // because getNightWindow for Saturday returns mode='none' (no workday = no night window)
      expect(result.skippedNights.length).toBe(1);
      expect(result.skippedNights[0].reason).toBe('no_night_mode');
      expect(result.skippedNights[0].printerId).toBe('printer-1');
      
      // The cycle should NOT be in validated cycles
      expect(result.cycles.some(c => c.id === saturdayNightCycle.id)).toBe(false);
    });
    
    it('should validate Thursday night cycles with Thursday night window', () => {
      const settings = createMockSettings('FULL_AUTOMATION');
      const slots = [createMockSlot('printer-1', 'Printer 1')];
      
      const planningStart = new Date('2025-01-09T09:00:00'); // Thursday
      
      // Thursday night cycle
      const thursdayNightCycle = createMockCycle(
        'printer-1',
        '2025-01-09T18:00:00', // Thursday 6pm (after work hours)
        200,
        'White'
      );
      
      const colorInventory = new Map<string, ColorInventoryItem>();
      colorInventory.set('White', createMockInventory('White', 1, 0)); // 1000g available
      
      const input: PhaseBInput = {
        allocations: [],
        printerSlots: slots,
        existingCycles: [thursdayNightCycle],
        settings,
        colorInventory,
        planningStart,
      };
      
      const result = phaseB_validateNightCycles(input);
      
      // 200g + 100g buffer = 300g needed, 1000g available - should pass
      expect(result.cycles.some(c => c.id === thursdayNightCycle.id)).toBe(true);
      expect(result.skippedNights.length).toBe(0);
    });
    
    it('should handle multiple dates with different night requirements', () => {
      const settings = createMockSettings('FULL_AUTOMATION');
      const slots = [createMockSlot('printer-1', 'Printer 1')];
      
      const planningStart = new Date('2025-01-09T09:00:00'); // Thursday
      
      // Thursday night cycle
      const thursdayNightCycle = createMockCycle(
        'printer-1',
        '2025-01-09T18:00:00', // Thursday night
        200,
        'White'
      );
      
      // Sunday night cycle
      const sundayNightCycle = createMockCycle(
        'printer-1',
        '2025-01-12T18:00:00', // Sunday night
        200,
        'White'
      );
      
      const colorInventory = new Map<string, ColorInventoryItem>();
      colorInventory.set('White', createMockInventory('White', 1, 0));
      
      const input: PhaseBInput = {
        allocations: [],
        printerSlots: slots,
        existingCycles: [thursdayNightCycle, sundayNightCycle],
        settings,
        colorInventory,
        planningStart,
      };
      
      const result = phaseB_validateNightCycles(input);
      
      // Both should be validated independently with their own night windows
      expect(result.cycles.length).toBe(2);
    });
  });
  
  describe('mode constraints', () => {
    it('should skip all night cycles when mode is none', () => {
      const settings = createMockSettings('NONE');
      const slots = [createMockSlot('printer-1', 'Printer 1')];
      
      const nightCycle = createMockCycle(
        'printer-1',
        '2025-01-09T18:00:00',
        200,
        'White'
      );
      
      const colorInventory = new Map<string, ColorInventoryItem>();
      colorInventory.set('White', createMockInventory('White', 10, 0));
      
      const input: PhaseBInput = {
        allocations: [],
        printerSlots: slots,
        existingCycles: [nightCycle],
        settings,
        colorInventory,
        planningStart: new Date('2025-01-09T09:00:00'),
      };
      
      const result = phaseB_validateNightCycles(input);
      
      expect(result.skippedNights.length).toBe(1);
      expect(result.skippedNights[0].reason).toBe('no_night_mode');
    });
    
    it('should limit to one cycle when mode is one_cycle', () => {
      const settings = createMockSettings('ONE_CYCLE_END_OF_DAY');
      const slots = [createMockSlot('printer-1', 'Printer 1')];
      
      const nightCycles = [
        createMockCycle('printer-1', '2025-01-09T18:00:00', 100, 'White'),
        createMockCycle('printer-1', '2025-01-09T22:00:00', 100, 'White'),
        createMockCycle('printer-1', '2025-01-10T02:00:00', 100, 'White'),
      ];
      
      const colorInventory = new Map<string, ColorInventoryItem>();
      colorInventory.set('White', createMockInventory('White', 5, 0));
      
      const input: PhaseBInput = {
        allocations: [],
        printerSlots: slots,
        existingCycles: nightCycles,
        settings,
        colorInventory,
        planningStart: new Date('2025-01-09T09:00:00'),
      };
      
      const result = phaseB_validateNightCycles(input);
      
      // Only first cycle should be kept
      const keptNightCycles = result.cycles.filter(c => 
        new Date(c.startTime).getHours() >= 17
      );
      expect(keptNightCycles.length).toBe(1);
      expect(result.warnings.some(w => w.includes('ONE_CYCLE_END_OF_DAY'))).toBe(true);
    });
  });
  
  describe('filament validation', () => {
    it('should skip night cycles when insufficient filament', () => {
      const settings = createMockSettings('FULL_AUTOMATION');
      const slots = [createMockSlot('printer-1', 'Printer 1')];
      
      // 3 cycles × 400g = 1200g + 120g buffer = 1320g needed
      const nightCycles = [
        createMockCycle('printer-1', '2025-01-09T18:00:00', 400, 'White'),
        createMockCycle('printer-1', '2025-01-09T22:00:00', 400, 'White'),
        createMockCycle('printer-1', '2025-01-10T02:00:00', 400, 'White'),
      ];
      
      const colorInventory = new Map<string, ColorInventoryItem>();
      colorInventory.set('White', createMockInventory('White', 1, 0)); // Only 1000g
      
      const input: PhaseBInput = {
        allocations: [],
        printerSlots: slots,
        existingCycles: nightCycles,
        settings,
        colorInventory,
        planningStart: new Date('2025-01-09T09:00:00'),
      };
      
      const result = phaseB_validateNightCycles(input);
      
      expect(result.skippedNights.length).toBe(3);
      expect(result.skippedNights[0].reason).toBe('insufficient_filament_full_night');
    });
  });
});
