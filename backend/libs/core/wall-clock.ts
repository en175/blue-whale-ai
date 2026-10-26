function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

function calendarDay(value: Date): string {
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function clock(value: Date, withSeconds: boolean): string {
  const base = `${pad(value.getHours())}:${pad(value.getMinutes())}`;
  return withSeconds ? `${base}:${pad(value.getSeconds())}` : base;
}

export function wallClockOffset(value: Date): string {
  const minutes = -value.getTimezoneOffset();
  const sign = minutes < 0 ? "-" : "+";
  const absolute = Math.abs(minutes);
  return `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

export function wallClockRfc3339(value: Date): string {
  return `${calendarDay(value)}T${clock(value, true)}${wallClockOffset(value)}`;
}

export function wallClockRfc3339OrNull(value: Date | null | undefined): string | null {
  return value == null ? null : wallClockRfc3339(value);
}

export function wallClockDay(value: Date): string {
  return calendarDay(value);
}

export function wallClockHuman(value: Date): string {
  return `${calendarDay(value)} ${clock(value, false)}`;
}

export function wallClockMillis(value: Date): string {
  return `${calendarDay(value)}T${clock(value, true)}.${pad(value.getMilliseconds(), 3)}${wallClockOffset(value)}`;
}

const WALL_CLOCK_ISO = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/;

export function wallClockHumanFromIso(value: string): string {
  const matched = WALL_CLOCK_ISO.exec(value);
  return matched ? `${matched[1]} ${matched[2]}` : value;
}
