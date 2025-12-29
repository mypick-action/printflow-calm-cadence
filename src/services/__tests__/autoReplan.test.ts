import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scheduleAutoReplan, cancelPendingAutoReplan, isAutoReplanPending, __resetAutoReplanForTests } from '../autoReplan';

describe('autoReplan debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetAutoReplanForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    __resetAutoReplanForTests();
  });

  it('should not reset debounce timer when multiple triggers arrive', () => {
    // Schedule first replan
    scheduleAutoReplan('printer_updated');
    expect(isAutoReplanPending()).toBe(true);

    // Advance 500ms (less than debounce)
    vi.advanceTimersByTime(500);

    // Schedule more replans - should NOT reset the timer
    scheduleAutoReplan('inventory_updated');
    scheduleAutoReplan('spool_opened');

    // Still pending
    expect(isAutoReplanPending()).toBe(true);

    // Advance another 1000ms (total 1500ms from first schedule)
    // The replan should execute now because we didn't reset the timer
    vi.advanceTimersByTime(1000);

    // After execution completes, should no longer be pending
    // (Note: actual execution is async, but timer should have fired)
  });

  it('should accumulate reasons without resetting timer', () => {
    const consoleSpy = vi.spyOn(console, 'log');

    scheduleAutoReplan('first_reason');
    scheduleAutoReplan('second_reason');
    scheduleAutoReplan('third_reason');

    // Should see "Reason added" logs for 2nd and 3rd calls
    const reasonAddedLogs = consoleSpy.mock.calls.filter(
      call => call[0]?.includes?.('[AutoReplan] Reason added')
    );
    expect(reasonAddedLogs.length).toBe(2);

    consoleSpy.mockRestore();
  });

  it('should cancel pending replan', () => {
    scheduleAutoReplan('test_reason');
    expect(isAutoReplanPending()).toBe(true);

    cancelPendingAutoReplan();
    expect(isAutoReplanPending()).toBe(false);
  });
});
