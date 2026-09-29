import type { AdminUserRow } from '@/api/adminUsers';

/** 去掉前后空白和前导 #，避免列表曾展示 #ID 时把井号一并搜进去 */
export function normalizeAdminUserKeyword(keyword: string): string {
  return keyword.trim().toLowerCase().replace(/^#+/, '');
}

/** 本地筛选：昵称 / 手机号 / 用户 ID；用户 ID 按数字匹配，不把 # 算进关键词 */
export function matchesAdminUserKeyword(
  user: Pick<AdminUserRow, 'nickname' | 'phone' | 'userId'>,
  keyword: string,
): boolean {
  const kw = normalizeAdminUserKeyword(keyword);
  if (!kw) return true;
  return (
    user.nickname.toLowerCase().includes(kw) ||
    user.phone.includes(kw) ||
    String(user.userId).includes(kw)
  );
}
