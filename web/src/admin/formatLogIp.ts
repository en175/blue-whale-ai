/** 操作日志操作人 IP：接口空/缺失时展示为破折号。 */
export function formatLogIp(ip: string | null | undefined): string {
  const value = ip?.trim();
  return value ? value : '—';
}
