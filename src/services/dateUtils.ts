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
  
  // Get the schedule for the calendar day
  const schedule = getDayScheduleForDate(start, settings, []);
  
  if (!schedule?.enabled) {
    // Non-working day (weekend/holiday) - cycle belongs to NEXT business day
    const nextWorkdayStart = advanceToNextWorkdayStart(start, settings);
    if (nextWorkdayStart) {
      return formatDateStringLocal(nextWorkdayStart);
    }
    return calendarDate;
  }
  
  // Working day - check if we're AFTER work hours
  const workEnd = createDateWithTime(start, schedule.endTime);
  
  // If cycle starts AFTER work hours end, it belongs to NEXT business day
  if (start > workEnd) {
    const nextWorkdayStart = advanceToNextWorkdayStart(start, settings);
    if (nextWorkdayStart) {
      return formatDateStringLocal(nextWorkdayStart);
    }
  }
  
  // Cycle is during work hours or before work hours on a working day
  // → belongs to THIS calendar day
  return calendarDate;
}
