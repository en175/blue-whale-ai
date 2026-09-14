import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { FakeProducer, producerInstances } = vi.hoisted(() => {
  type AnyProducer = InstanceType<typeof FakeProducer>;
  const producerInstances: AnyProducer[] = [];

  class FakeProducer {
    config: unknown;
    started = false;
    closed = false;
    closeResolve: (() => void) | null = null;
    closeReject: Error | null = null;
    sendLogs: unknown[][] = [];
    sendLogError: Error | null = null;
    startError: Error | null = null;
    static nextStartError: Error | null = null;

    constructor(config: unknown) {
      this.config = config;
      producerInstances.push(this);
      if (FakeProducer.nextStartError) {
        this.startError = FakeProducer.nextStartError;
        FakeProducer.nextStartError = null;
      }
    }
    Start() {
      if (this.startError) throw this.startError;
      this.started = true;
    }
    SendLog(...args: unknown[]) {
      this.sendLogs.push(args);
      if (this.sendLogError) return Promise.reject(this.sendLogError);
      return Promise.resolve();
    }
    Close(): Promise<void> {
      this.closed = true;
      if (this.closeReject) return Promise.reject(this.closeReject);
      if (this.closeResolve) {
        return new Promise<void>((resolve) => {
          const done = this.closeResolve!;
          this.closeResolve = null;
          done();
          resolve();
        });
      }
      return Promise.resolve();
    }
    static getDefaultProducerConfig() {
      return {
        TotalSizeLnBytes: 1,
        MaxSenderCount: 1,
        MaxBlockSec: 1,
        MaxBatchSize: 1,
        MaxBatchCount: 1,
        LingerTime: 100,
        Retries: 1,
        MaxReservedAttempts: 1,
        BaseRetryBackoffMs: 1,
        MaxRetryBackoffMs: 1,
        AdjustShardHashFlag: false,
        ShardCount: 1,
        NoRetryStatusCodeList: [400],
      };
    }
  }

  return { FakeProducer, producerInstances };
});

vi.mock("@volcengine/openapi", () => ({
  default: { tlsOpenapi: { Producer: FakeProducer } },
}));

import {
  closeDefaultTlsLogWriter,
  createTlsLogWriter,
  getDefaultTlsLogWriter,
  getTlsWriterStats,
  loadTlsWriterConfig,
  resetTlsWriterStats,
} from "./tls-writer.js";

/** SendLog 第 6 参回调的最小形状（与 tls-writer 内部结构一致）。 */
interface FakeCallBack {
  Success(result: {
    Attempts?: Array<{ ErrorCode?: string; ErrorMessage?: string; RequestId?: string }>;
  }): void;
  Fail(result: {
    Attempts?: Array<{ ErrorCode?: string; ErrorMessage?: string }>;
  }): void;
}

function lastCallBack(producer: InstanceType<typeof FakeProducer>): FakeCallBack {
  const args = producer.sendLogs[producer.sendLogs.length - 1]!;
  return args[5] as FakeCallBack;
}

/** 等微任务排空（SendLog 的 .catch 在 rejection 后执行）。 */
async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

const FULL_ENV = {
  TLS_ENDPOINT: "tls-cn-beijing.volces.com",
  TLS_REGION: "cn-beijing",
  TLS_TOPIC_ID: "topic-x",
  TLS_AK: "AK-test",
  TLS_SK: "SK-test",
};

const VALID_CONFIG = {
  endpoint: "tls-cn-beijing.volces.com",
  region: "cn-beijing",
  topicId: "topic-x",
  accessKeyId: "AK-test",
  accessKeySecret: "SK-test",
  source: "unit-test",
};

let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  producerInstances.length = 0;
  resetTlsWriterStats();
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errSpy.mockRestore();
  vi.unstubAllEnvs();
});

