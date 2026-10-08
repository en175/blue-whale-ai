import { describe, expect, it } from "vitest";

import {
  enqueueFailureLog,
  isRocketMqEndpointsMissingError,
  loadRocketMqConfig,
} from "./rocketmq-producer.js";

describe("loadRocketMqConfig", () => {
  it("默认值：endpoints 空、sslEnabled false——topic / tag 不在配置里（无 env 覆盖）", () => {
    expect(loadRocketMqConfig({})).toEqual({
      endpoints: "",
      sslEnabled: false,
    });
  });

  it("完整配置：endpoints/AK/SK/ssl 全部生效，topic / tag 残留键被忽略", () => {
    expect(
      loadRocketMqConfig({
        ROCKETMQ_ENDPOINTS: "115.190.244.91:8081",
        ROCKETMQ_ACCESS_KEY: "AK123",
        ROCKETMQ_SECRET_KEY: "SK456",
        ROCKETMQ_SSL_ENABLED: "true",
        ROCKETMQ_TOPIC: "generation-video",
        ROCKETMQ_TAG: "step",
      }),
    ).toEqual({
      endpoints: "115.190.244.91:8081",
      sslEnabled: true,
      accessKey: "AK123",
      accessSecret: "SK456",
    });
  });

  it("只配一个凭证时不携带 credentials（避免半套 AK/SK 被误用）", () => {
    const config = loadRocketMqConfig({ ROCKETMQ_ACCESS_KEY: "AK" });
    expect(config.accessKey).toBeUndefined();
    expect(config.accessSecret).toBeUndefined();
  });
});

describe("isRocketMqEndpointsMissingError（IKJ80Q）", () => {
  it("endpoints 缺配错误（getStartedRocketMqProducer 的抛错文案）→ true", () => {
    expect(
      isRocketMqEndpointsMissingError(
        new Error(
          "未配置 ROCKETMQ_ENDPOINTS（测试环境 gRPC 端点，如 115.190.244.91:8081）",
        ),
      ),
    ).toBe(true);
  });

  it("其他错误与非 Error 值 → false（真派发失败保持 ERROR）", () => {
    expect(isRocketMqEndpointsMissingError(new Error("gRPC 通道断开"))).toBe(
      false,
    );
    expect(
      isRocketMqEndpointsMissingError("未配置 ROCKETMQ_ENDPOINTS"),
    ).toBe(false);
    expect(isRocketMqEndpointsMissingError(undefined)).toBe(false);
  });
});

describe("enqueueFailureLog（IKJ80I 收敛 IKJ80Q 六处同型 catch）", () => {
  const ctx = { scope: "generation", kind: "retry video", jobId: "77" };

  it("缺配 → warn + 恢复扫描兜底文案（含 scope/kind/jobId）", () => {
    const log = enqueueFailureLog(
      new Error("未配置 ROCKETMQ_ENDPOINTS（测试环境 gRPC 端点，如 115.190.244.91:8081）"),
      ctx,
    );
    expect(log.level).toBe("warn");
    expect(log.message).toBe(
      "[generation] retry video job 未经 MQ 派发（未配置 ROCKETMQ_ENDPOINTS），将由 worker 恢复扫描捞起消费: jobId=77",
    );
  });

  it("真派发失败 → error + 原始 message；非 Error 抛出物兜底 unknown", () => {
    expect(enqueueFailureLog(new Error("gRPC 通道断开"), ctx)).toEqual({
      level: "error",
      message: "[generation] enqueue retry video job failed: gRPC 通道断开",
    });
    expect(enqueueFailureLog("boom", ctx)).toEqual({
      level: "error",
      message: "[generation] enqueue retry video job failed: unknown",
    });
  });
});
