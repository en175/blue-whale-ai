/**
 * 火山引擎 TLS 日志上报 writer（IK6KQQ，父任务 IK6KO2；IK7TED 错误可见性）。
 *
 * 官方 Node SDK `@volcengine/openapi` 的 tls Producer 异步批量直写
 * （对齐 blue-whale-api ADR-0002 方案 A：应用内 Producer 异步直写）。
 * 配置不全时返回 no-op writer，日志上报永不阻断业务流程。
 *
 * 环境变量：TLS_ENDPOINT / TLS_REGION / TLS_TOPIC_ID / TLS_AK / TLS_SK
 * （可选 TLS_SOURCE 覆盖日志来源标识，缺省 主机名-PID）。
 *
 * 错误可见性（IK7TED）：SDK Producer 对入队后的失败默认静默——传给 SendLog 的
 * CallBack 是感知「batch 重试耗尽后最终失败」的唯一通道，此前未传；入队阶段的
 * 失败（如 protobuf 加载/校验）reject promise 也曾用空 catch 吞掉。现在所有失败
 * 路径经 surfaceError 走 console.error（按 at+code 节流，缺省 10s；TLS_DEBUG 任意
 * 非空值关闭节流；TLS_SURFACE_INTERVAL_MS 覆盖间隔）。刻意不用结构化 logger，
 * 避免 write→error→write 递归；可见性自身也绝不抛错。getTlsWriterStats 供未来
 * 健康探针复用（Next 双 bundle 各自持有独立计数，属预期）。
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

/** TLS 上报运行统计（进程内累计；双 bundle 场景各有一份）。 */
export interface TlsWriterStats {
  /** SendLog 入队阶段失败（promise reject / 同步 throw） */
  enqueueFailures: number;
  /** CallBack.Fail：batch 重试耗尽后最终发送失败 */
  sendFailures: number;
  /** CallBack.Success：batch 发送成功 */
  sendSuccesses: number;
  /** Producer.Start() 失败次数 */
  startFailures: number;
  /** close() 失败次数 */
  closeFailures: number;
  /** 最近一次失败详情（无失败为 null） */
  lastError: { at: string; message: string; code?: string; timestamp: number } | null;
}

/** SDK SendLog 结果中的单次尝试（结构化最小约束，字段均为 SDK 可选返回）。 */
interface TlsAttempt {
  ErrorCode?: string;
  ErrorMessage?: string;
  RequestId?: string;
  SuccessFlag?: boolean;
  TimestampMs?: number;
}

/** SDK SendLog 结果（结构化最小约束）。 */
interface TlsSendResult {
  Attempts?: TlsAttempt[];
  SuccessFlag?: boolean;
}

/** SDK SendLog 第 6 参回调（感知 batch 最终成败的唯一通道）。 */
interface TlsSendCallBack {
  Success(result: TlsSendResult): void;
  Fail(result: TlsSendResult): void;
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

// ---------------------------------------------------------------------------
// 错误可见性（IK7TED）
// ---------------------------------------------------------------------------

const DEFAULT_SURFACE_INTERVAL_MS = 10_000;

type SurfaceAt = "enqueue" | "send" | "start" | "close";

function emptyStats(): TlsWriterStats {
  return {
    enqueueFailures: 0,
    sendFailures: 0,
    sendSuccesses: 0,
    startFailures: 0,
    closeFailures: 0,
    lastError: null,
  };
}

let stats: TlsWriterStats = emptyStats();
const surfaceThrottle = new Map<string, number>();

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function errorCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" && code !== "" ? code : undefined;
}

/** TLS_DEBUG 仅认非空且非 "0" 值（"0"/"" 视为关闭）。 */
function tlsDebugEnabled(): boolean {
  const value = process.env.TLS_DEBUG;
  return value !== undefined && value !== "" && value !== "0";
}

/**
 * 上报失败可见化：计数 + 节流 console.error。
 * 绝不抛错、绝不走结构化 logger（防 write→error→write 递归）。
 */
