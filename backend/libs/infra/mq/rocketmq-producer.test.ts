import { describe, expect, it } from "vitest";

import { loadRocketMqConfig } from "./rocketmq-producer.js";

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
        // 修正六退役的两个键：部署环境残留也不得再影响投递（topic / tag 只来自编译期常量）。
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
