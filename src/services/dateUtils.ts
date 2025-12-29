/**
 * Date Utilities - Timezone-safe date formatting
 * 
 * IMPORTANT: Do NOT use toISOString().split('T')[0] for local date comparisons!
 * toISOString() returns UTC which causes timezone issues when comparing local dates.
 */

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
