// ============= SCHEDULING HELPERS =============
// Shared utility functions for both estimation and scheduling
// Ensures consistency between dry-run simulation and actual scheduling

import { 
  FactorySettings, 
  Printer, 
  getDayScheduleForDate,
  PlatePreset,
  WeeklySchedule
} from './storage';

// ============= PLATE RELEASE INFO =============
export interface PlateReleaseInfo {
  releaseTime: Date;  // This is doneTime (cycleEnd + cleanupMinutes)
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
  
  // ============= COLOR TRACKING (per official spec) =============
  // CRITICAL: physicalLockedColor is the PHYSICAL color mounted on the printer.
  // This is the source of truth for night color lock checks.
  // It can ONLY change when operator is present (during work hours).
  physicalLockedColor?: string;  // The actual mounted color (from printer.mountedColor or spool)
  
  // lastScheduledColor tracks what color was last PLANNED on this printer.
  // This is for optimization/grouping during normal hours, NOT for night locks.
  lastScheduledColor?: string;
  
  // NEW: Debug field - explains why endOfDayTime was set
  endOfDayTimeSource?: EndOfDayTimeSource;
  endOfDayTimeReason?: string;  // Additional human-readable reason
  // NEW: Pre-loaded plates for overnight/weekend runs
  // IMPORTANT: This is a PLANNING DECISION, not hardware!
  // Calculated at end of work hours based on:
  // - Night window hours available
  // - Average cycle duration
  // - Physical capacity as upper limit
  preLoadedPlatesRemaining?: number;  // Optional - defaults to 0
  // Track when plates were pre-loaded (for debugging)
  preLoadedAt?: Date;
  
  // Flag for autonomous day (weekends/holidays with no operator)
  isAutonomousDay?: boolean;
  
  // ============= LOOP PREVENTION FLAG =============
  // Set to true when slot has already been advanced to a workday during initialization.
  // Prevents the project loop from re-advancing the same slot repeatedly.
  advancedToWorkday?: boolean;
  
