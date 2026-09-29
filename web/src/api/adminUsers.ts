/* ============================================
 * 后台管理 API · 用户管理与人工调账。
 *
 * 从 admin.ts 拆出来的域模块（IKJ058）：一个文件一个领域，
 * 读接口自带 `queryOptions` 工厂，页面不必再各自拼 key。
 * ============================================ */
import { queryOptions } from '@tanstack/react-query';
import { apiRequest } from './http';
import { useAuthStore } from '@/stores/auth';

/** 后台用户记录 */
export interface AdminUserRow {
  /** 用户ID */
  userId: number;
  nickname: string;
  phone: string;
  /** 当前**可用**积分（不含被在途任务冻结的部分）。整数积分，不是元 */
  balance: number;
  /** 累计充值：**只算充值本金**（purchased 批次），不含充值赠送。整数积分 */
  totalRecharge: number;
  /** 累计消费：**已结算**的实际消耗，不含在途任务的预扣。整数积分 */
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

/**
 * GET /api/admin/users 用户列表（keyword 匹配昵称/手机号，**整串数字时另按用户 ID 精确匹配**；status active/disabled）；请求头 New-Api-User 携带当前管理员 userId
 *
 * <p>⚠️ 曾经支持过 `role` 入参，但服务端从不读它 —— 传了也只会拿到**未过滤**的列表。
 * IKJ69L 已把两边一并删掉；等真的做角色筛选 UI 时再连通，别提前留一个骗人的参数。
 */
export function fetchAdminUsers(
  params: { keyword?: string; status?: string; page?: number; pageSize?: number } = {}
) {
  const qs = new URLSearchParams();
  if (params.keyword) qs.set('keyword', params.keyword);
  if (params.status) qs.set('status', params.status);
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

/** 加积分的结果。`duplicated` = 幂等命中：这笔之前发过了，本次没有重复发放。 */
export interface AdjustBalanceResult {
  /** 本次实际发放的整数积分。**幂等命中时为 `null`** —— 那一次什么都没发，
   *  而「本次请求值」可能已被改过，回它等于谎报一个账本里没有的金额。 */
  credits: number | null;
  duplicated: boolean;
}

/**
 * POST /api/admin/users/:userId/manage 冻结/解冻/加积分（reason 必填）；服务端自动写审计日志。
 *
 * `adjustBalance` 时 `value` 须为**正整数**（本接口只加不减），且**必须带
 * `idempotencyKey`**：服务端拿它当 billing 发放的幂等键，缺了直接 400。少了它，
 * 「网络超时 → 管理员再点一次」就是发两笔，而两笔在账本上都合法，事后分不出哪笔是重试。
 *
 * 钥匙**一次用户意图一把**（`./idempotencyKey` 的 `newIdempotencyKey`），在该次意图的
 * 重试路径上复用；不要在请求函数里现造 —— 那样服务端每次拿到的都是新钥匙，等于没有幂等。
 *
 * 返回值按 action 分叉：`freeze` → `{ revokedSessions }`，`adjustBalance` →
 * {@link AdjustBalanceResult}，`unfreeze` → `null`。调用方按自己的 action 取。
 */
export function manageAdminUser(
  userId: number,
  params: {
    action: UserManageAction;
    reason: string;
    value?: number;
    idempotencyKey?: string;
  }
) {
  const { idempotencyKey, ...body } = params;
  return apiRequest<AdjustBalanceResult | { revokedSessions: number } | null>(
    `/api/admin/users/${userId}/manage`,
    {
      method: 'POST',
      body: JSON.stringify(body),
      ...(idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}),
    }
  );
}

// ---------- TanStack Query 工厂 ----------

/**
 * 用户列表。
 *
 * <p>⚠️ `params` **整份进 key**（含分页与关键词）：它是服务端筛选的入参，
 * 不是本地对同一份数据的过滤 —— 放不进 key 就会出现「换了关键词但命中缓存旧结果」。
 */
export const adminUserKeys = {
  all: ['admin-users'] as const,
  list: (params: Parameters<typeof fetchAdminUsers>[0]) =>
    [...adminUserKeys.all, 'list', params ?? {}] as const,
};

export function adminUsersOptions(params: Parameters<typeof fetchAdminUsers>[0] = {}) {
  return queryOptions({
    queryKey: adminUserKeys.list(params),
    queryFn: () => fetchAdminUsers(params),
  });
}
