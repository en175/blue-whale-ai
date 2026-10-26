export const SESSION_EXPIRED_MESSAGE = '登录已过期，请重新验证';
export const SESSION_EVICTED_MESSAGE = '登录已失效，账号已在其他浏览器登录，请重新验证';
export const ACCOUNT_DISABLED_MESSAGE = '账号已停用';
export const BROWSER_LOGOUT_MESSAGE = '已退出当前浏览器';

export function loginPromptFor(errorCode?: string): string {
  if (errorCode === 'session_evicted') return SESSION_EVICTED_MESSAGE;
  return SESSION_EXPIRED_MESSAGE;
}

export function shouldDropForeignDrafts(
  previousUserId: number | null,
  nextUserId: number | null,
): boolean {
  return previousUserId != null && nextUserId != null && previousUserId !== nextUserId;
}
