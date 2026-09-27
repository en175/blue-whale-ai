import type { PrismaClient } from "@prisma/client";

/** 充值订单 repo（Prisma-backed）。
 *
 *  ⚠️ 到账判定一律走这里的两条唯一索引与 `markPaidPending` / `markPaid` 的条件更新，
 *  **不靠**「网关只推一次」这种假设：回调会重投，重复发积分是直接的资金损失。 */

/**
 * 订单状态（PRD §9.1）。
 *
 * <p>2026-09-26 由 4 态扩到 6 态。拆出 `paid_pending` 是为了让「**钱到了但积分没发成功**」
 * 第一次可表达：在此之前那种单停在 `pending`，与「用户还没付钱」长得一模一样，客服分不出来。
 *
 * <p>⚠️ **刻意没有「已退款」**：退款功能先不做。一个没有出口的状态就是死状态。
 */
export const RECHARGE_ORDER_STATUS = {
  /** 待支付 */
  pending: "pending",
  /** 支付成功、待到账 */
  paidPending: "paid_pending",
  /** 已到账（积分已发放） */
  paid: "paid",
  /** 支付失败 */
  failed: "failed",
  /** 已取消（用户取消或超时；沿用旧值不改名：改名要迁存量行，而它本身没有语义变化） */
  expired: "expired",
  /** 到账异常（发放反复失败，需人工介入；由后续对账任务写入） */
  grantFailed: "grant_failed",
} as const;

export type RechargeOrderStatus =
  (typeof RECHARGE_ORDER_STATUS)[keyof typeof RECHARGE_ORDER_STATUS];

/**
 * 全部状态，**全仓唯一一份**：管理端筛选白名单与行投影共用它。
 *
 * <p>两个调用点各写各的数组时，漏掉一种状态不会报错，只会让那种单静默消失
 * （筛选器收不了它、列表把它显示成别的状态）——这类缺陷没有任何报错可追。
 */
export const RECHARGE_ORDER_STATUSES: readonly RechargeOrderStatus[] = Object.values(
  RECHARGE_ORDER_STATUS,
);

/**
 * 「钱到了」的下界：`paid_pending`、`paid` 与 `grant_failed` 都算。
 *
 * <p>⚠️ 判「钱到没到」一律写「>= 待到账」，不要写 `= paid`：`paid_pending` 是
 * 「钱到了、积分还没发」，把它当成「没收到钱」会让一笔已付款的订单被当成新单重走一遍。
 *
 * <p>⚠️ `grant_failed` 也在里面（2026-09-27 主动对账落地时加）：它是 `paid_pending` 的
 * **后继**状态 —— 钱到了、只是反复发放失败被人标了出来，钱并没有退回去。漏掉它会同时坏两件事：
 *   · 仪表盘的**实收金额**低报（已收到的钱被算成没收到，见 `dashboard.service`）；
 *   · 回调重投时 `markPaidPending` 会把异常单**推回** `paid_pending`，顺手刷新
 *     `paid_pending_at`——而主动对账正是靠那一列算「持有分钟数」的。
 */
export const PAID_REACHED_STATUSES: readonly RechargeOrderStatus[] = [
  RECHARGE_ORDER_STATUS.paidPending,
  RECHARGE_ORDER_STATUS.grantFailed,
  RECHARGE_ORDER_STATUS.paid,
];

/**
 * 订单快照（PRD §9.3）里此刻还是常量的那几列。
 *
 * <p>首购两列写 `unknown` / `0`（#40 首购加赠上线时才变成计算值），有效期默认写 `null`
 * （永久）：档位单的 2 年有效期是 #43 的事，**自定义充值单不走这个默认值** ——
 * PRD §7.4 明确要求自定义充值订单快照有效期，那条路径用
 * `RechargeService.buildCustomOrderSnapshot` 显式传 `creditsExpireAt`。
 * 取值集中在写入侧一处，是为了那几件事落地时只改这里，不必再动表。
 */
export const RECHARGE_ORDER_SNAPSHOT_DEFAULTS = {
  productType: "tier",
  productName: "",
  bonusCredits: 0,
  creditsExpireAt: null,
  firstPurchaseState: "unknown",
  firstPurchaseEligible: 0,
  permissionResult: "allowed",
} as const;

