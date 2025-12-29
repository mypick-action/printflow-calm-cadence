import { describe, it, expect } from 'vitest';
import type { PlannedCycle } from '../storage';

// Helper function to test cyclesToKeep filter logic (mirrors the actual implementation)
const filterCyclesToKeep = (
  cycles: Partial<PlannedCycle>[],
  scope: 'from_now' | 'from_tomorrow' | 'whole_week',
  lockStarted: boolean
): Partial<PlannedCycle>[] => {
  return cycles.filter((cycle) => {
    const isCompleted = cycle.status === 'completed' || cycle.status === 'failed';
    if (isCompleted) return true;

    const isInProgress = cycle.status === 'in_progress';
    if (lockStarted && isInProgress) return true;

    // CRITICAL: Never keep planned cycles in from_now - they will be regenerated
    if (scope === 'from_now') return false;

    // For whole_week scope, also don't keep planned
    return false;
  });
};

describe('cyclesToKeep filter', () => {
  const baseCycle = {
    id: 'test',
    projectId: 'proj-1',
    printerId: 'printer-1',
    unitsPlanned: 10,
    gramsPlanned: 100,
    plateType: 'full' as const,
    startTime: new Date().toISOString(),
    endTime: new Date().toISOString(),
    shift: 'day' as const,
    readinessState: 'ready' as const,
  };

  it('should keep completed and failed cycles', () => {
    const cycles: Partial<PlannedCycle>[] = [
      { ...baseCycle, id: 'c1', status: 'completed' },
      { ...baseCycle, id: 'c2', status: 'failed' },
      { ...baseCycle, id: 'c3', status: 'planned' },
    ];

    const kept = filterCyclesToKeep(cycles, 'from_now', true);
    const keptIds = kept.map(c => c.id).sort();

    expect(keptIds).toEqual(['c1', 'c2']);
  });

  it('should keep in_progress if locked', () => {
    const cycles: Partial<PlannedCycle>[] = [
      { ...baseCycle, id: 'c1', status: 'in_progress' },
      { ...baseCycle, id: 'c2', status: 'planned' },
    ];

    const kept = filterCyclesToKeep(cycles, 'from_now', true);
    const keptIds = kept.map(c => c.id);

    expect(keptIds).toEqual(['c1']);
  });

  it('should NOT keep in_progress if not locked', () => {
    const cycles: Partial<PlannedCycle>[] = [
      { ...baseCycle, id: 'c1', status: 'in_progress' },
    ];

    const kept = filterCyclesToKeep(cycles, 'from_now', false);
    expect(kept.length).toBe(0);
  });

  it('should NEVER keep planned cycles in from_now scope', () => {
    const cycles: Partial<PlannedCycle>[] = [
      { ...baseCycle, id: 'c1', status: 'planned', startTime: '2024-01-01T08:30:00' },
      { ...baseCycle, id: 'c2', status: 'planned', startTime: '2024-01-01T10:30:00' },
      { ...baseCycle, id: 'c3', status: 'planned', startTime: '2024-01-02T08:30:00' },
    ];

    const kept = filterCyclesToKeep(cycles, 'from_now', true);
    expect(kept.length).toBe(0);
  });

  it('should NEVER keep planned cycles in whole_week scope', () => {
    const cycles: Partial<PlannedCycle>[] = [
      { ...baseCycle, id: 'c1', status: 'planned' },
      { ...baseCycle, id: 'c2', status: 'completed' },
    ];

    const kept = filterCyclesToKeep(cycles, 'whole_week', true);
    const keptIds = kept.map(c => c.id);

    expect(keptIds).toEqual(['c2']);
  });

  it('should correctly filter mixed statuses', () => {
    const cycles: Partial<PlannedCycle>[] = [
      { ...baseCycle, id: 'c1', status: 'planned' },
      { ...baseCycle, id: 'c2', status: 'completed' },
      { ...baseCycle, id: 'c3', status: 'failed' },
      { ...baseCycle, id: 'c4', status: 'in_progress' },
      { ...baseCycle, id: 'c5', status: 'planned' },
    ];

    const kept = filterCyclesToKeep(cycles, 'from_now', true);
    const keptIds = kept.map(c => c.id).sort();

    // Should keep: completed (c2), failed (c3), in_progress (c4 - locked)
    // Should NOT keep: planned (c1, c5)
    expect(keptIds).toEqual(['c2', 'c3', 'c4']);
  });
});