describe("loadTlsWriterConfig —— 环境变量解析", () => {
  it("五项齐全时返回配置，endpoint 归一为纯主机名", () => {
    const config = loadTlsWriterConfig({ ...FULL_ENV });
    expect(config).toMatchObject({
      endpoint: "tls-cn-beijing.volces.com",
      region: "cn-beijing",
      topicId: "topic-x",
      accessKeyId: "AK-test",
      accessKeySecret: "SK-test",
    });
    expect(config?.source).toBeTruthy();
  });

  it("endpoint 已带协议前缀时剥离为纯主机名", () => {
    const config = loadTlsWriterConfig({
      ...FULL_ENV,
      TLS_ENDPOINT: "https://tls-cn-beijing.volces.com",
    });
    expect(config?.endpoint).toBe("tls-cn-beijing.volces.com");
  });

  it("任一项缺失/空白时返回 null", () => {
    for (const key of Object.keys(FULL_ENV)) {
      const env: Record<string, string> = { ...FULL_ENV };
      delete env[key];
      expect(loadTlsWriterConfig(env)).toBeNull();
      expect(loadTlsWriterConfig({ ...FULL_ENV, [key]: "   " })).toBeNull();
    }
    expect(loadTlsWriterConfig({})).toBeNull();
  });
});

describe("createTlsLogWriter", () => {
  it("配置缺失时返回 no-op writer，不实例化 Producer", async () => {
    const writer = createTlsLogWriter(null);
    writer.write({ time: Date.now(), contents: [{ Key: "level", Value: "info" }] });
    await expect(writer.close()).resolves.toBeUndefined();
    expect(producerInstances).toHaveLength(0);
  });

  it("配置齐全时透传 Endpoint/Region/AK/SK 并 Start Producer", () => {
    createTlsLogWriter(VALID_CONFIG);
    expect(producerInstances).toHaveLength(1);
    const producer = producerInstances[0]!;
    expect(producer.started).toBe(true);
    expect(producer.config).toMatchObject({
      Endpoint: "tls-cn-beijing.volces.com",
      Region: "cn-beijing",
      AccessKeyID: "AK-test",
      AccessKeySecret: "SK-test",
    });
  });

  it("write 透传 topic/source/filename 与日志内容给 SendLog，并附带 CallBack", () => {
    const writer = createTlsLogWriter(VALID_CONFIG);
    writer.write({
      time: 1_700_000_000_000,
      contents: [{ Key: "message", Value: "hello" }],
    });
    const producer = producerInstances[0]!;
    expect(producer.sendLogs).toHaveLength(1);
    const args = producer.sendLogs[0]!;
    expect(args.slice(0, 5)).toEqual([
      "",
      "topic-x",
      "unit-test",
      "blue-whale-ai",
      { Time: 1_700_000_000_000, Contents: [{ Key: "message", Value: "hello" }] },
    ]);
    const callBack = args[5] as FakeCallBack;
    expect(typeof callBack.Success).toBe("function");
    expect(typeof callBack.Fail).toBe("function");
  });

  it("close 调用 Producer.Close", async () => {
    const writer = createTlsLogWriter(VALID_CONFIG);
    await writer.close();
    expect(producerInstances[0]!.closed).toBe(true);
  });
});

