/**
 * 建 job 与计费（billing-svc）之间的契约：**预扣**与它的**失败补偿**。
 *
 * ⚠️ **它是行为，不是数据** —— 所以不能挂在建 job 的那个入参对象上（那个对象同时是
 * Prisma 的 `create` 入参和 `generation_job_logs.payload` 的载荷，混进行为会在落库那一刻炸，
 * 见 job-input-purity）。它走独立依赖，与事务一样是「每次调用」的东西。
 *
 * ⚠️ **为什么预扣必须在事务内、job 行插入之后**：billing 的 Hold 以 `job_id` 为准
 * （预留表按 `generation_job_id` 唯一，结算与返还都按 job_id 找预留），而 job id 只有把行插
 * 进去之后才存在。契约注释设想的「Hold 发生在写 job 之前」在 billing 侧落不了地——那条路
 * 要传一个还不存在的 job_id。代价是事务里多一次外部 RPC（50ms 预算），刻意的取舍。
 */
export interface JobBilling {
  /** 预扣：job 行插入后立刻调用。抛错即整体回滚 —— **不产生垃圾 job**。 */
  hold(jobId: number): Promise<void>;
  /** 预扣的补偿返还：建 job 的事务回滚后调用，把这笔冻结退掉。 */
  release(jobId: number, reason: string): Promise<void>;
}

/**
 * 跑一段「建 job」的事务：预扣成功之后事务若失败，**先把那笔冻结退掉再抛错**。
 *
 * ⚠️ 为什么必须有补偿：billing 是**外部服务**，不跟我们的数据库事务一起回滚。任务行随事务
 * 消失 ⇒ 终态事件永远不会发 ⇒ 那笔钱会**永远冻着**（实测：billing 里一条 pending 预留，
 * blue_whale 里没有对应 job）。
 *
 * ⚠️ 只补偿「预扣确实成功过」的那一次：hold 抛错说明钱没冻上（余额不足 / billing 拒绝），
 * 此时再发一条返还既无意义，也可能撞上自增 id 被复用后的**别人那笔**预留。
 *
 * ⚠️ 补偿自身的错误不往外抛（由 `release` 的实现吞掉并记 ERROR）：这里是「事务已经失败」的
 * 路径，补偿的错误不能盖掉用户该看到的那个。代价是钱可能仍冻着，所以那条日志带 jobId。
 */
export async function withBillingCompensation<T>(
  billing: JobBilling | undefined,
  run: (billing: JobBilling | undefined) => Promise<T>,
): Promise<T> {
  if (!billing) return run(undefined);
  const held = { jobId: null as number | null };
  try {
    return await run({
      hold: async (jobId) => {
        await billing.hold(jobId);
        held.jobId = jobId;
      },
      release: billing.release,
    });
  } catch (error) {
    const heldJobId = held.jobId;
    if (heldJobId !== null) {
      await billing.release(
        heldJobId,
        error instanceof Error ? error.message : String(error),
      );
    }
    throw error;
  }
}
