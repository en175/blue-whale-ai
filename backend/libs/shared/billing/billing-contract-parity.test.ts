import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";


const ROOT = new URL("../../../../", import.meta.url);

const JAVA_BILLING = "server/blue-whale-billing/src/main/java/com/bluewhale/billing/";
const JAVA_WORKER = "server/blue-whale-worker/src/main/java/com/bluewhale/worker/";
const PROTO = "contracts/proto/billing/v1/";

function read(relFromRoot: string): string {
  return readFileSync(new URL(relFromRoot, ROOT), "utf8");
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

function javaEnumLiterals(source: string, enumDecl: string): string[] {
  const body = source.slice(source.indexOf(enumDecl));
  const out: string[] = [];
  for (const m of body.matchAll(/^\s*[A-Z][A-Z0-9_]*\("([^"]+)"/gm)) out.push(m[1]);
  return out.sort();
}


const JAVA_USAGE_DIMS = javaEnumLiterals(
  stripComments(read(`${JAVA_BILLING}domain/pricing/UsageDim.java`)),
  "public enum UsageDim",
);

const TS_PRICING_BASE_UNITS = (() => {
  const src = read("backend/libs/shared/model-capability/constants.ts");
  const start = src.indexOf("PRICING_BASE_UNITS");
  const body = src.slice(start, src.indexOf("]", start));
  return [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
})();

describe("★ 计费契约对账：用量维度", () => {
  it("Java UsageDim 与 TS PRICING_BASE_UNITS 逐字一致", () => {
    expect(JAVA_USAGE_DIMS.length, "UsageDim 枚举没解析出任何一条，正则失效了").toBeGreaterThan(
      5,
    );
    expect(TS_PRICING_BASE_UNITS.length, "PRICING_BASE_UNITS 没解析出任何一条").toBeGreaterThan(5);

    expect(TS_PRICING_BASE_UNITS).toEqual(JAVA_USAGE_DIMS);
  });
});


function billingDefaultTopics(): string[] {
  const yml = read("server/blue-whale-billing/src/main/resources/application.yml");
  return [
    ...new Set(
      [...yml.matchAll(/topic-\w+:\s*\$\{[^:}]+:([^}]+)\}/g)].map((m) => m[1].trim()),
    ),
  ].sort();
}

function workerDefaultTopics(): string[] {
  const src = read(`${JAVA_WORKER}application/service/TerminalEventOutbox.java`);
  return [
    ...new Set(
      [...src.matchAll(/getProperty\(\s*"worker\.billing\.topic-\w+"\s*,\s*"([^"]+)"\s*\)/g)].map(
        (m) => m[1],
      ),
    ),
  ].sort();
}

describe("★ 计费契约对账：MQ topic", () => {
  it("生产者（worker）与消费者（billing）的 topic **默认值**完全相同", () => {
    const producer = workerDefaultTopics();
    const consumer = billingDefaultTopics();
    expect(producer.length, "worker 侧没解析出 topic 默认值，正则失效了").toBe(1);
    expect(consumer.length, "billing 侧没解析出 topic 默认值，正则失效了").toBe(1);
    expect(consumer).toEqual(producer);
  });

  it("没有任何一边冒出这个之外的 generation-job-* topic", () => {
    const EXPECTED = ["generation-job-terminal"];
    expect(billingDefaultTopics()).toEqual(EXPECTED);
    expect(workerDefaultTopics()).toEqual(EXPECTED);
  });

  it("两端都对终态 topic 应用环境后缀，漏一侧即红", () => {
    const producer = stripComments(
      read(`${JAVA_WORKER}application/service/TerminalEventOutbox.java`),
    );
    const consumer = stripComments(
      read(`${JAVA_BILLING}infrastructure/mq/JobEventConsumer.java`),
    );
    expect(producer, "worker 生产的终态 topic 未经 MqEnvSuffix.apply 包装").toContain(
      "MqEnvSuffix.apply(",
    );
    expect(consumer, "billing 订阅的终态 topic 未经 MqEnvSuffix.apply 包装").toContain(
      "MqEnvSuffix.apply(",
    );
  });
});


const JAVA_ERROR_CODE_ROWS = (() => {
  const src = stripComments(read(`${JAVA_BILLING}common/error/BillingErrorTaxonomy.java`));
  const body = src.slice(src.indexOf("public enum Code"));
  return [...body.matchAll(/^\s*([A-Z][A-Z0-9_]*)\(\s*"([^"]+)"\s*,\s*Status\.Code\.([A-Z_]+)/gm)].map(
    (m) => ({ name: m[1], wire: m[2], grpc: m[3] }),
  );
})();

const JAVA_ERROR_CODES = JAVA_ERROR_CODE_ROWS.map((row) => row.wire).sort();

const TS_REASON_WORDS = (() => {
  const src = read("backend/libs/shared/billing/billing-client.ts");
  return [...src.matchAll(/const\s+REASON_[A-Z0-9_]+\s*=\s*'([A-Z_]+)'/g)]
    .map((m) => m[1])
    .sort();
})();

describe("★ 计费契约对账：错误码", () => {
  it("Java 码表就是这六个", () => {
    expect(JAVA_ERROR_CODES.length, "BillingErrorTaxonomy.Code 没解析出任何一条").toBeGreaterThan(
      3,
    );
    expect(JAVA_ERROR_CODES).toEqual([
      "DUPLICATE",
      "INSUFFICIENT_CREDITS",
      "INTERNAL",
      "INVALID_ARGUMENT",
      "NOT_FOUND",
      "UNPRICEABLE",
    ]);

    expect(
      JAVA_ERROR_CODE_ROWS.map((row) => row.name).sort(),
      "枚举常量名与 wire 字面量不一致",
    ).toEqual(JAVA_ERROR_CODES);
  });

  it("★ TS 侧反解用的每个原因词，都在 Java 码表里", () => {
    expect(TS_REASON_WORDS.length, "billing-client.ts 没解析出 REASON_* 常量，正则失效了")
      .toBeGreaterThan(1);

    for (const word of TS_REASON_WORDS) {
      expect(JAVA_ERROR_CODES, `TS 反解的原因词 ${word} 不在 Java 码表里`).toContain(word);
    }
  });

  it("proto 失败语义注释里的「状态 / 原因词」两半，都与 Java 码表对得上", () => {
    const mentioned = [
      ...read(`${PROTO}billing.proto`).matchAll(/→\s*([A-Z_]+)\s*\/\s*([A-Z_]+)/g),
    ].map((m) => ({ grpc: m[1], wire: m[2] }));
    expect(mentioned.length, "proto 里没解析出「→ 状态 / 原因词」，正则失效了").toBeGreaterThan(1);

    for (const { grpc, wire } of mentioned) {
      const row = JAVA_ERROR_CODE_ROWS.find((r) => r.wire === wire);
      expect(row, `proto 里点名的 ${wire} 不在 Java 码表里`).toBeDefined();
      expect(row?.grpc, `${wire}：proto 配的状态与 Java 码表不一致`).toBe(grpc);
    }
  });

  it("码表只在 BillingErrorTaxonomy 一处定义：三处传输层不再自持", () => {
    const adapters = [
      `${JAVA_BILLING}api/grpc/BillingGrpcService.java`,
      `${JAVA_BILLING}api/grpc/BillingAdminGrpcService.java`,
      `${JAVA_BILLING}common/error/AdminExceptionHandler.java`,
    ];

    for (const path of adapters) {
      expect(
        stripComments(read(path)),
        `${path} 又自持了一份错误码表 —— 码只该在 BillingErrorTaxonomy 定义`,
      ).not.toMatch(/static\s+final\s+String\s+CODE_[A-Z0-9_]+\s*=/);
    }
  });
});
