/**
 * Feedback Window Gate — time-based safety gate for feedback processing
 *
 * Ensures feedback ingestion and lifecycle actions only run during safe hours.
 * Per M6 decision: feedback processing allowed only 03:00-06:00 Europe/Madrid.
 *
 * Part of M6 – Sheets Feedback Loop & Company Lifecycle
 */

import type { FeedbackWindowCheck } from "@/types";
import {
  FEEDBACK_WINDOW_START_HOUR,
  FEEDBACK_WINDOW_END_HOUR,
  FEEDBACK_WINDOW_TIMEZONE,
} from "@/constants";

/**
 * Get the current hour in a specific timezone
 *
 * Uses Intl.DateTimeFormat API to convert Date to target timezone
 * and extract the hour component.
 *
 * @param date - Date to check (defaults to now)
 * @param timezone - IANA timezone identifier
 * @returns Hour in 24-hour format (0-23)
 */
function getHourInTimezone(date: Date, timezone: string): number {
  // Use Intl API to format date in target timezone
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    hour12: false,
  });

  const hourString = formatter.format(date);
  return parseInt(hourString, 10);
}

/**
 * Check if current time is within feedback processing window
 *
 * Pure function that determines whether feedback ingestion should run
 * based on the current time in Europe/Madrid timezone.
 *
 * Window: 03:00:00 - 05:59:59 (inclusive start, exclusive end)
 *
 * @param now - Optional Date to check (defaults to current time, used for testing)
 * @returns Boolean indicating if within allowed window
 */
export function isWithinFeedbackWindow(now: Date = new Date()): boolean {
  const currentHour = getHourInTimezone(now, FEEDBACK_WINDOW_TIMEZONE);
  return (
    currentHour >= FEEDBACK_WINDOW_START_HOUR &&
    currentHour < FEEDBACK_WINDOW_END_HOUR
  );
}

/**
 * Check if feedback ingestion should run and return structured result
 *
 * Pure function that provides detailed information about whether
 * feedback processing is allowed, including human-readable reason.
 *
 * Deterministic: same input time always produces same output.
 *
 * @param now - Optional Date to check (defaults to current time, used for testing)
 * @returns Structured check result with allowed flag and reason
 */
export function shouldRunFeedbackIngestion(
  now: Date = new Date(),
): FeedbackWindowCheck {
  const currentHour = getHourInTimezone(now, FEEDBACK_WINDOW_TIMEZONE);
  const allowed = isWithinFeedbackWindow(now);

  if (allowed) {
    return {
      allowed: true,
      reason: `Within feedback window (${FEEDBACK_WINDOW_START_HOUR}:00-${FEEDBACK_WINDOW_END_HOUR}:00 ${FEEDBACK_WINDOW_TIMEZONE})`,
      currentHour,
      timezone: FEEDBACK_WINDOW_TIMEZONE,
    };
  } else {
    return {
      allowed: false,
      reason: `Outside feedback window (${FEEDBACK_WINDOW_START_HOUR}:00-${FEEDBACK_WINDOW_END_HOUR}:00 ${FEEDBACK_WINDOW_TIMEZONE}), current hour: ${currentHour}:xx`,
      currentHour,
      timezone: FEEDBACK_WINDOW_TIMEZONE,
    };
  }
}
