const SPEC_KEYS = ['resolution', 'size', 'duration', 'aspect_ratio'] as const;

export function formatSpecs(specs: Record<string, string> | null): string {
  if (!specs) return '—';
  const parts: string[] = [];
  for (const key of SPEC_KEYS) {
    const raw = specs[key];
    if (raw == null || raw === '') continue;
    if (key === 'duration') {
      if (Number(raw) <= 0) continue;
      parts.push(`${raw}s`);
    } else {
      parts.push(raw);
    }
  }
  return parts.length > 0 ? parts.join(' · ') : '—';
}

const BEIJING_WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;

export function formatBeijingDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const match = BEIJING_WALL_CLOCK.exec(value);
  if (!match) return value;
  const [, year, month, day, hour, minute, second = '00'] = match;
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}
