/* ============================================
 * 管理端 API：积分记录（`GET /api/admin/consumption-records`）
 *
 * ⚠️ 数据源是 **billing 的账本**（经 backend 的 BFF 转出），不是我们的库：
 *    钱只从 billing 的复式账本进出，本地任何一张表都只是它的投影。
 *
 * ⚠️ **游标分页、没有总数**。账本持续追加，要准确总数就得扫全表，而扫完那一刻它又变了。
 *    所以「上一页」必须由调用方自己维护游标栈（见页面的 usePagedCursors）。
 *    与充值记录的 offset 分页形状不同，但翻页控件是同一个组件，观感一致。
 * ============================================ */
import { queryOptions } from '@tanstack/react-query';
import { apiRequest } from './http';

export interface AdminConsumptionRecord {
  /** 形如 `res:7` / `lot:12` / `led:expire:...`，三类来源全局唯一 */
  id: string;
  /** 归属用户。**管理面独有的列**——用户面契约里没有它 */
  user_id: number;
  /**
   * 用户名。BFF 回我们自己的库按 `user_id` 补的——billing 的账本认不出人。
   *
   * ⚠️ 键名是 `nickname`，界面上叫「用户名」，值都是 `bw_users.username`。
   *    键名沿用身份查询那层（`AdminUserIdentity.nickname`）——**三个记录页共用同一份投影**。
   *    （用户管理页走的是另一份 `AdminUserRow`，值同样是 `username`，只是投影不同；
   *    在这里改键只会让同一个值在几个页面叫两个名字。）
   *
   * ⚠️ 可选（`?`）不是多余：与下面的 `reserved_credits` 同一条规矩 —— **后端比前端旧**时
   *    这个键**整个不存在**（老构建压根没投影它），拿到的是 `undefined`。本仓实测过一次
   *    这种半上线形态（2026-09-26）。所以判空只能写 `?? '—'` / `== null`，
   *    写 `=== null` 会漏掉 `undefined` 那一半。
   *
   * `null` = 查不到这个用户（跨库历史、被清理）**或**这个用户没有手机号 —— 后端已经
   * 把两种收敛成了同一种，**没有第二种「没有」**（见控制器里那句 `|| null`）。
   */
  nickname?: string | null;
  /**
   * 手机号。可选性与 `null` 的含义与上面的 `nickname` 逐字相同。
   *
   * 为什么 `null` 是常态而不是异常：`bw_users.phone` 可空，**存量用户没有它**（见
   * `backend/prisma/schema.prisma` 里 `phone` 那段注释）——老用户那一列本来就该显示「—」。
   */
  phone?: string | null;
  type: string;
  /** in | out */
  direction: string;
  title: string;
  /** **整数积分**，该行唯一的金额：pending 时是预计消耗，done 时是实际消耗 */
  credits: number;
  /**
   * 该行**当初冻了多少**（整数积分）。**只有消费行有值**，发放行与账本行为「没有」。
   *
   * ⚠️ 「没有」在线上有**两种**形态，缺一不可判：
   *    - `null` —— 后端按契约显式回的（BFF 那句 `?? null` 就是为此）
   *    - **键根本不存在** —— 后端是**比前端旧的构建**时就是这样：老版本压根没投影这一列。
   *      前端先上、后端后上（或回滚）就会出现，实测 2026-09-26 撞过一次，整页白屏。
   *
   * ⚠️ 所以判空只能写 `== null`（**不要**写 `=== null`，更不要写 `if (reserved)`）：
   *    - `=== null` 漏掉 `undefined` ⇒ 把一个「没有」当成「有值」渲染 ⇒ `.toLocaleString()` 崩
   *    - 真值判断会把 `0` 当成「没有预扣」而不显示，恰好漏掉「全额退回」那一行
   *
   * 为什么要有它：done 之后 `credits` 已经是实际值，「当初冻了多少」就只剩这里能读。
   * 用户余额先降后回的差额靠它解释（实测某任务冻 12、实扣 1，流水上只有一行 -1）。
   * 未结算行（pending）的 `credits` 本就是预扣额，两个数相同。
   */
  reserved_credits?: number | null;
  /**
   * 该行关联任务的**类型**（`generation_jobs.type`，如 `text2video`）。
   *
   * ⚠️ 「没有」的两种形态与 `reserved_credits` 逐字相同（见上），判空一律 `== null`。
   *    这一组有**三种**「没有」，且含义不同，界面上要分开对待：
   *      - 整组为「没有」→ 这一行不是消费任务（发放 / 账本），或后端是旧构建
   *      - `task_type` 有值但 `model_id` 为「没有」→ 免费工具族天生没有模型，**不是查不到**
   *      - `task_type` 有值但 `prompt` 为「没有」→ 这个任务就没写提示词
   *
   * 展示口径：任务类型用 `taskTypeLabel()`（见页面），模型用 `model_label ?? model_id ?? '—'`，
   * **不要在前端拼模型名**——中文名维护在 `generation_model_capability.model_label`，
   * 拼出来的名字与「模型列表」页对不上，运营会以为是两个模型。
   */
  task_type?: string | null;
  /** 该行关联任务用的模型 id（`input.model_id`）；免费工具族为「没有」 */
  model_id?: string | null;
  /** 模型的展示名；能力表查不到时为「没有」（此时前端回落显示 `model_id`） */
  model_label?: string | null;
  /** 该行关联任务的提示词原文（`input.prompt`）。**全文返回**，由界面决定怎么展示 */
  prompt?: string | null;
  /** pending | done */
  status: string;
  created_at: string;
  /** RFC3339；未结算为空串（**不是 null**，契约如此） */
  settled_at: string;
}

export interface AdminConsumptionRecordListData {
  items: AdminConsumptionRecord[];
  /** 空串 = 没有下一页 */
  next_page_token: string;
}

export interface AdminConsumptionRecordQuery {
  /**
   * 用户 ID / 手机号 / 用户名，**都要完整**（服务端精确匹配，收敛到唯一一个人）。
   * 空 = **全站消费**。
   *
   * ⚠️ 与用户管理页那个 `keyword` 是**两种东西**：那边是模糊匹配（多命中几行没关系），
   *    这边必须唯一命中——账本按 `user_id` 过滤，服务端也只收一个。同样的输入在两页
   *    行为不同，所以这里的 placeholder 得写明「需完整」。
   */
  keyword?: string;
  /** 单值（consume | recharge | ...）；空 = 全部。多值会被 billing 拒成 400 */
  type?: string;
  pageSize: number;
  /** 上一页给的 next_page_token，原样回传；空 = 首页 */
  pageToken: string;
}

export const adminConsumptionRecordKeys = {
  all: ['admin-consumption-records'] as const,
  list: (query: AdminConsumptionRecordQuery) =>
    [...adminConsumptionRecordKeys.all, query] as const,
};

export function fetchAdminConsumptionRecords(
  query: AdminConsumptionRecordQuery,
): Promise<AdminConsumptionRecordListData> {
  const qs = new URLSearchParams();
  qs.set('pageSize', String(query.pageSize));
  if (query.keyword) qs.set('keyword', query.keyword);
  if (query.type) qs.set('type', query.type);
  if (query.pageToken) qs.set('pageToken', query.pageToken);
  return apiRequest<AdminConsumptionRecordListData>(
    `/api/admin/consumption-records?${qs.toString()}`,
    { silent: true },
  );
}

export function adminConsumptionRecordsOptions(query: AdminConsumptionRecordQuery) {
  return queryOptions({
    queryKey: adminConsumptionRecordKeys.list(query),
    queryFn: () => fetchAdminConsumptionRecords(query),
  });
}
