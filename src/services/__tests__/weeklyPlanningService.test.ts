/**
 * Weekly Planning Service Tests
 * Tests for pure logic functions: isOvernightCycle, crossesDeadline, computeProjectCoverage, getCyclesByDayAndPrinter
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PlannedCycle, Project, FactorySettings, DaySchedule, Printer } from '../storage';

// Mock the storage module before importing the service
vi.mock('../storage', () => ({
  getFactorySettings: vi.fn(),
  getProjects: vi.fn(),
  getPlannedCycles: vi.fn(),
  getPrinters: vi.fn(),
  getDayScheduleForDate: vi.fn(),
  getTemporaryOverrides: vi.fn(),
}));

vi.mock('../planningLogger', () => ({
  getLastReplanInfo: vi.fn(() => ({
    lastReplanAt: null,
    lastReplanResult: null,
  })),
}));

// Import after mocking
import {
  isOvernightCycle,
  crossesDeadline,
  computeProjectCoverage,
  getCyclesByDayAndPrinter,
  getWeekRange,
  getPlannedCyclesForWeek,
} from '../weeklyPlanningService';

import {
  getFactorySettings,
  getProjects,
  getPlannedCycles,
  getPrinters,
  getDayScheduleForDate,
  getTemporaryOverrides,
} from '../storage';

// ============= TEST FIXTURES =============

const mockWorkDaySchedule: DaySchedule = {
  enabled: true,
  startTime: '08:00',
  endTime: '18:00',
};

const mockNonWorkDaySchedule: DaySchedule = {
  enabled: false,
  startTime: '08:00',
  endTime: '18:00',
};

const mockFactorySettings: FactorySettings = {
  printerCount: 2,
  weeklySchedule: {
    sunday: mockWorkDaySchedule,
    monday: mockWorkDaySchedule,
    tuesday: mockWorkDaySchedule,
    wednesday: mockWorkDaySchedule,
    thursday: mockWorkDaySchedule,
    friday: { ...mockWorkDaySchedule, endTime: '14:00' },
    saturday: mockNonWorkDaySchedule,
  },
  afterHoursBehavior: 'NONE',
  colors: ['Red', 'Blue', 'Green'],
  standardSpoolWeight: 1000,
  deliveryDays: 3,
  transitionMinutes: 30,
  priorityRules: {
    urgentDaysThreshold: 14,
    criticalDaysThreshold: 7,
  },
  hasAMS: false,
};

function createMockCycle(overrides: Partial<PlannedCycle> = {}): PlannedCycle {
  return {
    id: 'cycle-1',
    projectId: 'project-1',
    printerId: 'printer-1',
    unitsPlanned: 10,
    gramsPlanned: 500,
    plateType: 'full',
    startTime: '2025-01-06T10:00:00.000Z', // Monday 10:00
    endTime: '2025-01-06T16:00:00.000Z', // Monday 16:00
    shift: 'day',
    status: 'planned',
    readinessState: 'ready',
    ...overrides,
  };
}

function createMockProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    name: 'Test Project',
    productId: 'product-1',
    productName: 'Test Product',
    quantityTarget: 100,
    quantityGood: 0,
    quantityScrap: 0,
    dueDate: '2025-01-15',
    urgency: 'normal',
    urgencyManualOverride: false,
    status: 'pending',
    color: 'Red',
    createdAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function createMockPrinter(overrides: Partial<Printer> = {}): Printer {
  return {
    id: 'printer-1',
    printerNumber: 1,
    name: 'Printer 1',
    active: true,
    status: 'active',
    hasAMS: false,
    ...overrides,
  };
}

// ============= isOvernightCycle TESTS =============

describe('isOvernightCycle', () => {
  beforeEach(() => {
    vi.mocked(getFactorySettings).mockReturnValue(mockFactorySettings);
    vi.mocked(getTemporaryOverrides).mockReturnValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns false when cycle is fully inside work hours', () => {
    // Monday 10:00-16:00 (work hours 08:00-18:00)
    vi.mocked(getDayScheduleForDate).mockReturnValue(mockWorkDaySchedule);
    
    const cycle = createMockCycle({
      startTime: '2025-01-06T10:00:00.000Z',
      endTime: '2025-01-06T16:00:00.000Z',
    });
    
    expect(isOvernightCycle(cycle)).toBe(false);
  });

  it('returns true when cycle starts before work hours', () => {
    vi.mocked(getDayScheduleForDate).mockReturnValue(mockWorkDaySchedule);
    
    const cycle = createMockCycle({
      startTime: '2025-01-06T06:00:00.000Z', // 06:00, work starts at 08:00
      endTime: '2025-01-06T10:00:00.000Z',
    });
    
    expect(isOvernightCycle(cycle)).toBe(true);
  });

  it('returns true when cycle ends after work hours', () => {
    vi.mocked(getDayScheduleForDate).mockReturnValue(mockWorkDaySchedule);
    
    const cycle = createMockCycle({
      startTime: '2025-01-06T16:00:00.000Z',
      endTime: '2025-01-06T20:00:00.000Z', // 20:00, work ends at 18:00
    });
    
    expect(isOvernightCycle(cycle)).toBe(true);
  });

  it('returns true when cycle starts on a non-working day', () => {
    // Saturday is non-working
    vi.mocked(getDayScheduleForDate).mockReturnValue(mockNonWorkDaySchedule);
    
    const cycle = createMockCycle({
      startTime: '2025-01-04T10:00:00.000Z', // Saturday
      endTime: '2025-01-04T16:00:00.000Z',
    });
    
    expect(isOvernightCycle(cycle)).toBe(true);
  });

  it('returns true when cycle ends on a non-working day', () => {
    // Start on Friday, end on Saturday
    vi.mocked(getDayScheduleForDate)
      .mockReturnValueOnce({ ...mockWorkDaySchedule, endTime: '14:00' }) // Friday for start
      .mockReturnValueOnce(mockNonWorkDaySchedule); // Saturday for end
    
    const cycle = createMockCycle({
      startTime: '2025-01-03T12:00:00.000Z', // Friday 12:00
      endTime: '2025-01-04T02:00:00.000Z', // Saturday 02:00
    });
    
    expect(isOvernightCycle(cycle)).toBe(true);
  });

  it('returns true when cycle crosses midnight (starts evening, ends morning)', () => {
    // Work hours 08:00-18:00
    vi.mocked(getDayScheduleForDate).mockReturnValue(mockWorkDaySchedule);
    
    const cycle = createMockCycle({
      startTime: '2025-01-06T17:00:00.000Z', // Monday 17:00 (before 18:00)
      endTime: '2025-01-07T02:00:00.000Z', // Tuesday 02:00 (after 18:00 - but also before 08:00)
    });
    
    // This should be overnight because end time 02:00 is outside work hours
    expect(isOvernightCycle(cycle)).toBe(true);
  });

  it('returns false when factory settings are missing', () => {
    vi.mocked(getFactorySettings).mockReturnValue(null as any);
    
    const cycle = createMockCycle();
    
    expect(isOvernightCycle(cycle)).toBe(false);
  });
});

// ============= crossesDeadline TESTS =============

describe('crossesDeadline', () => {
  it('returns false when cycle ends before due date', () => {
    const cycle = createMockCycle({
      endTime: '2025-01-10T16:00:00.000Z', // Jan 10
    });
    const project = createMockProject({
      dueDate: '2025-01-15', // Jan 15
    });
    
    expect(crossesDeadline(cycle, project)).toBe(false);
  });

  it('returns false when cycle ends exactly on due date at 23:59', () => {
    const cycle = createMockCycle({
      endTime: '2025-01-15T23:59:00.000Z', // Jan 15, 23:59
    });
    const project = createMockProject({
      dueDate: '2025-01-15', // Jan 15
    });
    
    expect(crossesDeadline(cycle, project)).toBe(false);
  });

  it('returns true when cycle ends after due date', () => {
    const cycle = createMockCycle({
      endTime: '2025-01-16T10:00:00.000Z', // Jan 16
    });
    const project = createMockProject({
      dueDate: '2025-01-15', // Jan 15
    });
    
    expect(crossesDeadline(cycle, project)).toBe(true);
  });

  it('returns false when project has no due date', () => {
    const cycle = createMockCycle();
    const project = createMockProject({
      dueDate: undefined as any,
    });
    
    expect(crossesDeadline(cycle, project)).toBe(false);
  });

  it('returns false when project is undefined', () => {
    const cycle = createMockCycle();
    
    expect(crossesDeadline(cycle, undefined)).toBe(false);
  });
});

// ============= computeProjectCoverage TESTS =============

describe('computeProjectCoverage', () => {
  beforeEach(() => {
    vi.mocked(getFactorySettings).mockReturnValue(mockFactorySettings);
    vi.mocked(getDayScheduleForDate).mockReturnValue(mockWorkDaySchedule);
    vi.mocked(getTemporaryOverrides).mockReturnValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns on_track for fully covered project', () => {
    const project = createMockProject({
      quantityTarget: 50,
      quantityGood: 20,
      status: 'in_progress',
    });
    
    vi.mocked(getProjects).mockReturnValue([project]);
    vi.mocked(getPlannedCycles).mockReturnValue([
      createMockCycle({
        projectId: 'project-1',
        unitsPlanned: 30, // Covers remaining 30
        status: 'planned',
        endTime: '2025-01-10T16:00:00.000Z', // Before deadline
      }),
    ]);
    
    const coverage = computeProjectCoverage();
    
    expect(coverage).toHaveLength(1);
    expect(coverage[0].status).toBe('on_track');
    expect(coverage[0].remainingUnits).toBe(30);
    expect(coverage[0].plannedUnits).toBe(30);
    expect(coverage[0].uncoveredUnits).toBe(0);
  });

  it('returns at_risk when planned units are not enough', () => {
    const project = createMockProject({
      quantityTarget: 50,
      quantityGood: 20,
      status: 'in_progress',
    });
    
    vi.mocked(getProjects).mockReturnValue([project]);
    vi.mocked(getPlannedCycles).mockReturnValue([
      createMockCycle({
        projectId: 'project-1',
        unitsPlanned: 10, // Only 10, need 30
        status: 'planned',
        endTime: '2025-01-10T16:00:00.000Z',
      }),
    ]);
    
    const coverage = computeProjectCoverage();
    
    expect(coverage[0].status).toBe('at_risk');
    expect(coverage[0].remainingUnits).toBe(30);
    expect(coverage[0].plannedUnits).toBe(10);
    expect(coverage[0].uncoveredUnits).toBe(20);
  });

  it('returns unscheduled when no cycles are planned', () => {
    const project = createMockProject({
      quantityTarget: 50,
      quantityGood: 20,
      status: 'pending',
    });
    
    vi.mocked(getProjects).mockReturnValue([project]);
    vi.mocked(getPlannedCycles).mockReturnValue([]); // No cycles
    
    const coverage = computeProjectCoverage();
    
    expect(coverage[0].status).toBe('unscheduled');
    expect(coverage[0].remainingUnits).toBe(30);
    expect(coverage[0].plannedUnits).toBe(0);
    expect(coverage[0].uncoveredUnits).toBe(30);
  });

  it('returns at_risk when cycle crosses deadline even if units are covered', () => {
    const project = createMockProject({
      quantityTarget: 50,
      quantityGood: 20,
      dueDate: '2025-01-15',
      status: 'in_progress',
    });
    
    vi.mocked(getProjects).mockReturnValue([project]);
    vi.mocked(getPlannedCycles).mockReturnValue([
      createMockCycle({
        projectId: 'project-1',
        unitsPlanned: 30, // Fully covers remaining
        status: 'planned',
        endTime: '2025-01-16T16:00:00.000Z', // AFTER deadline
      }),
    ]);
    
    const coverage = computeProjectCoverage();
    
    expect(coverage[0].status).toBe('at_risk');
    expect(coverage[0].uncoveredUnits).toBe(0); // Units are covered
  });

  it('correctly flags recovery projects', () => {
    const recoveryProject = createMockProject({
      id: 'recovery-1',
      name: 'Recovery Project',
      parentProjectId: 'original-project-1', // This makes it a recovery
      quantityTarget: 20,
      quantityGood: 0,
      status: 'pending',
    });
    
    vi.mocked(getProjects).mockReturnValue([recoveryProject]);
    vi.mocked(getPlannedCycles).mockReturnValue([
      createMockCycle({
        projectId: 'recovery-1',
        unitsPlanned: 20,
        status: 'planned',
        endTime: '2025-01-10T16:00:00.000Z',
      }),
    ]);
    
    const coverage = computeProjectCoverage();
    
    expect(coverage[0].isRecovery).toBe(true);
    expect(coverage[0].status).toBe('on_track');
  });

  it('separates plannedUnitsOnly and inProgressUnits correctly', () => {
    const project = createMockProject({
      quantityTarget: 100,
      quantityGood: 0,
      status: 'in_progress',
    });
    
    vi.mocked(getProjects).mockReturnValue([project]);
    vi.mocked(getPlannedCycles).mockReturnValue([
      createMockCycle({
        id: 'cycle-1',
        projectId: 'project-1',
        unitsPlanned: 30,
        status: 'planned',
        endTime: '2025-01-10T16:00:00.000Z',
      }),
      createMockCycle({
        id: 'cycle-2',
        projectId: 'project-1',
        unitsPlanned: 20,
        status: 'in_progress',
        endTime: '2025-01-08T16:00:00.000Z',
      }),
    ]);
    
    const coverage = computeProjectCoverage();
    
    expect(coverage[0].plannedUnitsOnly).toBe(30);
    expect(coverage[0].inProgressUnits).toBe(20);
    expect(coverage[0].plannedUnits).toBe(50); // Total
    expect(coverage[0].uncoveredUnits).toBe(50);
  });

  it('excludes completed projects from coverage', () => {
    const completedProject = createMockProject({
      id: 'completed-1',
      status: 'completed',
    });
    const activeProject = createMockProject({
      id: 'active-1',
      status: 'pending',
    });
    
    vi.mocked(getProjects).mockReturnValue([completedProject, activeProject]);
    vi.mocked(getPlannedCycles).mockReturnValue([]);
    
    const coverage = computeProjectCoverage();
    
    expect(coverage).toHaveLength(1);
    expect(coverage[0].projectId).toBe('active-1');
  });
});

// ============= getCyclesByDayAndPrinter TESTS =============

describe('getCyclesByDayAndPrinter', () => {
  beforeEach(() => {
    vi.mocked(getFactorySettings).mockReturnValue(mockFactorySettings);
    vi.mocked(getDayScheduleForDate).mockReturnValue(mockWorkDaySchedule);
    vi.mocked(getTemporaryOverrides).mockReturnValue([]);
    vi.mocked(getProjects).mockReturnValue([createMockProject()]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('groups cycles by printer correctly', () => {
    const printer1 = createMockPrinter({ id: 'printer-1', name: 'Printer 1' });
    const printer2 = createMockPrinter({ id: 'printer-2', name: 'Printer 2' });
    
    vi.mocked(getPrinters).mockReturnValue([printer1, printer2]);
    
    // Create cycles for today (we need to mock getWeekRange behavior)
    const today = new Date();
    today.setHours(10, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];
    
    const cycle1 = createMockCycle({
      id: 'cycle-1',
      printerId: 'printer-1',
      startTime: `${todayStr}T10:00:00.000Z`,
      endTime: `${todayStr}T14:00:00.000Z`,
    });
    const cycle2 = createMockCycle({
      id: 'cycle-2',
      printerId: 'printer-2',
      startTime: `${todayStr}T10:00:00.000Z`,
      endTime: `${todayStr}T14:00:00.000Z`,
    });
    
    vi.mocked(getPlannedCycles).mockReturnValue([cycle1, cycle2]);
    
    const result = getCyclesByDayAndPrinter();
    
    expect(result['printer-1']).toBeDefined();
    expect(result['printer-2']).toBeDefined();
    expect(result['printer-1'][todayStr]).toHaveLength(1);
    expect(result['printer-2'][todayStr]).toHaveLength(1);
    expect(result['printer-1'][todayStr][0].id).toBe('cycle-1');
    expect(result['printer-2'][todayStr][0].id).toBe('cycle-2');
  });

  it('groups cycles by start date correctly', () => {
    const printer = createMockPrinter();
    vi.mocked(getPrinters).mockReturnValue([printer]);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];
    
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];
    
    const cycleToday = createMockCycle({
      id: 'cycle-today',
      printerId: 'printer-1',
      startTime: `${todayStr}T10:00:00.000Z`,
      endTime: `${todayStr}T14:00:00.000Z`,
    });
    const cycleTomorrow = createMockCycle({
      id: 'cycle-tomorrow',
      printerId: 'printer-1',
      startTime: `${tomorrowStr}T10:00:00.000Z`,
      endTime: `${tomorrowStr}T14:00:00.000Z`,
    });
    
    vi.mocked(getPlannedCycles).mockReturnValue([cycleToday, cycleTomorrow]);
    
    const result = getCyclesByDayAndPrinter();
    
    expect(result['printer-1'][todayStr]).toHaveLength(1);
    expect(result['printer-1'][tomorrowStr]).toHaveLength(1);
    expect(result['printer-1'][todayStr][0].id).toBe('cycle-today');
    expect(result['printer-1'][tomorrowStr][0].id).toBe('cycle-tomorrow');
  });

  it('cross-midnight cycle stays on start day', () => {
    const printer = createMockPrinter();
    vi.mocked(getPrinters).mockReturnValue([printer]);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];
    
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];
    
    // Cycle starts today at 22:00, ends tomorrow at 04:00
    const crossMidnightCycle = createMockCycle({
      id: 'cycle-cross',
      printerId: 'printer-1',
      startTime: `${todayStr}T22:00:00.000Z`,
      endTime: `${tomorrowStr}T04:00:00.000Z`,
    });
    
    vi.mocked(getPlannedCycles).mockReturnValue([crossMidnightCycle]);
    
    const result = getCyclesByDayAndPrinter();
    
    // Should be on today (start day), not tomorrow
    expect(result['printer-1'][todayStr]).toHaveLength(1);
    expect(result['printer-1'][todayStr][0].id).toBe('cycle-cross');
    expect(result['printer-1'][tomorrowStr]).toHaveLength(0);
  });

  it('sorts cycles by startTime ascending within each day', () => {
    const printer = createMockPrinter();
    vi.mocked(getPrinters).mockReturnValue([printer]);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];
    
    // Create cycles in reverse order
    const cycle1 = createMockCycle({
      id: 'cycle-late',
      printerId: 'printer-1',
      startTime: `${todayStr}T16:00:00.000Z`,
      endTime: `${todayStr}T18:00:00.000Z`,
    });
    const cycle2 = createMockCycle({
      id: 'cycle-early',
      printerId: 'printer-1',
      startTime: `${todayStr}T08:00:00.000Z`,
      endTime: `${todayStr}T10:00:00.000Z`,
    });
    const cycle3 = createMockCycle({
      id: 'cycle-mid',
      printerId: 'printer-1',
      startTime: `${todayStr}T12:00:00.000Z`,
      endTime: `${todayStr}T14:00:00.000Z`,
    });
    
    vi.mocked(getPlannedCycles).mockReturnValue([cycle1, cycle2, cycle3]);
    
    const result = getCyclesByDayAndPrinter();
    
    const dayCycles = result['printer-1'][todayStr];
    expect(dayCycles).toHaveLength(3);
    expect(dayCycles[0].id).toBe('cycle-early');
    expect(dayCycles[1].id).toBe('cycle-mid');
    expect(dayCycles[2].id).toBe('cycle-late');
  });

  it('initializes empty arrays for printers with no cycles', () => {
    const printer1 = createMockPrinter({ id: 'printer-1' });
    const printer2 = createMockPrinter({ id: 'printer-2' });
    vi.mocked(getPrinters).mockReturnValue([printer1, printer2]);
    vi.mocked(getPlannedCycles).mockReturnValue([]); // No cycles
    
    const result = getCyclesByDayAndPrinter();
    
    expect(result['printer-1']).toBeDefined();
    expect(result['printer-2']).toBeDefined();
    
    // All days should have empty arrays
    const weekDays = getWeekRange();
    for (const day of weekDays) {
      expect(result['printer-1'][day.dateStr]).toEqual([]);
      expect(result['printer-2'][day.dateStr]).toEqual([]);
    }
  });
});

// ============= getWeekRange TESTS =============

describe('getWeekRange', () => {
  it('returns exactly 7 days', () => {
    const fixedDate = new Date('2025-01-06T12:00:00.000Z');
    const range = getWeekRange(fixedDate);
    
    expect(range).toHaveLength(7);
  });

  it('starts from provided date', () => {
    const startDate = new Date('2025-01-06T12:00:00.000Z'); // Monday
    const range = getWeekRange(startDate);
    
    expect(range[0].dateStr).toBe('2025-01-06');
  });

  it('generates consecutive days', () => {
    const startDate = new Date('2025-01-06T12:00:00.000Z');
    const range = getWeekRange(startDate);
    
    expect(range[0].dateStr).toBe('2025-01-06');
    expect(range[1].dateStr).toBe('2025-01-07');
    expect(range[2].dateStr).toBe('2025-01-08');
    expect(range[3].dateStr).toBe('2025-01-09');
    expect(range[4].dateStr).toBe('2025-01-10');
    expect(range[5].dateStr).toBe('2025-01-11');
    expect(range[6].dateStr).toBe('2025-01-12');
  });

  it('includes day names in English and Hebrew', () => {
    const startDate = new Date('2025-01-06T12:00:00.000Z'); // Monday
    const range = getWeekRange(startDate);
    
    expect(range[0].dayName).toBe('Monday');
    expect(range[0].dayNameHe).toBe('שני');
  });
});

// ============= getPlannedCyclesForWeek TESTS =============

describe('getPlannedCyclesForWeek', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('filters cycles within date range', () => {
    const cycle1 = createMockCycle({
      id: 'in-range',
      startTime: '2025-01-07T10:00:00.000Z',
    });
    const cycle2 = createMockCycle({
      id: 'before-range',
      startTime: '2025-01-01T10:00:00.000Z',
    });
    const cycle3 = createMockCycle({
      id: 'after-range',
      startTime: '2025-01-20T10:00:00.000Z',
    });
    
    vi.mocked(getPlannedCycles).mockReturnValue([cycle1, cycle2, cycle3]);
    
    const result = getPlannedCyclesForWeek('2025-01-06', '2025-01-12');
    
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('in-range');
  });

  it('filters by printer when provided', () => {
    const cycle1 = createMockCycle({
      id: 'printer-1-cycle',
      printerId: 'printer-1',
      startTime: '2025-01-07T10:00:00.000Z',
    });
    const cycle2 = createMockCycle({
      id: 'printer-2-cycle',
      printerId: 'printer-2',
      startTime: '2025-01-07T10:00:00.000Z',
    });
    
    vi.mocked(getPlannedCycles).mockReturnValue([cycle1, cycle2]);
    
    const result = getPlannedCyclesForWeek('2025-01-06', '2025-01-12', 'printer-1');
    
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('printer-1-cycle');
  });

  it('includes cycles at boundary dates (start of day)', () => {
    const cycle = createMockCycle({
      id: 'boundary-start',
      startTime: '2025-01-06T00:00:00.000Z', // Exactly at start
    });
    
    vi.mocked(getPlannedCycles).mockReturnValue([cycle]);
    
    const result = getPlannedCyclesForWeek('2025-01-06', '2025-01-12');
    
    expect(result).toHaveLength(1);
  });

  it('includes cycles at boundary dates (end of day)', () => {
    const cycle = createMockCycle({
      id: 'boundary-end',
      startTime: '2025-01-12T23:59:59.000Z', // Very end of range
    });
    
    vi.mocked(getPlannedCycles).mockReturnValue([cycle]);
    
    const result = getPlannedCyclesForWeek('2025-01-06', '2025-01-12');
    
    expect(result).toHaveLength(1);
  });
});
