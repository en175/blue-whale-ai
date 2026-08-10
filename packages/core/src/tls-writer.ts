/**
 * 火山引擎 TLS 日志上报 writer（IK6KQQ，父任务 IK6KO2）。
 *
 * 官方 Node SDK `@volcengine/openapi` 的 tls Producer 异步批量直写
 * （对齐 blue-whale-api ADR-0002 方案 A：应用内 Producer 异步直写）。
 * 配置不全时返回 no-op writer，日志上报永不阻断业务流程。
 *
 * 环境变量：TLS_ENDPOINT / TLS_REGION / TLS_TOPIC_ID / TLS_AK / TLS_SK
 * （可选 TLS_SOURCE 覆盖日志来源标识，缺省 主机名-PID）。
 */
import { hostname } from "node:os";

// SDK 是 CJS 包；默认导入取 module.exports（兼容 esModuleInterop 双形态）。
import volcSdk from "@volcengine/openapi";

export interface TlsLogContent {
  Key: string;
  Value: string;
}

export interface TlsLogRecord {
  /** 毫秒时间戳 */
  time: number;
  contents: TlsLogContent[];
}

export interface TlsLogWriter {
  write(record: TlsLogRecord): void;
  /** 优雅关闭：尽力发完缓冲内日志（进程退出前调用）。 */
  close(): Promise<void>;
}

export interface TlsWriterConfig {
  endpoint: string;
  region: string;
  topicId: string;
  accessKeyId: string;
  accessKeySecret: string;
  source?: string;
}

type SdkNamespace = typeof import("@volcengine/openapi");

function sdk(): SdkNamespace {
  // interop 兜底：default 可能是 module.exports 本身。
  const mod = volcSdk as unknown as { default?: SdkNamespace } & SdkNamespace;
  return mod.tlsOpenapi ? mod : (mod.default as SdkNamespace);
}

/** 从环境变量读取 TLS 上报配置；任一项缺失返回 null（不上报）。 */
export function loadTlsWriterConfig(
  env: NodeJS.ProcessEnv = process.env,
): TlsWriterConfig | null {
  const endpoint = env.TLS_ENDPOINT?.trim();
  const region = env.TLS_REGION?.trim();
  const topicId = env.TLS_TOPIC_ID?.trim();
  const accessKeyId = env.TLS_AK?.trim();
  const accessKeySecret = env.TLS_SK?.trim();
  if (!endpoint || !region || !topicId || !accessKeyId || !accessKeySecret) {
    return null;
  }
  return {
    // SDK Producer 内部按 `${protocol}//${host}` 拼 URL，endpoint 只收纯主机名。
    endpoint: endpoint.replace(/^https?:\/\//, ""),
    region,
    topicId,
    accessKeyId,
    accessKeySecret,
    source: env.TLS_SOURCE?.trim() || `${hostname()}-${process.pid}`,
  };
}

const noopWriter: TlsLogWriter = {
  write() {},
  async close() {},
};

/**
 * 创建 TLS 日志 writer。config 缺失时返回 no-op；
 * SDK Producer 内部完成批量聚合、异步发送与失败重试。
 */
export function createTlsLogWriter(config: TlsWriterConfig | null): TlsLogWriter {
  if (!config) return noopWriter;
  const { Producer } = sdk().tlsOpenapi;
  const producerConfig = Producer.getDefaultProducerConfig();
  producerConfig.Endpoint = config.endpoint;
  producerConfig.Region = config.region;
  producerConfig.AccessKeyID = config.accessKeyId;
  producerConfig.AccessKeySecret = config.accessKeySecret;
  const producer = new Producer(producerConfig);
  producer.Start();
  const source = config.source ?? "blue-whale-ai";
  return {
    write(record) {
      try {
        producer
          .SendLog(
            "",
            config.topicId,
            source,
            "blue-whale-ai",
            { Time: record.time, Contents: record.contents },
            undefined,
          )
          .catch(() => {
            // 上报失败由 Producer 内部重试兜底，最终失败静默丢弃。
          });
      } catch {
        // 日志上报失败不阻断业务。
      }
    },
    async close() {
      try {
        await producer.Close();
      } catch {
        // 关闭失败忽略。
      }
    },
  };
}

let defaultWriter: TlsLogWriter | null = null;

/** 进程级默认 writer（按环境变量惰性初始化，配置不全为 no-op）。 */
export function getDefaultTlsLogWriter(): TlsLogWriter {
  if (!defaultWriter) defaultWriter = createTlsLogWriter(loadTlsWriterConfig());
  return defaultWriter;
}

/**
 * 关闭并重置默认 writer（优雅停机用）。
 * 带超时兜底：Producer 优雅关闭会等在途重试（默认退避最长 10s ×10 次），
 * TLS 不可达时不得反噬进程生命周期，超时即放弃冲刷。
 */
export async function closeDefaultTlsLogWriter(timeoutMs = 5_000): Promise<void> {
  const writer = defaultWriter;
  defaultWriter = null;
  if (!writer) return;
  await Promise.race([
    writer.close(),
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      timer.unref?.();
    }),
  ]);
}
