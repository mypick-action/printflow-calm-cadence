// Planning Debug Service
// Toggle via: localStorage.setItem('printflow_debug_planning', '1')
// Disable via: localStorage.removeItem('printflow_debug_planning')

export const isPlanningDebugEnabled = (): boolean => {
  // Check global flag first (for programmatic toggle)
  const flag = (globalThis as any).__PLANNING_DEBUG__;
  if (typeof flag === 'boolean') return flag;

  // Check localStorage
  const fromStorage = localStorage.getItem('printflow_debug_planning');
  return fromStorage === '1';
};

export const pdebug = (...args: unknown[]): void => {
  if (!isPlanningDebugEnabled()) return;
  console.log('[PlanningDebug]', ...args);
};

// Enable debug mode programmatically
export const enablePlanningDebug = (): void => {
  (globalThis as any).__PLANNING_DEBUG__ = true;
  localStorage.setItem('printflow_debug_planning', '1');
  console.log('[PlanningDebug] Debug mode enabled');
};

// Disable debug mode
export const disablePlanningDebug = (): void => {
  (globalThis as any).__PLANNING_DEBUG__ = false;
  localStorage.removeItem('printflow_debug_planning');
  console.log('[PlanningDebug] Debug mode disabled');
};