  // CONDITION 1 FIX: Prevent infinite loop in night scheduling
  // When a printer is marked ineligible for tonight (e.g., no physical color),
  // set this to the end of the night window. The scheduler will skip this printer
  // until this time is reached, preventing repeated failed attempts.
  nightIneligibleUntil?: Date;
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
 * NOTE: This function starts searching from the NEXT DAY.
 * If you need same-day work start (for "before work hours" case), 
 * use getNextOperatorTime instead.
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

// ============= CRITICAL: Check if operator is present =============
/**
 * Checks if an operator is physically present at the given time.
 * Operators are ONLY present during work hours of ENABLED days.
 * 
 * This is the KEY check for determining if NEW cycles can be loaded.
 * - Even with FULL_AUTOMATION, an operator must load the first plate
 * - Running cycles can finish overnight, but NEW cycles need an operator
 * 
 * @param time - The time to check
 * @param settings - Factory settings with work schedule
 * @returns true if operator is present and can load/unload plates
 */
export function isOperatorPresent(
  time: Date,
  settings: FactorySettings
): boolean {
  // Get schedule for this specific day
  const dayNames: (keyof WeeklySchedule)[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayName = dayNames[time.getDay()];
  const schedule = getDayScheduleForDate(time, settings, []);
  
  // Not a working day → no operator
  if (!schedule?.enabled) {
    return false;
  }
  
  // Calculate work hours for this day
  const workStart = createDateWithTime(time, schedule.startTime);
  const workEnd = createDateWithTime(time, schedule.endTime);
  
  // Handle cross-midnight shifts
  let adjustedWorkEnd = workEnd;
  const startMinutes = parseTime(schedule.startTime).hours * 60 + parseTime(schedule.startTime).minutes;
  const endMinutes = parseTime(schedule.endTime).hours * 60 + parseTime(schedule.endTime).minutes;
  if (endMinutes < startMinutes) {
    adjustedWorkEnd = new Date(workEnd.getTime() + 24 * 60 * 60 * 1000);
  }
  
  // Operator is present only during work hours
  return time >= workStart && time < adjustedWorkEnd;
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

// ============= HELPER: Get end of current night window =============
/**
 * Given a time in the night window, returns the end of that night.
 * This is the next workday start time.
 * Used to set nightIneligibleUntil for printers that can't work at night.
 */
export function getEndOfNightWindow(
  currentTime: Date,
  settings: FactorySettings
): Date {
  // The end of the night window is the start of the next workday
  const nextWorkday = advanceToNextWorkdayStart(currentTime, settings);
  if (nextWorkday) {
    return nextWorkday;
  }
  // Fallback: add 12 hours (shouldn't happen with valid settings)
  return new Date(currentTime.getTime() + 12 * 60 * 60 * 1000);
}

// ============= HELPER: Calculate hours between two times =============
export function hoursBetween(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / (1000 * 60 * 60);
}

// ============= CRITICAL: Get next operator time =============
/**
 * Given a "done time" (when plate finishes + cleanup), returns the earliest time
 * an operator can physically clear the plate.
 * 
 * This function is SELF-CONTAINED and does NOT rely on slot boundaries.
 * It calculates the work schedule for the specific day the plate finished.
 * 
 * Rules:
 * - If doneTime is during work hours of a working day → return doneTime (operator present)
 * - If doneTime is BEFORE work hours of a working day → return workDayStart (operator arrives)
 * - If doneTime is AFTER work hours OR on a non-working day → return next working day start
 * 
 * @param doneTime - When the plate is physically done (cycleEnd + cleanupMinutes)
 * @param settings - Factory settings with work schedule
 * @returns Time when operator can clear the plate
 */
export function getNextOperatorTime(
  doneTime: Date,
  settings: FactorySettings
): Date {
  // Step 1: Get the schedule for the ACTUAL day the plate finished
  const schedule = getDayScheduleForDate(doneTime, settings, []);
  
  // If it's not a working day → find next working day start
  if (!schedule?.enabled) {
    const nextWorkDay = advanceToNextWorkdayStart(doneTime, settings);
    return nextWorkDay ?? doneTime;
  }
  
  // Step 2: Calculate work hours for THAT specific day
  const workDayStart = createDateWithTime(doneTime, schedule.startTime);
  const endOfWorkHours = createDateWithTime(doneTime, schedule.endTime);
  
  // Step 3: Determine when operator can clear the plate
  
  // Case A: doneTime is during work hours → operator is present, can clear immediately
  if (doneTime >= workDayStart && doneTime < endOfWorkHours) {
    return doneTime;
  }
  
  // Case B: doneTime is BEFORE work hours started (e.g., plate finished at 03:00)
  // → operator arrives at workDayStart and clears it
  if (doneTime < workDayStart) {
    return workDayStart;
  }
  
  // Case C: doneTime is AFTER work hours ended (e.g., 20:00)
  // → wait for next working day's start
  const nextWorkDay = advanceToNextWorkdayStart(doneTime, settings);
  return nextWorkDay ?? doneTime;
}

// ============= DEPRECATED: Use getNextOperatorTime instead =============
/**
 * @deprecated Use getNextOperatorTime(doneTime, settings) instead.
 * This function incorrectly relies on slot boundaries which may not match
 * the actual day the plate finished.
 * 
 * Kept for backwards compatibility - now just forwards to getNextOperatorTime.
 */
export function getActualPlateReleaseTime(
  releaseTime: Date,
  workDayStart: Date,
  endOfWorkHours: Date,
  settings: FactorySettings
): Date {
  // Forward to new implementation - ignores workDayStart/endOfWorkHours params
  return getNextOperatorTime(releaseTime, settings);
}

// ============= NIGHT WINDOW =============

export type NightMode = 'none' | 'one_cycle' | 'full';

export interface NightWindow {
  start: Date;           // End of work hours
  end: Date;             // Start of next workday
  totalHours: number;    // Hours available in night window
  isWeekendNight: boolean; // Friday→Sunday type night
  mode: NightMode;       // After-hours behavior mode
}

/**
 * Get the night window for a given date based on factory settings.
 * 
 * Returns a NightWindow object that includes:
 * - start: When work hours end
 * - end: When next workday starts
 * - totalHours: Duration of night window
 * - mode: 'none' | 'one_cycle' | 'full' based on afterHoursBehavior
 * 
 * The mode determines what's allowed:
 * - 'none': No after-hours work (afterHoursBehavior = 'NONE')
 * - 'one_cycle': Only one cycle after hours (afterHoursBehavior = 'ONE_CYCLE_END_OF_DAY')
 * - 'full': Full automation until next workday (afterHoursBehavior = 'FULL_AUTOMATION')
 * 
 * @param date - The date to get night window for
 * @param settings - Factory settings with schedule and afterHoursBehavior
 * @returns NightWindow with mode, even for 'none' mode
 */
export function getNightWindow(
  date: Date,
  settings: FactorySettings
): NightWindow {
  // Get schedule for this day
  const schedule = getDayScheduleForDate(date, settings, []);
  
  // Get day name for logging
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayOfWeek = date.getDay();
  const dayName = dayNames[dayOfWeek];
  
  // Determine mode from afterHoursBehavior
  let mode: NightMode = 'none';
  if (settings.afterHoursBehavior === 'FULL_AUTOMATION') {
    mode = 'full';
  } else if (settings.afterHoursBehavior === 'ONE_CYCLE_END_OF_DAY') {
    mode = 'one_cycle';
  }
  
  // ============= NIGHT WINDOW DEBUG LOG =============
  // Log raw schedule data for debugging
  console.log('[NightWindow] 📋 Raw schedule data:', {
    date: date.toISOString().split('T')[0],
    dayOfWeek: dayName,
    schedule: schedule ? { enabled: schedule.enabled, startTime: schedule.startTime, endTime: schedule.endTime } : null,
    rawWeeklySchedule: settings.weeklySchedule,
    afterHoursBehavior: settings.afterHoursBehavior,
    mode,
  });
  
  // If no schedule or not a working day, return minimal window
  if (!schedule?.enabled) {
    const nextWorkday = advanceToNextWorkdayStart(date, settings);
    const result = {
      start: date,
      end: nextWorkday ?? addDays(date, 1),
      totalHours: 0,
      isWeekendNight: true,
      mode,
    };
    console.log('[NightWindow] 📋 Non-working day result:', {
      nightStart: result.start.toISOString(),
      nightEnd: result.end.toISOString(),
      totalHours: result.totalHours,
    });
    return result;
  }
  
  // Calculate end of work hours
  const endOfWorkHours = createDateWithTime(date, schedule.endTime);
  
  // Handle cross-midnight shifts
  const startMinutes = parseTime(schedule.startTime).hours * 60 + parseTime(schedule.startTime).minutes;
  const endMinutes = parseTime(schedule.endTime).hours * 60 + parseTime(schedule.endTime).minutes;
  let adjustedEndOfWork = endOfWorkHours;
  if (endMinutes < startMinutes) {
    adjustedEndOfWork = new Date(endOfWorkHours.getTime() + 24 * 60 * 60 * 1000);
  }
  
  // Find next workday start (from end of work hours, not from date)
  const nextWorkday = advanceToNextWorkdayStart(adjustedEndOfWork, settings);
  const nightEnd = nextWorkday ?? addDays(adjustedEndOfWork, 1);
  
  // Calculate total hours
  const totalHours = (nightEnd.getTime() - adjustedEndOfWork.getTime()) / (1000 * 60 * 60);
  
  // Check if this is a weekend night (e.g., Thursday→Sunday in Israel, Friday→Monday elsewhere)
  // Weekend nights: Friday (5), Saturday (6) in most locales
  // For Israel: Thursday (4) night goes into Saturday
  const isWeekendNight = dayOfWeek === 4 || dayOfWeek === 5 || dayOfWeek === 6;
  
  // ============= NIGHT WINDOW CALCULATION LOG =============
  console.log('[NightWindow] 📋 Calculated night window:', {
    date: date.toISOString().split('T')[0],
    dayName,
    workSchedule: { start: schedule.startTime, end: schedule.endTime },
    nightStart: adjustedEndOfWork.toISOString(),
    nightEnd: nightEnd.toISOString(),
    totalHours: Math.round(totalHours * 10) / 10,
    isWeekendNight,
    mode,
    note: `Work ends at ${schedule.endTime}, night starts immediately after`,
  });
  
  return {
    start: adjustedEndOfWork,
    end: nightEnd,
    totalHours: Math.max(0, totalHours),
    isWeekendNight,
    mode,
  };
}