export interface RechargeOrderView {
  tradeNo: string;
  /** 支付网关订单号；下单应答回来前为 null */
  payOrderId: string | null;
  /**
   * 银行统一收银台链接（下单应答里的 `payData`，内嵌银行令牌）。
   *
   * <p>落在库里是为了**复用未支付订单**：用户再次点「立即支付」时把同一条链接还给他，
   * 而不是新建一笔单、再打一次网关（PRD §7.5「服务端避免重复有效订单」）。
   * 网关**不允许**同一个 `mchOrderNo` 再下一次单（`Uni_MchNo_MchOrderNo`，
   * 重下会应答「商户订单[x]已存在」），所以链接只能存下来、不能事后重新要一个。
   *
   * <p>⚠️ null 有两种含义，判「能不能复用」时要分开（判定见 `recharge-active-order.ts`）：
   * `payOrderId` 也为 null = 这张单**从来没拿到过**链接（下单时网关调用就失败了）；
   * `payOrderId` 有值 = 链接本来有，只是这一列上线前没记（存量单）。
   */
  cashierUrl: string | null;
  userId: string;
  /**
   * 档位 ID；**自定义充值（`productType === "custom"`）为 null**。
   *
   * <p>⚠️ 判「是不是档位商品」一律看 {@link productType}，不看这一列 ——
   * 列的 NULL 只说明「这单没有档位」，不说明商品类型（将来的第三种无档位商品也是 NULL）。
   */
  tierId: string | null;
  /** 实付金额，单位分 */
  amountFen: number;
  /** 下单时冻结的到账积分 */
  credits: number;
  creditsPerYuan: number;
  /**
   * 商品类型快照：`tier` 固定积分卡 | `custom` 自定义充值。
   *
   * <p>⚠️ **判商品类型一律看它，不看 `tierId`** —— 后者为 null 只说明「这单没有档位」，
   * 不说明是不是自定义充值（将来的第三种无档位商品也是 null）。
   */
  productType: string;
  /** 商品名称快照（如「轻量尝鲜」「自定义充值」）。管理端列表靠它区分自定义充值单 */
  productName: string;
  status: RechargeOrderStatus;
  paidAt: string | null;
  grantLotId: string | null;
  notifyCount: number;
  createdAt: string;
  /**
   * **首次**进入「支付成功待到账」的时刻；主动对账据此算「持有分钟数」。
   *
   * <p>不能用 `gmt_modified` 顶替：回调到达、查单名额都会改它。也不能用 `paid_at`
   * （那是「积分发成功」的时刻，而这里要的是「钱到的时刻」）。
   *
   * <p>null = 本列上线前进入该状态的存量单（那时没有这一列）。
   */
  paidPendingAt: string | null;
}

export interface CreateRechargeOrderInput {
  tradeNo: string;
  userId: number;
  /**
   * 档位 ID；**自定义充值传 null**（模块 B：自定义充值没有档位）。
   *
   * <p>⚠️ 不传 `0` 或 `1` 来顶替：编出来的数会被按 `tier_id` 聚合的对账当成真档位，
   * 全部自定义充值会静默聚到某个无辜档位上。
   */
  tierId: number | null;
  amountFen: number;
  credits: number;
  creditsPerYuan: number;
  /**
   * 商品类型快照；不传取 {@link RECHARGE_ORDER_SNAPSHOT_DEFAULTS}。
   * `tier` 固定积分卡 | `custom` 自定义充值
   */
  productType?: string;
  /** 下单那刻用户看到的商品名 —— 传**展示名**而不是库里那列原始名，
   *  因为自动生成的名字会随换算率重派生（见 `displayTierName`），
   *  而快照要回答的是「用户当时看到的是哪件商品」 */
  productName?: string;
  /** 本单应发的赠送积分快照（首购加赠）；#40 上线前恒为 0 */
  bonusCredits?: number;
  /** 积分到期时刻；`null` = 永久 */
  creditsExpireAt?: Date | null;
  /** 下单时服务端判定的首购状态：`unknown` 未判定（功能未上线）| `first` | `repeat` */
  firstPurchaseState?: string;
  /** 该商品是否参与首购加赠（配置快照）。0 / 1 */
  firstPurchaseEligible?: number;
  permissionResult?: string;
  /** 下单时刻的档位配置版本（`topup_tiers.version`）——回答「这单是改价前还是改价后」 */
  configVersion?: number;
}

