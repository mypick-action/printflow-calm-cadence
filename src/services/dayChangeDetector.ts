/**
 * Day Change Detection Service
 * 
 * Cloud-based detection of business day changes with atomic locking.
 * Uses RPC function for race-condition-safe day updates.
 * 
 * Flow:
 * 1. Call try_acquire_day_change_lock RPC (returns 'acquired', 'already_current', or 'lost')
 * 2. If 'acquired' - we won the lock but day NOT yet updated
 * 3. Run recalculatePlan
 * 4. If replan succeeds - call confirm_day_change to finalize
 * 5. If replan fails - don't update last_plan_day (so next device can try)
 */

import { supabase } from '@/integrations/supabase/client';
import { formatDateStringLocal } from '@/services/dateUtils';
import { recalculatePlan } from '@/services/planningRecalculator';

const LOCAL_FALLBACK_KEY = 'printflow_last_plan_day_fallback';

export interface DayChangeResult {
  isNewDay: boolean;
  triggeredReplan: boolean;
  replanSuccess: boolean;
  wasLocked: boolean; // true if another device already handled it
  error?: string;
}

/**
 * Check if a new business day has started and trigger replan if needed.
 * Uses Cloud RPC for atomic locking to prevent double-replan from multiple devices.
 * 
 * Business day is calculated using Israel local time (Asia/Jerusalem).
 */
export async function checkAndHandleDayChange(workspaceId: string): Promise<DayChangeResult> {
  // Business day = Israel local time (formatDateStringLocal uses getDate/getMonth which is local)
  const todayLocal = formatDateStringLocal(new Date());
  
  console.log('[DayChange] Checking day change for workspace:', workspaceId, 'Today:', todayLocal);
  
  try {
    // 1. Call atomic RPC to try to acquire the lock
    const { data: lockResult, error: lockError } = await supabase
      .rpc('try_acquire_day_change_lock', {
        p_workspace_id: workspaceId,
        p_today_date: todayLocal,
      });
    
    if (lockError) {
      console.error('[DayChange] RPC error:', lockError);
      throw lockError;
    }
    
    console.log('[DayChange] Lock result:', lockResult);
    
    // 2. Handle based on lock result
    if (lockResult === 'already_current') {
      // Same day - no action needed
      return { isNewDay: false, triggeredReplan: false, replanSuccess: false, wasLocked: false };
    }
    
    if (lockResult === 'lost') {
      // Another device already updated - they handle replan
      console.log('[DayChange] Lock lost - another device handling replan');
      return { isNewDay: true, triggeredReplan: false, replanSuccess: false, wasLocked: true };
    }
    
    // lockResult === 'acquired' - We won the lock!
    // IMPORTANT: Day is NOT yet updated - we update ONLY after replan succeeds
    console.log('[DayChange] Lock acquired - running replan');
    
    // 3. Run replan
    const replanResult = recalculatePlan('from_now', true, 'new_day_detected');
    
    if (!replanResult.success) {
      // Replan failed - DON'T update last_plan_day so next device can try
      console.error('[DayChange] Replan failed:', replanResult.summary);
      
      // Rollback: set day back to null so lock can be reacquired
      await supabase.rpc('confirm_day_change', {
        p_workspace_id: workspaceId,
        p_date: null, // Reset to allow retry
      });
      
      return { 
        isNewDay: true, 
        triggeredReplan: true, 
        replanSuccess: false, 
        wasLocked: false,
        error: replanResult.summary,
      };
    }
    
    // 4. Replan succeeded - confirm the day change (already updated by RPC, but confirm)
    const { error: confirmError } = await supabase.rpc('confirm_day_change', {
      p_workspace_id: workspaceId,
      p_date: todayLocal,
    });
    
    if (confirmError) {
      console.error('[DayChange] Failed to confirm day change:', confirmError);
    }
    
    // 5. Update localStorage fallback
    localStorage.setItem(LOCAL_FALLBACK_KEY, todayLocal);
    
    console.log('[DayChange] Successfully handled day change');
    return { 
      isNewDay: true, 
      triggeredReplan: true, 
      replanSuccess: true, 
      wasLocked: false,
    };
    
  } catch (error) {
    console.error('[DayChange] Error:', error);
    
    // Fallback to localStorage if Cloud fails (offline mode)
    const localFallback = localStorage.getItem(LOCAL_FALLBACK_KEY);
    if (localFallback !== todayLocal) {
      console.log('[DayChange] Using localStorage fallback');
      localStorage.setItem(LOCAL_FALLBACK_KEY, todayLocal);
      
      const result = recalculatePlan('from_now', true, 'new_day_fallback');
      return { 
        isNewDay: true, 
        triggeredReplan: true, 
        replanSuccess: result.success, 
        wasLocked: false, 
        error: 'Used localStorage fallback',
      };
    }
    
    return { 
      isNewDay: false, 
      triggeredReplan: false, 
      replanSuccess: false, 
      wasLocked: false, 
      error: String(error),
    };
  }
}

/**
 * Get the last active day from localStorage (for offline/fallback)
 */
export function getLastActiveDayLocal(): string | null {
  return localStorage.getItem(LOCAL_FALLBACK_KEY);
}
