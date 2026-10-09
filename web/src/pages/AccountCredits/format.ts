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