function surfaceError(at: SurfaceAt, message: string, code?: string): void {
  try {
    if (at === "enqueue") stats.enqueueFailures += 1;
    else if (at === "send") stats.sendFailures += 1;
    else if (at === "start") stats.startFailures += 1;
    else stats.closeFailures += 1;
    stats.lastError = {
      at,
      message,
      ...(code ? { code } : {}),
      timestamp: Date.now(),
    };

    const debug = tlsDebugEnabled();
    const configured = Number(process.env.TLS_SURFACE_INTERVAL_MS);
    const intervalMs =
      Number.isFinite(configured) && configured > 0
        ? configured
        : DEFAULT_SURFACE_INTERVAL_MS;
    const key = code ? `${at}:${code}` : at;
    const now = Date.now();
    const lastEmit = surfaceThrottle.get(key) ?? 0;
    if (!debug && now - lastEmit < intervalMs) return;
    surfaceThrottle.set(key, now);

    const total =
      at === "enqueue"
        ? stats.enqueueFailures
        : at === "send"
          ? stats.sendFailures
          : at === "start"
            ? stats.startFailures
            : stats.closeFailures;
    console.error(
      `[tls-writer] ${at}: ${message}${code ? ` (code=${code})` : ""} — total=${total}`,
    );
  } catch {
    // 可见性自身失败不影响任何通道。
  }
}

/** 当前 TLS 上报统计快照（计数 + 最近错误；lastError 深拷贝，消费者改写不污染内部状态）。 */
export function getTlsWriterStats(): TlsWriterStats {
  return { ...stats, lastError: stats.lastError ? { ...stats.lastError } : null };
}

/** 重置统计与节流状态（测试用）。 */
export function resetTlsWriterStats(): void {
  stats = emptyStats();
  surfaceThrottle.clear();
}

// ---------------------------------------------------------------------------
// writer
// ---------------------------------------------------------------------------

/**
 * 创建 TLS 日志 writer。config 缺失时返回 no-op；
 * SDK Producer 内部完成批量聚合、异步发送与失败重试。
 * Start 失败降级为 no-op（日志仍走 console 主通道），对齐「永不抛错」契约。
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
  try {
    producer.Start();
  } catch (err) {
    surfaceError("start", errorMessage(err), errorCode(err));
    return noopWriter;
  }
  const source = config.source ?? "blue-whale-ai";
  return {
    write(record) {
      try {
        // CallBack 由 SDK 内部异步调用，回调体必须自包 try/catch：
        // 畸形 result 不得把异常抛回 SDK dispatcher（对齐「永不抛错」契约）。
        const callBack: TlsSendCallBack = {
          Success: (result) => {
            try {
              stats.sendSuccesses += 1;
              if (tlsDebugEnabled()) {
                const attempts = result?.Attempts ?? [];
                const last = attempts[attempts.length - 1];
                console.error(
                  `[tls-writer] send ok (requestId=${last?.RequestId ?? ""})`,
                );
              }
            } catch {
              // 回调失败不影响任何通道。
            }
          },
          Fail: (result) => {
            try {
              const attempts = result?.Attempts ?? [];
              const last = attempts[attempts.length - 1];
              surfaceError(
                "send",
                last?.ErrorMessage ?? "batch send failed after all retries",
                last?.ErrorCode || undefined,
              );
            } catch {
              // 回调失败不影响任何通道。
            }
          },
        };
        producer
          .SendLog(
            "",
            config.topicId,
            source,
            "blue-whale-ai",
            { Time: record.time, Contents: record.contents },
            callBack,
          )
          .catch((err: unknown) => {
            // 入队阶段失败（buffer 满 / protobuf 加载或校验失败等）。
            surfaceError("enqueue", errorMessage(err), errorCode(err));
          });
      } catch (err) {
        // 日志上报失败不阻断业务，但必须可见。
        surfaceError("enqueue", errorMessage(err), errorCode(err));
      }
    },
    async close() {
      try {
        await producer.Close();
      } catch (err) {
        surfaceError("close", errorMessage(err), errorCode(err));
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
