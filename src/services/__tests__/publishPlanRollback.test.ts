// Test for atomic publish plan rollback behavior
// This test validates that the RPC function properly rolls back on failure

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Supabase
const mockRpc = vi.fn();
const mockInvoke = vi.fn();
const mockFrom = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockSingle = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: mockRpc,
    functions: {
      invoke: mockInvoke,
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: mockSingle,
        }),
      }),
    }),
  },
}));

describe('publish-plan atomic rollback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('should return error and not change plan_version when RPC fails', async () => {
    // Simulate RPC failure (e.g., invalid project_id)
    mockInvoke.mockResolvedValue({
      data: {
        success: false,
        plan_version: null,
        cycles_created: 0,
        cycles_deleted: 0,
        error: 'insert or update on table "planned_cycles" violates foreign key constraint',
      },
      error: null,
    });

    // Import after mocking
    const { publishPlanToCloud } = await import('../planVersionService');
    
    // Set up minimal localStorage
    localStorage.setItem('printflow_projects', JSON.stringify([
      { id: 'proj-1', cloudUuid: 'uuid-proj-1', productId: 'prod-1' }
    ]));
    
    const result = await publishPlanToCloud({
      workspaceId: 'test-workspace',
      cycles: [{
        id: 'cycle-1',
        projectId: 'proj-1',
        printerId: 'printer-1',
        unitsPlanned: 10,
        gramsPlanned: 100,
        plateType: 'full' as const,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        shift: 'day' as const,
        status: 'planned' as const,
        readinessState: 'ready' as const,
      }],
      reason: 'test',
      scope: 'from_now',
    });

    // Should fail
    expect(result.success).toBe(false);
    expect(result.planVersion).toBeNull();
    expect(result.error).toContain('foreign key constraint');
    
    // Local plan version should NOT be updated
    const localVersion = localStorage.getItem('printflow_local_plan_version');
    expect(localVersion).toBeNull();
  });

  it('should succeed and set local plan version when RPC succeeds', async () => {
    const newPlanVersion = 'new-version-uuid';
    
    mockInvoke.mockResolvedValue({
      data: {
        success: true,
        plan_version: newPlanVersion,
        cycles_created: 1,
        cycles_deleted: 0,
        error: null,
      },
      error: null,
    });

    // Import after mocking
    const { publishPlanToCloud, getLocalPlanVersion } = await import('../planVersionService');
    
    // Set up minimal localStorage
    localStorage.setItem('printflow_projects', JSON.stringify([
      { id: 'proj-1', cloudUuid: 'uuid-proj-1', productId: 'prod-1' }
    ]));
    
    const result = await publishPlanToCloud({
      workspaceId: 'test-workspace',
      cycles: [{
        id: 'cycle-1',
        projectId: 'proj-1',
        printerId: 'printer-1',
        unitsPlanned: 10,
        gramsPlanned: 100,
        plateType: 'full' as const,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        shift: 'day' as const,
        status: 'planned' as const,
        readinessState: 'ready' as const,
      }],
      reason: 'test',
      scope: 'from_now',
    });

    // Should succeed
    expect(result.success).toBe(true);
    expect(result.planVersion).toBe(newPlanVersion);
    expect(result.cyclesCreated).toBe(1);
    
    // Local plan version SHOULD be updated
    expect(getLocalPlanVersion()).toBe(newPlanVersion);
  });

  it('should handle network errors gracefully', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { message: 'Network error: Failed to fetch' },
    });

    const { publishPlanToCloud, getLocalPlanVersion } = await import('../planVersionService');
    
    localStorage.setItem('printflow_projects', JSON.stringify([
      { id: 'proj-1', cloudUuid: 'uuid-proj-1' }
    ]));
    
    const result = await publishPlanToCloud({
      workspaceId: 'test-workspace',
      cycles: [{
        id: 'cycle-1',
        projectId: 'proj-1',
        printerId: 'printer-1',
        unitsPlanned: 10,
        gramsPlanned: 100,
        plateType: 'full' as const,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        shift: 'day' as const,
        status: 'planned' as const,
        readinessState: 'ready' as const,
      }],
      reason: 'test',
      scope: 'from_now',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Network error');
    expect(getLocalPlanVersion()).toBeNull();
  });
});

/**
 * MANUAL TEST PROCEDURE for Test A: "Rollback אמיתי"
 * 
 * 1. Open browser DevTools → Network tab
 * 2. In the app, go to Planning page
 * 3. Temporarily modify a cycle to have an invalid project_id:
 *    - In Console: 
 *      const cycles = JSON.parse(localStorage.getItem('printflow_cycles'));
 *      cycles[0].projectId = 'invalid-uuid';
 *      localStorage.setItem('printflow_cycles', JSON.stringify(cycles));
 * 4. Click "Recalculate" button
 * 5. Watch the Network tab for publish-plan request
 * 6. Expected: 
 *    - publish-plan should return success: false
 *    - active_plan_version in factory_settings should NOT change
 *    - planned_cycles in cloud should still have the OLD cycles
 * 7. Verify in Console:
 *    - localStorage.getItem('printflow_local_plan_version') should be unchanged
 */

/**
 * MANUAL TEST PROCEDURE for Test B: "Two clients, no refresh"
 * 
 * 1. Open the app in two browser windows (or browser + incognito)
 * 2. Login to the same account in both
 * 3. Both should show the same plan
 * 4. In Window A: Click "Recalculate" 
 * 5. Watch Window B (DO NOT REFRESH)
 * 6. Expected:
 *    - Window B should receive realtime update within 1-3 seconds
 *    - The plan in Window B should update to match Window A
 *    - No "empty" state should appear during transition
 * 7. Verify in Console (Window B):
 *    - Look for "[RealtimeSync] New plan version detected" log
 *    - Look for "[PlanVersion] ✓ Loaded X cycles" log
 */
