export function normalizeAdminUserKeyword(keyword: string): string {
  return keyword.trim().toLowerCase().replace(/^#+/, '');
}
