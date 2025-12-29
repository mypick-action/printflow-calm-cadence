import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock storage module before importing planningEngine
vi.mock('../storage', () => ({
  getProjects: vi.fn(() => []),
  getActiveProjects: vi.fn(() => []),
  getPrinters: vi.fn(() => []),
  getActivePrinters: vi.fn(() => []),
  getProducts: vi.fn(() => []),
  getProduct: vi.fn(() => null),
  getFactorySettings: vi.fn(() => null),
  getSpools: vi.fn(() => []),
  getPlannedCycles: vi.fn(() => []),
  getDayScheduleForDate: vi.fn(() => null),
  getAvailableFilamentForPrinter: vi.fn(() => 0),
  getGramsPerCycle: vi.fn(() => 100),
  getColorInventory: vi.fn(() => []),
  getTotalGrams: vi.fn(() => 1000),
}));

import { generatePlan } from '@/services/planningEngine';
import * as storage from '../storage';

describe('PlanningEngine start times', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('from_now: does not schedule cycles before planningStartTime on same day', () => {
    // Planning starts at 10:32
    const planningStart = new Date('2025-12-29T10:32:00.000Z');
    
    // Mock active projects with remaining units
    const mockProjects = [{
      id: 'proj1',
      name: 'Test Project',
      status: 'active',
      quantityTarget: 100,
      quantityGood: 0,
      dueDate: '2025-12-31',
      color: 'black',
      urgency: 'normal',
      productId: 'product1',
    }];
    
    const mockProducts = [{
      id: 'product1',
      name: 'Test Product',
      gramsPerUnit: 10,
      platePresets: [{
        id: 'preset1',
        name: 'Default',
        unitsPerPlate: 20,
        cycleHours: 2,
        isRecommended: true,
        allowedForNightCycle: true,
      }],
    }];
    
    const mockPrinters = [
      { id: 'p1', name: 'Printer 1', active: true, status: 'active', canStartNewCyclesAfterHours: false },
      { id: 'p2', name: 'Printer 2', active: true, status: 'active', canStartNewCyclesAfterHours: false },
    ];
    
    const mockSettings = {
      transitionMinutes: 10,
      afterHoursBehavior: 'NONE',
    };
    
    // Day schedule: 08:30 - 17:00
    const mockSchedule = {
      enabled: true,
      startTime: '08:30',
      endTime: '17:00',
    };
    
    const mockColorInventory = [{
      color: 'black',
      material: 'PLA',
      spools: [{ id: 's1', gramsRemaining: 5000, state: 'open' }],
    }];
    
    // Setup mocks
    vi.mocked(storage.getActiveProjects).mockReturnValue(mockProjects as any);
    vi.mocked(storage.getProducts).mockReturnValue(mockProducts as any);
    vi.mocked(storage.getActivePrinters).mockReturnValue(mockPrinters as any);
    vi.mocked(storage.getFactorySettings).mockReturnValue(mockSettings as any);
    vi.mocked(storage.getDayScheduleForDate).mockReturnValue(mockSchedule as any);
    vi.mocked(storage.getColorInventory).mockReturnValue(mockColorInventory as any);
    vi.mocked(storage.getPlannedCycles).mockReturnValue([]);
    vi.mocked(storage.getSpools).mockReturnValue([]);
    vi.mocked(storage.getTotalGrams).mockReturnValue(5000);
    
    const result = generatePlan({
      startDate: planningStart,
      daysToPlane: 1,
      scope: 'from_now',
      lockInProgress: true,
    });
    
    // Filter only new planned cycles (not completed/in_progress)
    const newCycles = (result?.cycles ?? []).filter(c => c.status === 'planned');
    
    // Core assertion: no cycle starts before planningStart
    for (const c of newCycles) {
      const cycleStart = new Date(c.startTime).getTime();
      expect(cycleStart).toBeGreaterThanOrEqual(planningStart.getTime());
    }
  });

  it('respects busyUntil for printers with in_progress cycles', () => {
    // Planning starts at 10:32
    const planningStart = new Date('2025-12-29T10:32:00.000Z');
    
    // Printer 1 has an in_progress cycle ending at 12:00
    const existingCycles = [{
      id: 'existing1',
      projectId: 'proj1',
      printerId: 'p1',
      status: 'in_progress',
      startTime: '2025-12-29T09:00:00.000Z',
      endTime: '2025-12-29T12:00:00.000Z',
      unitsPlanned: 20,
    }];
    
    const mockProjects = [{
      id: 'proj1',
      name: 'Test Project',
      status: 'active',
      quantityTarget: 100,
      quantityGood: 20, // 20 already done in the in_progress cycle
      dueDate: '2025-12-31',
      color: 'black',
      urgency: 'normal',
      productId: 'product1',
    }];
    
    const mockProducts = [{
      id: 'product1',
      name: 'Test Product',
      gramsPerUnit: 10,
      platePresets: [{
        id: 'preset1',
        name: 'Default',
        unitsPerPlate: 20,
        cycleHours: 2,
        isRecommended: true,
        allowedForNightCycle: true,
      }],
    }];
    
    const mockPrinters = [
      { id: 'p1', name: 'Printer 1', active: true, status: 'active', canStartNewCyclesAfterHours: false },
    ];
    
    const mockSettings = {
      transitionMinutes: 10,
      afterHoursBehavior: 'NONE',
    };
    
    const mockSchedule = {
      enabled: true,
      startTime: '08:30',
      endTime: '17:00',
    };
    
    const mockColorInventory = [{
      color: 'black',
      material: 'PLA',
      spools: [{ id: 's1', gramsRemaining: 5000, state: 'open' }],
    }];
    
    vi.mocked(storage.getActiveProjects).mockReturnValue(mockProjects as any);
    vi.mocked(storage.getProducts).mockReturnValue(mockProducts as any);
    vi.mocked(storage.getActivePrinters).mockReturnValue(mockPrinters as any);
    vi.mocked(storage.getFactorySettings).mockReturnValue(mockSettings as any);
    vi.mocked(storage.getDayScheduleForDate).mockReturnValue(mockSchedule as any);
    vi.mocked(storage.getColorInventory).mockReturnValue(mockColorInventory as any);
    vi.mocked(storage.getPlannedCycles).mockReturnValue(existingCycles as any);
    vi.mocked(storage.getSpools).mockReturnValue([]);
    vi.mocked(storage.getTotalGrams).mockReturnValue(5000);
    
    const result = generatePlan({
      startDate: planningStart,
      daysToPlane: 1,
      scope: 'from_now',
      lockInProgress: true,
    });
    
    // Filter only new planned cycles for printer p1
    const p1Cycles = (result?.cycles ?? []).filter(
      c => c.status === 'planned' && c.printerId === 'p1'
    );
    
    // Printer 1 should not have any new cycles starting before 12:00 + 10min transition = 12:10
    const busyUntilPlusTransition = new Date('2025-12-29T12:10:00.000Z').getTime();
    
    for (const c of p1Cycles) {
      const cycleStart = new Date(c.startTime).getTime();
      expect(cycleStart).toBeGreaterThanOrEqual(busyUntilPlusTransition);
    }
  });
});
