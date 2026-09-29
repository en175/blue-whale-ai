/* ============================================
 * 后台管理 API · 登录身份：当前登录用户是不是管理员。
 *
 * 从 admin.ts 拆出来的域模块（IKJ058）：一个文件一个领域，
 * 读接口自带 `queryOptions` 工厂，页面不必再各自拼 key。
 * ============================================ */
import { http } from './http';

/** GET /api/admin/session 返回：当前登录用户的管理员身份 */
export interface AdminSessionData {
  /** 管理员用户 ID */
  userId: number;
  /** 是否为管理员，true 表示有管理权限 */
  isAdmin: boolean;
}

/** 实时校验当前登录用户是否为管理员（登录态走 HttpOnly cookie） */
export function fetchAdminSession() {
  return http.get<AdminSessionData>('/api/admin/session', { silent: true });
}
