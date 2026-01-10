// ============= NIGHT VALIDATOR TESTS =============
// Tests for nightFilamentValidator and getNightWindow

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { validateNightFilamentBudget, hasEnoughFilamentForNight, maxNightCyclesForFilament } from '../nightFilamentValidator';
import { ColorInventoryItem, FactorySettings, PlannedCycle } from '../storage';
import { NightWindow } from '../schedulingHelpers';

// ============= MOCK DATA =============

const createMockSettings = (afterHoursBehavior: 'NONE' | 'ONE_CYCLE_END_OF_DAY' | 'FULL_AUTOMATION'): FactorySettings => ({
  printerCount: 5,
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

const createMockNightWindow = (mode: 'none' | 'one_cycle' | 'full'): NightWindow => ({
  start: new Date('2025-01-10T17:30:00'),
  end: new Date('2025-01-11T08:30:00'),
  totalHours: 15,
  isWeekendNight: false,
  mode,
});

const createMockInventory = (closedCount: number, openTotalGrams: number): ColorInventoryItem => ({
  id: 'white-pla',
  color: 'White',
  material: 'PLA',
  closedCount,
  closedSpoolSizeGrams: 1000,
  openTotalGrams,
});

const createMockCycle = (gramsPlanned: number): PlannedCycle => ({
  id: `cycle-${Math.random()}`,
  projectId: 'project-1',
  printerId: 'printer-1',
  unitsPlanned: 10,
  gramsPlanned,
  plateType: 'full',
  startTime: '2025-01-10T18:00:00',
  endTime: '2025-01-10T22:00:00',
  shift: 'end_of_day',
  status: 'planned',
  readinessState: 'ready',
  requiredColor: 'White',
});

// ============= TESTS =============

describe('validateNightFilamentBudget', () => {
  describe('mode: none', () => {
    it('should not allow night cycles when mode is none', () => {
      const cycles = [createMockCycle(100)];
      const inventory = createMockInventory(2, 500);
      const nightWindow = createMockNightWindow('none');
      const settings = createMockSettings('NONE');
      
      const result = validateNightFilamentBudget(cycles, inventory, nightWindow, settings);
      
      expect(result.canPlanNight).toBe(false);
      expect(result.reason).toBe('no_after_hours_configured');
      expect(result.mode).toBe('none');
    });
  });
  
  describe('mode: one_cycle', () => {
    it('should validate only first cycle with 50g buffer', () => {
      const cycles = [createMockCycle(100), createMockCycle(100)];
      const inventory = createMockInventory(0, 160); // 100 + 50 buffer + 10 extra
      const nightWindow = createMockNightWindow('one_cycle');
      const settings = createMockSettings('ONE_CYCLE_END_OF_DAY');
      
      const result = validateNightFilamentBudget(cycles, inventory, nightWindow, settings);
      
      expect(result.canPlanNight).toBe(true);
      expect(result.gramsRequired).toBe(150); // 100 + 50 buffer
      expect(result.bufferGrams).toBe(50);
      expect(result.mode).toBe('one_cycle');
    });
    
    it('should fail when not enough for single cycle with buffer', () => {
      const cycles = [createMockCycle(100)];
      const inventory = createMockInventory(0, 140); // Not enough for 100 + 50
      const nightWindow = createMockNightWindow('one_cycle');
      const settings = createMockSettings('ONE_CYCLE_END_OF_DAY');
      
      const result = validateNightFilamentBudget(cycles, inventory, nightWindow, settings);
      
      expect(result.canPlanNight).toBe(false);
      expect(result.shortfall).toBe(10); // 150 needed - 140 available
    });
  });
  
  describe('mode: full', () => {
    it('should validate sum of all cycles with 10% buffer (min 100g)', () => {
      const cycles = [createMockCycle(200), createMockCycle(200), createMockCycle(200)];
      const inventory = createMockInventory(1, 0); // 1000g from sealed spool
      const nightWindow = createMockNightWindow('full');
      const settings = createMockSettings('FULL_AUTOMATION');
      
      const result = validateNightFilamentBudget(cycles, inventory, nightWindow, settings);
      
      // 600g total + 100g buffer (10% of 600 = 60, min is 100)
      expect(result.canPlanNight).toBe(true);
      expect(result.gramsRequired).toBe(700); // 600 + 100
      expect(result.bufferGrams).toBe(100);
    });
    
    it('should use 10% buffer when it exceeds 100g', () => {
      const cycles = [createMockCycle(500), createMockCycle(500), createMockCycle(500)];
      const inventory = createMockInventory(2, 0); // 2000g
      const nightWindow = createMockNightWindow('full');
      const settings = createMockSettings('FULL_AUTOMATION');
      
      const result = validateNightFilamentBudget(cycles, inventory, nightWindow, settings);
      
      // 1500g total + 150g buffer (10% of 1500)
      expect(result.canPlanNight).toBe(true);
      expect(result.gramsRequired).toBe(1650);
      expect(result.bufferGrams).toBe(150);
    });
    
    it('should fail when not enough filament for full night', () => {
      const cycles = [createMockCycle(400), createMockCycle(400), createMockCycle(400)];
      const inventory = createMockInventory(1, 200); // 1200g total
      const nightWindow = createMockNightWindow('full');
      const settings = createMockSettings('FULL_AUTOMATION');
      
      const result = validateNightFilamentBudget(cycles, inventory, nightWindow, settings);
      
      // 1200g needed + 120g buffer = 1320g, only 1200g available
      expect(result.canPlanNight).toBe(false);
      expect(result.shortfall).toBe(120);
    });
    
    it('should pass when no cycles to validate', () => {
      const cycles: PlannedCycle[] = [];
      const inventory = createMockInventory(0, 0);
      const nightWindow = createMockNightWindow('full');
      const settings = createMockSettings('FULL_AUTOMATION');
      
      const result = validateNightFilamentBudget(cycles, inventory, nightWindow, settings);
      
      expect(result.canPlanNight).toBe(true);
      expect(result.reason).toBe('no_cycles_to_validate');
    });
  });
});

describe('hasEnoughFilamentForNight', () => {
  it('should return false for mode none', () => {
    const inventory = createMockInventory(10, 0);
    expect(hasEnoughFilamentForNight('White', 10, 50, inventory, 'none')).toBe(false);
  });
  
  it('should check with 50g buffer for one_cycle mode', () => {
    const inventory = createMockInventory(0, 550); // 500g for units + 50 buffer
    expect(hasEnoughFilamentForNight('White', 10, 50, inventory, 'one_cycle')).toBe(true);
    
    const lowInventory = createMockInventory(0, 540);
    expect(hasEnoughFilamentForNight('White', 10, 50, lowInventory, 'one_cycle')).toBe(false);
  });
  
  it('should check with 10%/100g buffer for full mode', () => {
    // 500g needed, buffer = max(50, 100) = 100g
    const inventory = createMockInventory(0, 600);
    expect(hasEnoughFilamentForNight('White', 10, 50, inventory, 'full')).toBe(true);
    
    const lowInventory = createMockInventory(0, 590);
    expect(hasEnoughFilamentForNight('White', 10, 50, lowInventory, 'full')).toBe(false);
  });
});

describe('maxNightCyclesForFilament', () => {
  it('should return 0 for mode none', () => {
    expect(maxNightCyclesForFilament(100, 5000, 'none')).toBe(0);
  });
  
  it('should return 1 for mode one_cycle regardless of filament', () => {
    expect(maxNightCyclesForFilament(100, 5000, 'one_cycle')).toBe(1);
  });
  
  it('should calculate max cycles considering buffer for full mode', () => {
    // 1000g available, 200g per cycle
    // 4 cycles = 800g + 100g buffer = 900g → fits
    // 5 cycles = 1000g + 100g buffer = 1100g → doesn't fit
    expect(maxNightCyclesForFilament(200, 1000, 'full')).toBe(4);
  });
  
  it('should return 0 when gramsPerCycle is 0', () => {
    expect(maxNightCyclesForFilament(0, 1000, 'full')).toBe(0);
  });
});
