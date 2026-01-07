// ============= SCHEDULING HELPERS =============
// Shared utility functions for both estimation and scheduling
// Ensures consistency between dry-run simulation and actual scheduling

import { 
  FactorySettings, 
  Printer, 
  getDayScheduleForDate,
  PlatePreset
} from './storage';

// ============= PLATE RELEASE INFO =============
export interface PlateReleaseInfo {
  releaseTime: Date;
  cycleId: string;
}

// ============= END OF DAY SOURCE =============
// Time source - ONLY 'endOfWorkHours' or 'nextWorkdayStart'
// The reason for that source is stored separately in endOfDayTimeReason
export type EndOfDayTimeSource = 
  | 'endOfWorkHours'           // Day ends at regular work hours (no night extension)
  | 'nextWorkdayStart';        // Day extends to next workday (FULL_AUTOMATION enabled)

// ============= TIME SLOT INTERFACE =============
// Represents a printer's current scheduling state
export interface PrinterTimeSlot {
  printerId: string;
  printerName: string;
  currentTime: Date;
  endOfDayTime: Date;
  endOfWorkHours: Date;
  workDayStart: Date;
  hasAMS: boolean;
  canStartNewCyclesAfterHours: boolean;
  physicalPlateCapacity: number;
  platesInUse: PlateReleaseInfo[];  // Plates currently in use with release times
  cyclesScheduled?: any[];  // Track cycles for plate index calculation
  lastScheduledColor?: string;
  // NEW: Debug field - explains why endOfDayTime was set
  endOfDayTimeSource?: EndOfDayTimeSource;
  endOfDayTimeReason?: string;  // Additional human-readable reason
}

// ============= HELPER: Parse time string =============
export function parseTime(timeStr: string): { hours: number; minutes: number } {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return { hours, minutes };
}

