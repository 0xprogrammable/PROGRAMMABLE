const SECOND_MS = 1_000;
const MINUTE_SECONDS = 60;
const HOUR_SECONDS = 60 * MINUTE_SECONDS;
const DAY_SECONDS = 24 * HOUR_SECONDS;

export type HookathonCountdownParts = Readonly<{
  totalMilliseconds: number;
  totalSeconds: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  ended: boolean;
}>;

function requireFiniteTimestamp(value: number, label: string) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite timestamp`);
  }
}

export function timestampFromIso(value: string) {
  const timestamp = Date.parse(value);
  requireFiniteTimestamp(timestamp, "ISO date");
  return timestamp;
}

export function getHookathonCountdown(
  deadlineMs: number,
  nowMs: number,
): HookathonCountdownParts {
  requireFiniteTimestamp(deadlineMs, "Deadline");
  requireFiniteTimestamp(nowMs, "Current time");

  const rawMilliseconds = deadlineMs - nowMs;
  const totalMilliseconds = Math.max(0, rawMilliseconds);
  const totalSeconds = Math.ceil(totalMilliseconds / SECOND_MS);
  const days = Math.floor(totalSeconds / DAY_SECONDS);
  const afterDays = totalSeconds % DAY_SECONDS;
  const hours = Math.floor(afterDays / HOUR_SECONDS);
  const afterHours = afterDays % HOUR_SECONDS;
  const minutes = Math.floor(afterHours / MINUTE_SECONDS);
  const seconds = afterHours % MINUTE_SECONDS;

  return {
    totalMilliseconds,
    totalSeconds,
    days,
    hours,
    minutes,
    seconds,
    ended: rawMilliseconds <= 0,
  };
}

export function formatHookathonDeadline(
  deadlineIso: string,
  timeZone: "Europe/Zurich",
) {
  const deadline = new Date(timestampFromIso(deadlineIso));

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone,
    timeZoneName: "short",
  }).format(deadline);
}