/** 管理端充值记录列表的筛选条件（全部可选，除分页外）。 */
export interface RechargeOrderListFilter {
  page: number;
  pageSize: number;
  /** 按用户过滤；不传 = 全部用户 */
  userId?: number;
  status?: RechargeOrderStatus;
  /** **精确**匹配交易单号（`uk_recharge_orders__trade_no`）——运营是拿单号来对账的，模糊匹配会带出无关行 */
  tradeNo?: string;
}

/**
 * 找「同一用户、同一商品的活跃单」时用的商品身份。
 *
 * <p>`credits` 也算身份的一部分：它能分辨「同一档位在配置改过之后下的单」（到账积分变了
 * 就是另一件商品）。`amountFen` **刻意不在**里面 —— 同一件商品在待支付期间被运营改了价，
 * 订单行里冻结的仍是下单那一刻的价，复用就等于按原价卖，不会凭空改口。
 */
export interface ActiveOrderIdentity {
  userId: number;
  productType: string;
  tierId: number | null;
  credits: number;
}

export interface RechargeOrderPage {
  items: RechargeOrderView[];
  total: number;
}

export interface RechargeOrderRepo {
  create(input: CreateRechargeOrderInput): Promise<RechargeOrderView>;
  getByTradeNo(tradeNo: string): Promise<RechargeOrderView | null>;
  /** 管理端列表（offset 分页，时间倒序）。**不供用户端使用**——用户只看得到自己那份。 */
  list(filter: RechargeOrderListFilter): Promise<RechargeOrderPage>;
  /**
   * 该用户这件商品**尚未支付**的那一笔（没有则 null）。
   *
   * <p>下单前先问它：命中就不建新单（PRD §7.5「服务端避免重复有效订单」）。只认 `pending` ——
   * `paid_pending` / `paid` 说明钱已经收了，那是一笔已完成的交易，不是「用户点重复了」。
   */
  findActivePending(identity: ActiveOrderIdentity): Promise<RechargeOrderView | null>;
  /**
   * 主动对账的取数：状态是「钱到了、积分没发完」（`paid_pending` / `grant_failed`）
   * 且**进入该状态**已超过 `cutoff` 的订单，最旧的在前。
   *
   * <p>`grant_failed` 也在取数范围内：那个状态是**给人看的信号**，不是终点。只扫
   * `paid_pending` 的话，一旦被标异常就再没有任何自动重试去碰它 —— 钱收了、积分永远不发。
   */
  listUnsettledBefore(cutoff: Date, limit: number): Promise<RechargeOrderView[]>;
  /**
   * 绑定网关订单号与收银台链接。该号已被别的订单占用（或本单已绑过别的号）时返回 false。
   *
   * <p>两者**同一次更新写入**（网关的同一个应答里回来），所以「有没有链接」与
   * 「有没有网关订单号」永远同真同假 —— 判「这单有没有拿到过收银台链接」靠的就是这一点。
   */
  bindGatewayOrder(
    tradeNo: string,
    gateway: { payOrderId: string; cashierUrl: string },
  ): Promise<boolean>;
  /**
   * 标记「支付已确认、待到账」（`pending` → `paid_pending`）。**条件更新**：仅当尚未到达
   * 至少 `paid_pending` 时才改，返回是否本次改成功（并发/重投下只有一个为 true）。
   *
   * <p>⚠️ 这一步必须排在**发放之前**：发放失败时订单停在 `paid_pending`，
   * 与「用户还没付钱」（`pending`）区分得开。顺序反了，那种失败单就退回不可分辨。
   *
   * <p>放行的来源不限 `pending`：`failed` / `expired` 的单收到支付成功回调时钱是真的到了，
   * 网关比我们的时钟权威，同样要能推上来。
   *
   * <p>⚠️ 顺带写下 `paid_pending_at`（**首次**进入该状态的时刻，主动对账靠它算持有分钟数）。
   * 条件更新保证同一单只写一次，重投与异常单回炉都不会把它刷成「刚才」。
   */
  markPaidPending(tradeNo: string): Promise<boolean>;
  /**
   * 标记到账（`paid_pending` → `paid`）。**条件更新**：仅当当前状态不是 `paid` 时才改，
   * 返回是否本次改成功。
   *
   * <p>⚠️ 它现在**只**回答「本次是否由我把订单推到已到账」，**不再**是「该不该发积分」的答案：
   * 发放与否由调用方按「当前状态是否 >= 待到账」判断（`paid_pending` 上的重复回调要**重试发放**，
   * 那是一次白给的重试机会）。重复发放仍由 billing 的幂等键兜底，两层都要有。
   */
  markPaid(input: { tradeNo: string; grantLotId?: string }): Promise<boolean>;
  /**
   * 标记到账异常（`paid_pending` → `grant_failed`，进核验队列）。
   * 返回**本次是否由我标记**（已是异常状态时返回 false，调用方据此决定要不要叫人）。
   *
   * <p>⚠️ 只从 `paid_pending` 标：`grant_failed` 的意思是「钱到了、发不出去」，
   * 从 `pending` 标它等于把「用户还没付钱」说成到账异常。
   */
  markGrantFailed(tradeNo: string): Promise<boolean>;
  /** 记一次回调到达（只做可观测，不参与判定） */
  recordNotify(tradeNo: string): Promise<void>;
  /**
   * 抢占一次「向网关查单」的名额。
   *
   * <p>用户端每 3 秒轮询一次状态，若每次都去问网关，一个用户就是每分钟 20 次查单。
   * 距上次查单不足 `intervalMs` 时返回 false。
   *
   * <p>⚠️ 名额记在**库里**而不是进程内存：多实例部署时每个进程各记各的内存，等于没限流。
   */
  claimQuerySlot(tradeNo: string, intervalMs: number): Promise<boolean>;
  markFailed(tradeNo: string): Promise<void>;
  markExpired(tradeNo: string): Promise<void>;
}