// ============= HELPER: Create date with specific time =============
export function createDateWithTime(date: Date, timeStr: string): Date {
  const result = new Date(date);
  const { hours, minutes } = parseTime(timeStr);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

// ============= HELPER: Add days to date =============
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

// ============= CORE: Advance to next workday start =============
/**
 * Given a current time, find the start of the next working day.
 * ONLY accepts a Date - does not modify any slot.
 * 
 * @param currentTime - The current time point
 * @param settings - Factory settings with schedule
 * @param maxDaysAhead - Maximum days to search (default 14)
 * @returns Start time of next workday, or null if none found
 */
export function advanceToNextWorkdayStart(
  currentTime: Date,
  settings: FactorySettings,
  maxDaysAhead: number = 14
): Date | null {
  // Start from the next day
  const startSearchDate = new Date(currentTime);
  startSearchDate.setDate(startSearchDate.getDate() + 1);
  startSearchDate.setHours(0, 0, 0, 0);
  
  for (let offset = 0; offset < maxDaysAhead; offset++) {
    const checkDate = addDays(startSearchDate, offset);
    const schedule = getDayScheduleForDate(checkDate, settings, []);
    
    if (schedule?.enabled) {
      return createDateWithTime(checkDate, schedule.startTime);
    }
  }
  
  return null;
}

// ============= CORE: Update slot bounds for new day =============
/**
 * Updates a printer time slot's day boundaries for a new day.
 * Called after advanceToNextWorkdayStart to set new bounds.
 * 
 * @param slot - The printer time slot to update (mutated in place)
 * @param dayStart - The new day's start time
 * @param settings - Factory settings
 */
export function updateSlotBoundsForDay(
  slot: PrinterTimeSlot,
  dayStart: Date,
  settings: FactorySettings
): void {
  const schedule = getDayScheduleForDate(dayStart, settings, []);
  
  if (!schedule?.enabled) {
    // Non-working day - shouldn't happen if advanceToNextWorkdayStart worked
    console.warn('[schedulingHelpers] updateSlotBoundsForDay called for non-working day');
    return;
  }
  
  slot.workDayStart = new Date(dayStart);
  slot.endOfWorkHours = createDateWithTime(dayStart, schedule.endTime);
  
  // Handle cross-midnight schedules
  const startMinutes = parseTime(schedule.startTime).hours * 60 + parseTime(schedule.startTime).minutes;
  const endMinutes = parseTime(schedule.endTime).hours * 60 + parseTime(schedule.endTime).minutes;
  if (endMinutes < startMinutes) {
    slot.endOfWorkHours = new Date(slot.endOfWorkHours.getTime() + 24 * 60 * 60 * 1000);
  }
  
  // Set endOfDayTime based on automation mode - with explicit source tracking
  // Determine endOfDayTime: source is ONLY 'endOfWorkHours' or 'nextWorkdayStart'
  // The REASON for that choice is stored in endOfDayTimeReason
  if (settings.afterHoursBehavior !== 'FULL_AUTOMATION') {
    // Factory doesn't allow after-hours operation
    slot.endOfDayTime = new Date(slot.endOfWorkHours);
    slot.endOfDayTimeSource = 'endOfWorkHours';
    slot.endOfDayTimeReason = `afterHours_disabled: afterHoursBehavior=${settings.afterHoursBehavior}`;
  } else if (!slot.canStartNewCyclesAfterHours) {
    // Printer can't start cycles after hours
    slot.endOfDayTime = new Date(slot.endOfWorkHours);
    slot.endOfDayTimeSource = 'endOfWorkHours';
    slot.endOfDayTimeReason = `printer_night_disabled: canStartNewCyclesAfterHours=false`;
  } else {
    // FULL_AUTOMATION enabled and printer allows night - extend to next workday start
    // FIX: Use endOfWorkHours (not dayStart) as base - ensures we find NEXT workday, not same day
    const nextWorkday = advanceToNextWorkdayStart(slot.endOfWorkHours, settings);
    if (nextWorkday) {
      slot.endOfDayTime = nextWorkday;
      slot.endOfDayTimeSource = 'nextWorkdayStart';
      slot.endOfDayTimeReason = `extended to ${nextWorkday.toISOString()}`;
    } else {
      slot.endOfDayTime = new Date(slot.endOfWorkHours);
      slot.endOfDayTimeSource = 'endOfWorkHours';
      slot.endOfDayTimeReason = 'no_next_workday: could not find next working day';
    }
  }
}

// ============= CORE: Get effective availability time =============
/**
 * Returns when a printer will actually be available to start a cycle.
 * If currentTime is past endOfDayTime, calculates next workday start.
 * 
 * @param slot - The printer time slot
 * @param settings - Factory settings
 * @returns Effective availability time (may be in the future if next workday)
 */
export function getEffectiveAvailability(
  slot: PrinterTimeSlot,
  settings: FactorySettings
): Date {
  // If printer is still available today
  if (slot.currentTime < slot.endOfDayTime) {
    return new Date(slot.currentTime);
  }
  
  // Need to advance to next workday
  const nextStart = advanceToNextWorkdayStart(slot.currentTime, settings);
  return nextStart ?? new Date(slot.currentTime);
}

// ============= CORE: Check if time is within work window =============
/**
 * Checks if a given time falls within working hours.
 * 
 * @param time - Time to check
 * @param workDayStart - Start of work hours
 * @param endOfWorkHours - End of work hours
 * @returns true if within work hours
 */
export function isWithinWorkWindow(
  time: Date,
  workDayStart: Date,
  endOfWorkHours: Date
): boolean {
  return time >= workDayStart && time < endOfWorkHours;
}

// ============= CRITICAL: Central night/autonomous eligibility check =============
/**
 * Single source of truth for "can a cycle start at this time?"
 * Used by BOTH estimateProjectFinishTime and scheduleProjectOnPrinters.
 * 
 * Checks the 3-level control:
 * 1. Factory: afterHoursBehavior === 'FULL_AUTOMATION'
 * 2. Printer: canStartNewCyclesAfterHours === true
 * 3. Preset: allowedForNightCycle !== false
 * 
 * @param time - Proposed cycle start time
 * @param printer - Printer to start on
 * @param preset - Preset to use (optional, for night cycle check)
 * @param settings - Factory settings
 * @param workDayStart - Start of current work day
 * @param endOfWorkHours - End of current work hours
 * @returns true if cycle can start at this time
 */
export function canStartCycleAt(
  time: Date,
  printer: Printer | { canStartNewCyclesAfterHours?: boolean } | null | undefined,
  preset: PlatePreset | null | undefined,
  settings: FactorySettings,
  workDayStart: Date,
  endOfWorkHours: Date
): boolean {
  const isWithinWork = isWithinWorkWindow(time, workDayStart, endOfWorkHours);
  
  // During work hours - always allowed
  if (isWithinWork) {
    return true;
  }
  
  // Outside work hours - check 3-level control
  
  // Level 1: Factory must allow full automation
  if (settings.afterHoursBehavior !== 'FULL_AUTOMATION') {
    return false;
  }
  
  // Level 2: Printer must allow night starts (default to false if not set)
  if (!printer?.canStartNewCyclesAfterHours) {
    return false;
  }
  
  // Level 3: Preset must allow night cycles (default true if not set or no preset)
  if (preset && preset.allowedForNightCycle === false) {
    return false;
  }
  
  return true;
}

// ============= HELPER: Check if time is in night window =============
/**
 * Checks if a time is in the "night" window (after work hours).
 * Used to determine if night-specific rules apply.
 */
export function isNightTime(
  time: Date,
  endOfWorkHours: Date
): boolean {
  return time >= endOfWorkHours;
}

// ============= HELPER: Calculate hours between two times =============
export function hoursBetween(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / (1000 * 60 * 60);
}

// ============= CRITICAL: Actual plate release time =============
/**
 * Determines when a plate actually becomes available.
 * Plates can ONLY be cleared when an operator is present (during work hours).
 * 
 * Rules:
 * - If plate finishes during work hours (08:30-17:30) → released at releaseTime
 * - If plate finishes BEFORE work hours start → released at workDayStart (operator arrives)
 * - If plate finishes AFTER work hours end → released at NEXT workday start
 * 
 * @param releaseTime - When the cycle ends + cleanup time
 * @param workDayStart - Start of current work day (e.g., 08:30)
 * @param endOfWorkHours - End of work day (e.g., 17:30)
 * @param settings - Factory settings for finding next work day
 * @returns Actual time when plate becomes available (when operator can clear it)
 */
export function getActualPlateReleaseTime(
  releaseTime: Date,
  workDayStart: Date,
  endOfWorkHours: Date,
  settings: FactorySettings
): Date {
  // Case 1: Plate finished during work hours → operator is present, release immediately
  if (releaseTime >= workDayStart && releaseTime < endOfWorkHours) {
    return releaseTime;
  }
  
  // Case 2: Plate finished BEFORE work hours started (e.g., 03:00)
  // → operator arrives at workDayStart (08:30 same day) and clears it
  if (releaseTime < workDayStart) {
    return workDayStart;
  }
  
  // Case 3: Plate finished AFTER work hours ended (e.g., 20:00 or weekend)
  // → operator not present until next working day morning
  const nextWorkDayStart = advanceToNextWorkdayStart(releaseTime, settings);
  return nextWorkDayStart ?? releaseTime;
}
