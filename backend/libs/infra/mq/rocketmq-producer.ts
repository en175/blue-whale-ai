/**
 * 进程级 RocketMQ producer（懒建 + 懒启动）。
 *
 * 放在 infra 而不是某个领域模块：它是**连接**，不是某个业务的能力。生成任务入队
 * （{@code shared/generation/generation-queue}）与计费事件发布（{@code shared/billing}）
 * 各自定义自己的 topic/载荷，共用这一条连接与一份连接配置。
 *
 * ⚠️ 单例是刻意的：每条连接都是一个 gRPC 通道 + 心跳，按调用新建只会白白多开通道。
 */
import { Producer } from "rocketmq-client-nodejs";

/** 只含连接参数：topic / tag **不是配置项**，两侧都无 env 覆盖——它们是
 *  `queue.constants.ts` 的编译期常量（与 worker-java `GenerationMqRoute` 同值），
 *  故部署环境里残留的 `ROCKETMQ_TOPIC` / `ROCKETMQ_TAG` 静默忽略（无绑定目标）。 */
export type RocketMqConfig = {
  /** gRPC proxy 端点（如 115.190.244.91:8081）。 */
  endpoints: string;
  sslEnabled: boolean;
  accessKey?: string;
  accessSecret?: string;
};

/** 加载 RocketMQ 连接配置。生产火山实例：AK/SK + sslEnabled=false（5.x 不支持 SSL）；测试环境裸连。 */
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

/** 单例：启动中的 Promise（成功即解析为该 Producer）。只留这一个引用——连接本身就在它里面，
 *  再存一份 `Producer` 字段只会多一个「谁先谁后」的同步问题。 */
let rocketMqStartup: Promise<Producer> | null = null;

/** 懒建 + 懒启动的 RocketMQ Producer 单例；启动失败重置，下次调用重试。 */
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

/** 收口：关掉共享连接（未启动过则无事发生）。 */
export async function closeRocketMqProducer(): Promise<void> {
  const startup = rocketMqStartup;
  rocketMqStartup = null;
  if (startup) {
    try {
      const producer = await startup;
      await producer.shutdown();
    } catch {
      // 启动失败则无连接可关
    }
  }
}
