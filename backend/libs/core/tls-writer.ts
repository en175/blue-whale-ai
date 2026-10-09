import { hostname } from "node:os";

import volcSdk from "@volcengine/openapi";

export interface TlsLogContent {
  Key: string;
  Value: string;
}

export interface TlsLogRecord {
  time: number;
  contents: TlsLogContent[];
}

export interface TlsLogWriter {
  write(record: TlsLogRecord): void;
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

export interface TlsWriterStats {
  enqueueFailures: number;
  sendFailures: number;
  sendSuccesses: number;
  startFailures: number;
  closeFailures: number;
  lastError: { at: string; message: string; code?: string; timestamp: number } | null;
}

interface TlsAttempt {
  ErrorCode?: string;
  ErrorMessage?: string;
  RequestId?: string;
  SuccessFlag?: boolean;
  TimestampMs?: number;
}

interface TlsSendResult {
  Attempts?: TlsAttempt[];
  SuccessFlag?: boolean;
}

interface TlsSendCallBack {
  Success(result: TlsSendResult): void;
  Fail(result: TlsSendResult): void;
}

type SdkNamespace = typeof import("@volcengine/openapi");

function sdk(): SdkNamespace {
  const mod = volcSdk as unknown as { default?: SdkNamespace } & SdkNamespace;
  return mod.tlsOpenapi ? mod : (mod.default as SdkNamespace);
}

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

function tlsDebugEnabled(): boolean {
  const value = process.env.TLS_DEBUG;
  return value !== undefined && value !== "" && value !== "0";
}

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
  }
}

export function getTlsWriterStats(): TlsWriterStats {
  return { ...stats, lastError: stats.lastError ? { ...stats.lastError } : null };
}

export function resetTlsWriterStats(): void {
  stats = emptyStats();
  surfaceThrottle.clear();
}


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
            surfaceError("enqueue", errorMessage(err), errorCode(err));
          });
      } catch (err) {
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

export function getDefaultTlsLogWriter(): TlsLogWriter {
  if (!defaultWriter) defaultWriter = createTlsLogWriter(loadTlsWriterConfig());
  return defaultWriter;
}

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
