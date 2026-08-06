import { beforeEach, describe, expect, it, vi } from "vitest";

const { FakeProducer, producerInstances } = vi.hoisted(() => {
  type AnyProducer = InstanceType<typeof FakeProducer>;
  const producerInstances: AnyProducer[] = [];

  class FakeProducer {
    config: unknown;
    started = false;
    closed = false;
    closeResolve: (() => void) | null = null;
    sendLogs: unknown[] = [];

    constructor(config: unknown) {
      this.config = config;
      producerInstances.push(this);
    }
    Start() {
      this.started = true;
    }
    SendLog(...args: unknown[]) {
      this.sendLogs.push(args);
      return Promise.resolve();
    }
    Close(): Promise<void> {
      this.closed = true;
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
  loadTlsWriterConfig,
} from "./tls-writer.js";

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

beforeEach(() => {
  producerInstances.length = 0;
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

  it("write 透传 topic/source/filename 与日志内容给 SendLog", () => {
    const writer = createTlsLogWriter(VALID_CONFIG);
    writer.write({
      time: 1_700_000_000_000,
      contents: [{ Key: "message", Value: "hello" }],
    });
    const producer = producerInstances[0]!;
    expect(producer.sendLogs).toHaveLength(1);
    expect(producer.sendLogs[0]).toEqual([
      "",
      "topic-x",
      "unit-test",
      "blue-whale-ai",
      { Time: 1_700_000_000_000, Contents: [{ Key: "message", Value: "hello" }] },
      undefined,
    ]);
  });

  it("close 调用 Producer.Close", async () => {
    const writer = createTlsLogWriter(VALID_CONFIG);
    await writer.close();
    expect(producerInstances[0]!.closed).toBe(true);
  });
});

describe("默认 writer 与停机超时兜底", () => {
  it("配置不全时默认 writer 为 no-op，不实例化 Producer", async () => {
    vi.stubEnv("TLS_ENDPOINT", "");
    const writer = getDefaultTlsLogWriter();
    writer.write({ time: Date.now(), contents: [] });
    await closeDefaultTlsLogWriter();
    expect(producerInstances).toHaveLength(0);
    vi.unstubAllEnvs();
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
    vi.unstubAllEnvs();
  });
});
