/**
 * 队列深度采样器（IK7G9Y）。
 *
 * 队列深度是瞬时值（gauge），日志只能记录采样时刻——必须主动采：
 * 每 intervalMs 调一次 sample()，每条 (queue, status) 计数打一条
 * queue_depth metric 日志，曲线聚合与告警交给 TLS 侧。
 * 采样通道永不抛错：sample 失败仅 warn，不中断定时器。
 */
import { createLogger, type Logger } from "./logger.js";

/** 一条队列深度读数：某队列某状态的当前条数。 */
export interface QueueDepthReading {
  /** 队列名，如 generation_jobs / agent_runs */
  queue: string;
  /** 队列状态值 */
  status: string;
  /** 该状态条数 */
  depth: number;
}

export interface QueueDepthSamplerOptions {
  /** 返回按状态分组的队列计数；实现方自持 DB 查询 */
  sample: () => Promise<QueueDepthReading[]>;
  /** 采样间隔（毫秒），缺省 30_000（IK7G9Y 约定 30 秒） */
  intervalMs?: number;
  /** 缺省 createLogger("queue-depth")；worker 建议传自己的 logger 以带 container 标识 */
  logger?: Logger;
}

export interface QueueDepthSampler {
  /** 启动：立即采一次，此后每周期一次；重复调用幂等。 */
  start(): void;
  /** 停止采样，并等待进行中的采样完成（避免 DB 连接关闭后仍在查询）。 */
  stop(): Promise<void>;
}

export function createQueueDepthSampler(
  options: QueueDepthSamplerOptions,
): QueueDepthSampler {
  const logger = options.logger ?? createLogger("queue-depth");
  const intervalMs = options.intervalMs ?? 30_000;
  let timer: NodeJS.Timeout | null = null;
  let inflight: Promise<void> = Promise.resolve();

  async function tick(): Promise<void> {
    try {
      const readings = await options.sample();
      for (const reading of readings) {
        logger.metric({
          event: "queue_depth",
          fields: {
            queue: reading.queue,
            status: reading.status,
            depth: reading.depth,
          },
        });
      }
    } catch (error) {
      logger.warn(
        `queue depth sampling failed: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }

  return {
    start() {
      if (timer) return;
      inflight = tick();
      timer = setInterval(() => {
        inflight = tick();
      }, intervalMs);
      timer.unref?.();
    },
    async stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      await inflight;
    },
  };
}