/* ---------- helpers ---------- */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toView(row: any): RechargeOrderView {
  // 白名单兜底是**默认成 pending**：认不出的状态宁可显示成「等待支付结果」，
  // 也不能当成 `paid` —— 那会让用户以为积分已到账。扩状态时没同步这里的后果正是这个，
  // 所以状态清单只有 RECHARGE_ORDER_STATUSES 一份。
  const status = RECHARGE_ORDER_STATUSES.includes(row.status)
    ? (row.status as RechargeOrderStatus)
    : RECHARGE_ORDER_STATUS.pending;
  return {
    tradeNo: row.trade_no,
    payOrderId: row.pay_order_id ?? null,
    cashierUrl: row.cashier_url ?? null,
    userId: row.user_id.toString(),
    tierId: row.tier_id === null ? null : row.tier_id.toString(),
    amountFen: Number(row.amount_fen),
    credits: Number(row.credits),
    creditsPerYuan: row.credits_per_yuan,
    productType: row.product_type,
    productName: row.product_name,
    status,
    paidAt: row.paid_at ? new Date(row.paid_at).toISOString() : null,
    grantLotId: row.grant_lot_id === null ? null : row.grant_lot_id.toString(),
    notifyCount: row.notify_count,
    createdAt: new Date(row.gmt_create).toISOString(),
    paidPendingAt: row.paid_pending_at
      ? new Date(row.paid_pending_at).toISOString()
      : null,
  };
}

/* ---------- factory ---------- */

