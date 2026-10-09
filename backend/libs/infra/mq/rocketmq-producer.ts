import { Producer } from "rocketmq-client-nodejs";

export type RocketMqConfig = {
  endpoints: string;
  sslEnabled: boolean;
  accessKey?: string;
  accessSecret?: string;
};

export function loadRocketMqConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): RocketMqConfig {
  const accessKey = env.ROCKETMQ_ACCESS_KEY;
  const accessSecret = env.ROCKETMQ_SECRET_KEY;
  return {
    endpoints: env.ROCKETMQ_ENDPOINTS ?? "",
    sslEnabled: env.ROCKETMQ_SSL_ENABLED === "true",
    ...(accessKey && accessSecret ? { accessKey, accessSecret } : {}),
  };
}

let rocketMqStartup: Promise<Producer> | null = null;

export async function getStartedRocketMqProducer(
  config: RocketMqConfig,
): Promise<Producer> {
  if (!config.endpoints) {
    throw new Error(
      "未配置 ROCKETMQ_ENDPOINTS（测试环境 gRPC 端点，如 115.190.244.91:8081）",
    );
  }
  if (!rocketMqStartup) {
    const producer = new Producer({
      endpoints: config.endpoints,
      namespace: "",
      sslEnabled: config.sslEnabled,
      ...(config.accessKey && config.accessSecret
        ? {
            sessionCredentials: {
              accessKey: config.accessKey,
              accessSecret: config.accessSecret,
            },
          }
        : {}),
    });
    rocketMqStartup = producer
      .startup()
      .then(() => producer)
      .catch((error) => {
        rocketMqStartup = null;
        throw error;
      });
  }
  return rocketMqStartup;
}

export function isRocketMqEndpointsMissingError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.startsWith("未配置 ROCKETMQ_ENDPOINTS")
  );
}

export function enqueueFailureLog(
  error: unknown,
  ctx: { scope: string; kind: string; jobId: string },
): { level: "warn" | "error"; message: string } {
  if (isRocketMqEndpointsMissingError(error)) {
    return {
      level: "warn",
      message: `[${ctx.scope}] ${ctx.kind} job 未经 MQ 派发（未配置 ROCKETMQ_ENDPOINTS），将由 worker 恢复扫描捞起消费: jobId=${ctx.jobId}`,
    };
  }
  return {
    level: "error",
    message: `[${ctx.scope}] enqueue ${ctx.kind} job failed: ${error instanceof Error ? error.message : "unknown"}`,
  };
}

export async function closeRocketMqProducer(): Promise<void> {
  const startup = rocketMqStartup;
  rocketMqStartup = null;
  if (startup) {
    try {
      const producer = await startup;
      await producer.shutdown();
    } catch {
    }
  }
}
