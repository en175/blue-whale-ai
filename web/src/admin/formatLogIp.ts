export function formatLogIp(ip: string | null | undefined): string {
  const value = ip?.trim();
  return value ? value : '—';
}
