/* ============================================
 * 后台管理 API · 用户管理与人工调账。
 *
 * 从 admin.ts 拆出来的域模块（IKJ058）：一个文件一个领域，
 * 读接口自带 `queryOptions` 工厂，页面不必再各自拼 key。
 * ============================================ */
import { apiRequest } from './http';
import { useAuthStore } from '@/stores/auth';

/** 后台用户记录 */
export interface AdminUserRow {
  /** 用户ID */
  userId: number;
  nickname: string;
  phone: string;
  /** 当前积分余额 */
  balance: number;
  /** 累计充值积分总额 */
  totalRecharge: number;
  /** 累计消费积分总额 */
  totalSpend: number;
  /** 角色：1 普通用户 / 10 管理员 / 100 root */
  role: number;
  /** 账户状态：active 正常 / disabled 已冻结 */
  status: 'active' | 'disabled';
  /** 注册时间（ISO） */
  createdAt: string;
  /** 最后更新时间（ISO） */
  updatedAt: string;
}

/** GET /api/admin/users 返回 */
export interface AdminUserListData {
  list: AdminUserRow[];
  /** 符合条件的总记录数 */
  total: number;
}

/** GET /api/admin/users 用户列表（keyword 匹配昵称/手机号/用户ID；status active/disabled；pageSize 最大 100）；请求头 New-Api-User 携带当前管理员 userId */
export function fetchAdminUsers(
  params: { keyword?: string; status?: string; role?: number; page?: number; pageSize?: number } = {}
) {
  const qs = new URLSearchParams();
  if (params.keyword) qs.set('keyword', params.keyword);
  if (params.status) qs.set('status', params.status);
  if (params.role !== undefined) qs.set('role', String(params.role));
  qs.set('page', String(params.page ?? 1));
  qs.set('pageSize', String(params.pageSize ?? 20));
  const adminUserId = useAuthStore.getState().user?.userId;
  return apiRequest<AdminUserListData>(`/api/admin/users?${qs.toString()}`, {
    method: 'GET',
    headers: adminUserId !== undefined ? { 'New-Api-User': String(adminUserId) } : {},
  });
}

/** 用户管理操作类型 */
export type UserManageAction = 'freeze' | 'unfreeze' | 'adjustBalance';

/** POST /api/admin/users/:userId/manage 冻结/解冻/调整积分（reason 必填；adjustBalance 时 value 非零，正增负减），服务端自动写审计日志 */
export function manageAdminUser(
  userId: number,
  params: { action: UserManageAction; reason: string; value?: number }
) {
  return apiRequest<null>(`/api/admin/users/${userId}/manage`, {
    method: 'POST',
    body: JSON.stringify(params),
  });
}
