const BEIJING_WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;

export function formatBeijingDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const match = BEIJING_WALL_CLOCK.exec(value);
  if (!match) return value;
  const [, year, month, day, hour, minute, second = '00'] = match;
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}
