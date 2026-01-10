/**
 * Date Utilities - Timezone-safe date formatting
 * 
 * IMPORTANT: Do NOT use toISOString().split('T')[0] for local date comparisons!
 * toISOString() returns UTC which causes timezone issues when comparing local dates.
 */

import { 
  FactorySettings, 
  getDayScheduleForDate 
} from './storage';
import { 
  advanceToNextWorkdayStart, 
  createDateWithTime,
  isOperatorPresent 
} from './schedulingHelpers';

/**
 * Format a date to YYYY-MM-DD using LOCAL time (not UTC).
 * This is the correct function to use for all date comparisons and grouping.
 * 
 * @example
 * // In Israel (UTC+2), at midnight local time:
 * // toISOString().split('T')[0] returns the PREVIOUS day (wrong!)
 * // formatDateStringLocal() returns the CURRENT day (correct!)
 */
export const formatDateStringLocal = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Check if two dates are on the same local day
 */
export const isSameLocalDay = (date1: Date, date2: Date): boolean => {
  return formatDateStringLocal(date1) === formatDateStringLocal(date2);
};

/**
 * Calculate the "business day" for a cycle.
 * 
 * BUSINESS RULE: A cycle is counted on the day it "belongs to" for planning purposes.
 * - Night cycles (after workdayEnd) belong to the NEXT business day
 * - The "night window" extends from workdayEnd to nextWorkdayStart
 * 
 * Examples (for Sun-Thu 08:30-17:30 schedule):
 * - Thursday 22:58 → Sunday (night window leads to Sunday)
 * - Saturday 23:30 → Sunday (weekend night, leads to Sunday)
 * - Sunday 01:00 → Sunday (still in night window leading to Sunday 08:30)
 * - Sunday 14:00 → Sunday (during work hours, same day)
 * 
 * @param startTime - The cycle's start time
 * @param settings - Factory settings with work schedule
 * @returns YYYY-MM-DD string of the business day
 */
export function getBusinessDay(
  startTime: Date | string,
  settings: FactorySettings
): string {
  const start = typeof startTime === 'string' ? new Date(startTime) : startTime;
  const calendarDate = formatDateStringLocal(start);
  
  // Key check: Find the next workday start from this time
  const nextWorkdayStart = advanceToNextWorkdayStart(start, settings);
  
  if (!nextWorkdayStart) {
    // Fallback: no next workday found, use calendar date
    return calendarDate;
  }
  
  // Check if operator is present at startTime
  // If operator IS present → we're in work hours → use calendar date
  if (isOperatorPresent(start, settings)) {
    return calendarDate;
  }
  
  // Operator is NOT present. This means we're either:
  // 1. After work hours (night window)
  // 2. On a non-working day (weekend/holiday)
  // 
  // In both cases, if startTime < nextWorkdayStart, 
  // the cycle belongs to that next workday.
  
  if (start < nextWorkdayStart) {
    // We're in the "night window" leading to nextWorkdayStart
    // This cycle belongs to that next business day
    return formatDateStringLocal(nextWorkdayStart);
  }
  
  // Shouldn't normally reach here, but fallback to calendar date
  return calendarDate;
}