describe("错误可见性（IK7TED）", () => {
  it("SendLog reject 时 surface enqueue 错误并计数", async () => {
    const writer = createTlsLogWriter(VALID_CONFIG);
    const producer = producerInstances[0]!;
    const boom = new Error("proto load ENOENT");
    (boom as Error & { code: string }).code = "ENOENT";
    producer.sendLogError = boom;

    writer.write({ time: Date.now(), contents: [] });
    await flushMicrotasks();

    const stats = getTlsWriterStats();
    expect(stats.enqueueFailures).toBe(1);
    expect(stats.lastError).toMatchObject({ at: "enqueue", code: "ENOENT" });
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(errSpy.mock.calls[0]![0]).toContain("[tls-writer] enqueue: proto load ENOENT");
    expect(errSpy.mock.calls[0]![0]).toContain("(code=ENOENT)");
  });

  it("SendLog 同步 throw 时同样 surface enqueue 错误", () => {
    const writer = createTlsLogWriter(VALID_CONFIG);
    const producer = producerInstances[0]!;
    producer.SendLog = () => {
      throw new Error("buffer full");
    };

    writer.write({ time: Date.now(), contents: [] });

    expect(getTlsWriterStats().enqueueFailures).toBe(1);
    expect(errSpy.mock.calls[0]![0]).toContain("buffer full");
  });

  it("CallBack.Fail 提取最后一次 Attempt 的 ErrorMessage/ErrorCode", () => {
    const writer = createTlsLogWriter(VALID_CONFIG);
    writer.write({ time: Date.now(), contents: [] });
    const producer = producerInstances[0]!;

    lastCallBack(producer).Fail({
      Attempts: [
        { ErrorCode: "NetworkError", ErrorMessage: "first attempt" },
        { ErrorCode: "InternalServerError", ErrorMessage: "final attempt" },
      ],
    });

    const stats = getTlsWriterStats();
    expect(stats.sendFailures).toBe(1);
    expect(stats.lastError).toMatchObject({
      at: "send",
      message: "final attempt",
      code: "InternalServerError",
    });
    expect(errSpy.mock.calls[0]![0]).toContain("[tls-writer] send: final attempt");
  });

  it("CallBack.Fail 无 Attempts 时使用兜底消息", () => {
    const writer = createTlsLogWriter(VALID_CONFIG);
    writer.write({ time: Date.now(), contents: [] });
    lastCallBack(producerInstances[0]!).Fail({});
    expect(getTlsWriterStats().sendFailures).toBe(1);
    expect(errSpy.mock.calls[0]![0]).toContain("batch send failed after all retries");
  });

  it("CallBack.Success 只计数，不输出错误", () => {
    const writer = createTlsLogWriter(VALID_CONFIG);
    writer.write({ time: Date.now(), contents: [] });
    lastCallBack(producerInstances[0]!).Success({ Attempts: [{ RequestId: "req-1" }] });

    const stats = getTlsWriterStats();
    expect(stats.sendSuccesses).toBe(1);
    expect(stats.sendFailures).toBe(0);
    expect(errSpy).not.toHaveBeenCalled();
  });

  it("Producer.Start 失败时降级为 no-op writer 并 surface", () => {
    FakeProducer.nextStartError = new Error("dispatcher broken");
    const writer = createTlsLogWriter(VALID_CONFIG);

    expect(getTlsWriterStats().startFailures).toBe(1);
    expect(errSpy.mock.calls[0]![0]).toContain("[tls-writer] start: dispatcher broken");

    // 降级后 write/close 不抛、不触达 Producer。
    const producer = producerInstances[0]!;
    writer.write({ time: Date.now(), contents: [] });
    expect(producer.sendLogs).toHaveLength(0);
    return expect(writer.close()).resolves.toBeUndefined();
  });

  it("close 失败时 surface 且仍正常返回", async () => {
    const writer = createTlsLogWriter(VALID_CONFIG);
    producerInstances[0]!.closeReject = new Error("close timeout");

    await expect(writer.close()).resolves.toBeUndefined();
    expect(getTlsWriterStats().closeFailures).toBe(1);
    expect(errSpy.mock.calls[0]![0]).toContain("[tls-writer] close: close timeout");
  });

  it("同类错误在节流间隔内只输出一次", async () => {
    vi.stubEnv("TLS_SURFACE_INTERVAL_MS", "60000");
    const writer = createTlsLogWriter(VALID_CONFIG);
    const producer = producerInstances[0]!;
    producer.sendLogError = new Error("boom");

    writer.write({ time: Date.now(), contents: [] });
    await flushMicrotasks();
    writer.write({ time: Date.now(), contents: [] });
    await flushMicrotasks();

    expect(getTlsWriterStats().enqueueFailures).toBe(2);
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(errSpy.mock.calls[0]![0]).toContain("total=1");
  });

  it("TLS_DEBUG 时节流失效，逐条输出", async () => {
    vi.stubEnv("TLS_DEBUG", "1");
    const writer = createTlsLogWriter(VALID_CONFIG);
    const producer = producerInstances[0]!;
    producer.sendLogError = new Error("boom");

    writer.write({ time: Date.now(), contents: [] });
    await flushMicrotasks();
    writer.write({ time: Date.now(), contents: [] });
    await flushMicrotasks();

    expect(errSpy).toHaveBeenCalledTimes(2);
    expect(errSpy.mock.calls[1]![0]).toContain("total=2");
  });

  it("TLS_DEBUG 时 CallBack.Success 输出 requestId", () => {
    vi.stubEnv("TLS_DEBUG", "1");
    const writer = createTlsLogWriter(VALID_CONFIG);
    writer.write({ time: Date.now(), contents: [] });
    lastCallBack(producerInstances[0]!).Success({ Attempts: [{ RequestId: "req-9" }] });
    expect(errSpy.mock.calls[0]![0]).toContain("send ok (requestId=req-9)");
  });

  it("TLS_DEBUG=0 视为关闭，节流仍生效", async () => {
    vi.stubEnv("TLS_DEBUG", "0");
    const writer = createTlsLogWriter(VALID_CONFIG);
    const producer = producerInstances[0]!;
    producer.sendLogError = new Error("boom");

    writer.write({ time: Date.now(), contents: [] });
    await flushMicrotasks();
    writer.write({ time: Date.now(), contents: [] });
    await flushMicrotasks();

    expect(getTlsWriterStats().enqueueFailures).toBe(2);
    expect(errSpy).toHaveBeenCalledTimes(1);
  });

  it("CallBack 收到畸形 result 时不抛错", () => {
    const writer = createTlsLogWriter(VALID_CONFIG);
    writer.write({ time: Date.now(), contents: [] });
    const callBack = lastCallBack(producerInstances[0]!) as unknown as {
      Success: (r: unknown) => void;
      Fail: (r: unknown) => void;
    };

    expect(() => callBack.Fail(null)).not.toThrow();
    expect(() => callBack.Success(undefined)).not.toThrow();
    const stats = getTlsWriterStats();
    expect(stats.sendFailures).toBe(1);
    expect(stats.sendSuccesses).toBe(1);
    expect(errSpy.mock.calls[0]![0]).toContain("batch send failed after all retries");
  });

  it("getTlsWriterStats 返回深拷贝，消费者改写不污染内部状态", async () => {
    const writer = createTlsLogWriter(VALID_CONFIG);
    const producer = producerInstances[0]!;
    producer.sendLogError = new Error("boom");
    writer.write({ time: Date.now(), contents: [] });
    await flushMicrotasks();

    const snapshot = getTlsWriterStats();
    expect(snapshot.lastError).not.toBeNull();
    snapshot.lastError!.message = "tampered";
    expect(getTlsWriterStats().lastError?.message).toBe("boom");
  });
});

describe("默认 writer 与停机超时兜底", () => {
  it("配置不全时默认 writer 为 no-op，不实例化 Producer", async () => {
    vi.stubEnv("TLS_ENDPOINT", "");
    const writer = getDefaultTlsLogWriter();
    writer.write({ time: Date.now(), contents: [] });
    await closeDefaultTlsLogWriter();
    expect(producerInstances).toHaveLength(0);
  });

  it("closeDefaultTlsLogWriter 在 Producer.Close 挂起时按超时返回", async () => {
    for (const [key, value] of Object.entries(FULL_ENV)) {
      vi.stubEnv(key, value);
    }
    getDefaultTlsLogWriter();
    const producer = producerInstances[0]!;
    // 挂起 Close，模拟 TLS 不可达时在途重试阻塞优雅关闭。
    producer.closeResolve = () => {};

    const start = Date.now();
    await closeDefaultTlsLogWriter(100);
    expect(Date.now() - start).toBeLessThan(2_000);

    // 默认 writer 已重置：再次获取会新建实例。
    getDefaultTlsLogWriter();
    expect(producerInstances).toHaveLength(2);
    await closeDefaultTlsLogWriter();
  });
});