export function createRechargeOrderRepo(prisma: PrismaClient): RechargeOrderRepo {
  return {
    async create(input) {
      const row = await prisma.recharge_orders.create({
        data: {
          trade_no: input.tradeNo,
          user_id: BigInt(input.userId),
          // NULL = 非档位商品（自定义充值）。**不要**在调用方兜底成 0 —— 见字段注释
          tier_id: input.tierId === null ? null : BigInt(input.tierId),
          amount_fen: BigInt(input.amountFen),
          credits: BigInt(input.credits),
          credits_per_yuan: input.creditsPerYuan,
          status: RECHARGE_ORDER_STATUS.pending,
          // 快照 8 列在**下单这一处**写全（PRD §9.3）。不靠列默认值：默认值只在
          // INSERT 语句里缺列时生效，而缺列本身没有任何报错——快照列静默为空，
          // 「后台改配置不影响已创建订单」这条保证就悄悄失效了。
          product_type:
            input.productType ?? RECHARGE_ORDER_SNAPSHOT_DEFAULTS.productType,
          product_name:
            input.productName ?? RECHARGE_ORDER_SNAPSHOT_DEFAULTS.productName,
          bonus_credits: BigInt(
            input.bonusCredits ?? RECHARGE_ORDER_SNAPSHOT_DEFAULTS.bonusCredits,
          ),
          credits_expire_at:
            input.creditsExpireAt ?? RECHARGE_ORDER_SNAPSHOT_DEFAULTS.creditsExpireAt,
          first_purchase_state:
            input.firstPurchaseState ??
            RECHARGE_ORDER_SNAPSHOT_DEFAULTS.firstPurchaseState,
          first_purchase_eligible:
            input.firstPurchaseEligible ??
            RECHARGE_ORDER_SNAPSHOT_DEFAULTS.firstPurchaseEligible,
          permission_result:
            input.permissionResult ?? RECHARGE_ORDER_SNAPSHOT_DEFAULTS.permissionResult,
          config_version: input.configVersion ?? 0,
        },
      });
      return toView(row);
    },

    async getByTradeNo(tradeNo) {
      const row = await prisma.recharge_orders.findFirst({
        where: { trade_no: tradeNo, is_delete: 0 },
      });
      return row ? toView(row) : null;
    },

    async list(filter) {
      const where = {
        is_delete: 0,
        ...(filter.userId !== undefined ? { user_id: BigInt(filter.userId) } : {}),
        ...(filter.status !== undefined ? { status: filter.status } : {}),
        ...(filter.tradeNo !== undefined ? { trade_no: filter.tradeNo } : {}),
      };
      const [total, rows] = await Promise.all([
        prisma.recharge_orders.count({ where }),
        prisma.recharge_orders.findMany({
          where,
          // 次级键 id 不是可选项：DATETIME 只到秒，同一秒下单两笔是常态，
          // 只按时间排序时翻页会跳行或重复行（与 billing 游标的理由同源）。
          orderBy: [{ gmt_create: "desc" }, { id: "desc" }],
          skip: (filter.page - 1) * filter.pageSize,
          take: filter.pageSize,
        }),
      ]);
      return { items: rows.map(toView), total };
    },

    async findActivePending(identity) {
      const row = await prisma.recharge_orders.findFirst({
        where: {
          user_id: BigInt(identity.userId),
          // 只认 pending：paid_pending / paid 是「钱已经收了」的已完成交易，
          // 不是「用户点了两次」。异常单同理（它更不该被当成新单的挡板）
          status: RECHARGE_ORDER_STATUS.pending,
          is_delete: 0,
          product_type: identity.productType,
          // tier_id 传 null 时 Prisma 生成 IS NULL —— 自定义充值单正是这一支
          tier_id: identity.tierId === null ? null : BigInt(identity.tierId),
          credits: BigInt(identity.credits),
        },
        // 同一件商品理论上只会有一笔 pending，但历史数据/并发下可能有第二笔：
        // 复用**最新**那笔（次级键 id 不是可选项：DATETIME 只到秒，同秒两笔是常态）
        orderBy: [{ gmt_create: "desc" }, { id: "desc" }],
      });
      return row ? toView(row) : null;
    },

    async listUnsettledBefore(cutoff, limit) {
      const rows = await prisma.recharge_orders.findMany({
        where: {
          is_delete: 0,
          status: {
            in: [RECHARGE_ORDER_STATUS.paidPending, RECHARGE_ORDER_STATUS.grantFailed],
          },
          OR: [
            { paid_pending_at: { lt: cutoff } },
            // 本列上线前进入 paid_pending 的存量单没有那个时刻，退回按**下单时刻**判：
            // 对它更宽松（下单后 30 分钟就够格），好过永远扫不到
            { paid_pending_at: null, gmt_create: { lt: cutoff } },
          ],
        },
        // 最旧的先处理：它们等得最久，也最可能是真的卡住了
        orderBy: [{ gmt_create: "asc" }, { id: "asc" }],
        take: limit,
      });
      return rows.map(toView);
    },

    async bindGatewayOrder(tradeNo, gateway) {
      // 条件更新：本单尚无网关订单号时才绑。更新不到行说明它已经被绑过
      // （或号被别的订单占了 → 唯一索引会拒绝，同样让 count=0，不会静默改写归属）
      try {
        const r = await prisma.recharge_orders.updateMany({
          where: { trade_no: tradeNo, pay_order_id: null },
          data: {
            pay_order_id: gateway.payOrderId,
            // 与订单号同一次写：两者同真同假，判「有没有拿到过链接」才有依据
            cashier_url: gateway.cashierUrl,
            gmt_modified: new Date(),
          },
        });
        return r.count > 0;
      } catch {
        return false;
      }
    },

    async markPaidPending(tradeNo) {
      const r = await prisma.recharge_orders.updateMany({
        // `notIn: [paid_pending, paid]` = 「钱还没到」的上界判断。用 notIn 而不是
        // `status: "pending"`：失败/过期的单收到成功回调时（钱真的到了）也要能推上来。
        //
        // ⚠️ `grant_failed` 也在 notIn 里（它属于 PAID_REACHED_STATUSES）：异常单回炉重试时
        // 不能被推回 paid_pending，否则下面那个「首次进入待到账的时刻」会被刷新，
        // 主动对账的持有分钟数就永远停在几分钟、看起来一切正常
        where: { trade_no: tradeNo, status: { notIn: [...PAID_REACHED_STATUSES] } },
        data: {
          status: RECHARGE_ORDER_STATUS.paidPending,
          // 全仓**唯一**写这一列的地方。条件更新保证同一单只写一次 = 「首次」进入该状态
          paid_pending_at: new Date(),
          gmt_modified: new Date(),
        },
      });
      return r.count > 0;
    },

    async markPaid({ tradeNo, grantLotId }) {
      const r = await prisma.recharge_orders.updateMany({
        where: { trade_no: tradeNo, status: { not: RECHARGE_ORDER_STATUS.paid } },
        data: {
          status: RECHARGE_ORDER_STATUS.paid,
          paid_at: new Date(),
          // 只有真拿到批次 id 时才写：幂等命中（409）那条路径拿不到它，
          // 写 null 会把早先那次成功留下的批次号抹掉
          ...(grantLotId ? { grant_lot_id: BigInt(grantLotId) } : {}),
          gmt_modified: new Date(),
        },
      });
      return r.count > 0;
    },

    async recordNotify(tradeNo) {
      await prisma.recharge_orders.updateMany({
        where: { trade_no: tradeNo },
        data: { notify_count: { increment: 1 }, gmt_modified: new Date() },
      });
    },

    async markGrantFailed(tradeNo) {
      const r = await prisma.recharge_orders.updateMany({
        // 只从 paid_pending 标：见接口注释（money arrived 是它的前提）
        where: { trade_no: tradeNo, status: RECHARGE_ORDER_STATUS.paidPending },
        data: { status: RECHARGE_ORDER_STATUS.grantFailed, gmt_modified: new Date() },
      });
      return r.count > 0;
    },

    async claimQuerySlot(tradeNo, intervalMs) {
      const cutoff = new Date(Date.now() - intervalMs);
      const r = await prisma.recharge_orders.updateMany({
        where: {
          trade_no: tradeNo,
          OR: [{ last_query_at: null }, { last_query_at: { lt: cutoff } }],
        },
        data: { last_query_at: new Date() },
      });
      return r.count > 0;
    },

    // ⚠️ 下面两条都只作用于 `pending`。**这不是顺手写的收窄**，是「钱比时钟权威」这条：
    //    `paid_pending` 说明网关已经确认收到钱了，此时再按「网关说失败」或「超过令牌期」
    //    改成 failed/expired，等于用我们本地的时钟推翻已经收到的钱。
    async markFailed(tradeNo) {
      await prisma.recharge_orders.updateMany({
        where: { trade_no: tradeNo, status: RECHARGE_ORDER_STATUS.pending },
        data: { status: RECHARGE_ORDER_STATUS.failed, gmt_modified: new Date() },
      });
    },

    async markExpired(tradeNo) {
      await prisma.recharge_orders.updateMany({
        where: { trade_no: tradeNo, status: RECHARGE_ORDER_STATUS.pending },
        data: { status: RECHARGE_ORDER_STATUS.expired, gmt_modified: new Date() },
      });
    },
  };
}
