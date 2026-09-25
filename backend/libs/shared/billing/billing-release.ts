/* ============================================
 * 预扣的**补偿返还** —— 建 job 的事务回滚后，把这次 Hold 退掉
 *
 * 为什么需要它：billing 是**外部服务**，不跟我们的数据库事务一起回滚。事务把任务行撤掉
 * 之后，冻结还留在 billing 那边；而任务行没了 ⇒ 终态事件永远不会发（谁也不知道这个 job
 * 存在过）⇒ 这笔钱会**永远冻着**。本地端到端实测踩到过：billing 里一条 pending 预留，
 * blue_whale 里没有对应 job。
 *
 * ⚠️ 走 MQ 而不是 RPC：契约把结算/返还定在 MQ 侧（contracts/proto/billing/v1/events.proto
 *    「结算 / 返还**不走 RPC** …… 它们不该阻塞任何用户请求」）。billing 的消费者按 job_id
 *    幂等释放（`refund:{jobId}`），**无待结算预留时是无操作** —— 所以「多返一条」的代价
 *    只是一条空转消息，而漏发的代价是把钱冻死。宁可多发。
 *
 * ⚠️ 本函数**不抛错**：它跑在「事务已经失败」的处理路径上，抛出去会盖掉用户真正该看到的
 *    那个错误。补偿失败只留一条 ERROR（钱仍冻着——运维可用 billing 管理端的
 *    `POST /admin/credits/jobs/{jobId}/refund` 兜底释放）。
 * ============================================ */
import {
  getStartedRocketMqProducer,
  loadRocketMqConfig,
} from "@lib/infra/mq/rocketmq-producer.js";

/** billing 消费的失败 topic。与 billing 的 `billing.mq.topic-failed`（application.yml）
 *  和 worker-java 的 `worker.billing.topic-failed` 是**同一个 topic**：
 *  三处只改一处就是「事件发出去了但没人消费」——静默且致命。 */
export const BILLING_JOB_FAILED_TOPIC = "generation-job-failed";

/** 返还请求。`userId` 只用于事件载荷（billing 按 job_id 找预留，不按用户）。 */
export interface BillingReleaseContext {
  userId: string;
  jobId: number;
  /** 为什么返还（写进 billing 的预留释放原因与流水，供对账/客服追溯）。 */
  reason: string;
}

export type BillingRelease = (ctx: BillingReleaseContext) => Promise<void>;

/** `generation-job-failed` 的载荷 —— `JobEventPayload.JobFailed` 的镜像，字段名逐字一致。 */
export interface BillingJobFailedEvent {
  jobId: number;
  userId: number;
  reason: string;
}

export interface BillingReleaseDeps {
  /** 发布一条失败事件。实现抛错由本模块吞掉（见文件头：不盖掉原始错误）。 */
  publish: (event: BillingJobFailedEvent) => Promise<void>;
  logger?: { error: (message: string) => void };
}

export function createBillingRelease(deps: BillingReleaseDeps): BillingRelease {
  return async (ctx) => {
    try {
      await deps.publish({
        jobId: ctx.jobId,
        userId: Number(ctx.userId),
        reason: ctx.reason,
      });
    } catch (error) {
      // 钱还在 billing 那边冻着，且这次连返还事件都没发出去 —— 必须是 ERROR，
      // 并带上 jobId（运维据此人工释放）。
      deps.logger?.error(
        `[billing] 预扣补偿返还失败，这笔钱仍冻着：jobId=${ctx.jobId} 原因=${ctx.reason} ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  };
}

/** 走 RocketMQ 发布（复用进程内那条共享连接）。 */
export async function publishBillingJobFailed(
  event: BillingJobFailedEvent,
): Promise<void> {
  const producer = await getStartedRocketMqProducer(loadRocketMqConfig());
  // 不带 tag：billing 的消费者按 `FilterExpression("*")` 订阅整个 topic。
  await producer.send({
    topic: BILLING_JOB_FAILED_TOPIC,
    body: Buffer.from(JSON.stringify(event)),
  });
}
