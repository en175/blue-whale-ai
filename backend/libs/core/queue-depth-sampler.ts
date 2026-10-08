import { createLogger, type Logger } from "./logger.js";

export interface QueueDepthReading {
  queue: string;
  status: string;
  depth: number;
}

export interface QueueDepthSamplerOptions {
  sample: () => Promise<QueueDepthReading[]>;
  intervalMs?: number;
  logger?: Logger;
}

export interface QueueDepthSampler {
  start(): void;
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
