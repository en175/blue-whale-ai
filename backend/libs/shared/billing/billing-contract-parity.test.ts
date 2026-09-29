import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/* ============================================================================
 * 计费契约的**跨语言对账**
 *
 * `usage.proto` 开宗明义：用量维度、规格键、MQ topic 这些跨进程字面量「三方必须逐字一致」，
 * 但**没有任何机制在守** —— 三处都是人肉同步，注释里写着「改一处必须改两处/三处」。
 * 这份测试就是那个机制。
 *
 * 为什么必须有它：这类漂移**不会报错**，只会表现成「预扣按一个数冻、结算按另一个数收」
 * 或者「事件发出去了但没人消费」——两边日志都正常，账面上静默地错。
 * 本仓已经漂过：`usage.imgOut` / `usage.audioOut` / `usage.cc` 三个维度只活在 proto 里，
 * Java 与 TS 里根本不存在（见下面的允许清单）。
 *
 * 做法照抄本仓既有的 `channel-table-parity.test.ts`：**解析对方语言的源码文本**
 * （跨语言在运行期拿不到对方的常量），且每条**先断言至少解析出一条** ——
 * 正则失效时整个 describe 变红，而不是静默空转成假绿。
 * ==========================================================================*/

/** 仓库根（本文件在 `backend/libs/shared/billing/` 下）。 */
const ROOT = new URL("../../../../", import.meta.url);

const JAVA_BILLING = "server/blue-whale-billing/src/main/java/com/bluewhale/billing/";
const JAVA_WORKER = "server/blue-whale-worker/src/main/java/com/bluewhale/worker/";
const PROTO = "contracts/proto/billing/v1/";

function read(relFromRoot: string): string {
  return readFileSync(new URL(relFromRoot, ROOT), "utf8");
}

/**
 * 去掉注释再抽字面量。
 *
 * ⚠️ 必须去注释：这几个文件里，被**注释掉的旧取值**和文档示例都带着同样的字面量，
 * 不去掉就会把「历史」当成「现状」对账，得出一份永远绿的假结论。
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

/** Java 枚举体里的 `NAME("literal", …)` → 取出那一串字面量。 */
function javaEnumLiterals(source: string, enumDecl: string): string[] {
  const body = source.slice(source.indexOf(enumDecl));
  const out: string[] = [];
  for (const m of body.matchAll(/^\s*[A-Z][A-Z0-9_]*\("([^"]+)"/gm)) out.push(m[1]);
  return out.sort();
}

/* ── 1. 用量维度：Java 枚举 ↔ TS 白名单 ─────────────────────────────────── */

const JAVA_USAGE_DIMS = javaEnumLiterals(
  // ⚠️ 路径跟着 Java 包的**角色**走，不跟着「以前在哪」走：`pricing` 现在是 `domain/pricing`
  //    （2026-09-26 的包结构重排把纯领域收进了 domain/）。**这条测试当时就是靠这一行红的**——
  //    重排只跑了 Java 套件，TS 套件没跑，于是「读不到文件」被 `read()` 直接抛出。
  stripComments(read(`${JAVA_BILLING}domain/pricing/UsageDim.java`)),
  "public enum UsageDim",
);

/** TS 侧「能当基准维度用」的白名单（`PRICING_BASE_UNITS`）。 */
const TS_PRICING_BASE_UNITS = (() => {
  const src = read("backend/libs/shared/model-capability/constants.ts");
  const start = src.indexOf("PRICING_BASE_UNITS");
  const body = src.slice(start, src.indexOf("]", start));
  return [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
})();

/**
 * ★ 只存在于 proto、尚未在 Java / TS 落地的维度 —— **显式允许清单**。
 *
 * 它们不是「漏改」，是契约先行、实现未跟。列在这里等于「我们知道自己欠着这三个」；
 * 哪天补上了，这份清单必须同步删掉（下面的 `toEqual` 会红），所以它不会腐烂成
 * 「反正一直绿」。反过来，将来有人往 proto 加第四个没落地的维度，也会在这里红 ——
 * 而不是让它安静地变成一句空承诺。
 */
const PROTO_ONLY_DIMS = ["usage.audioOut", "usage.cc", "usage.imgOut"];

describe("★ 计费契约对账：用量维度", () => {
  it("Java UsageDim 与 TS PRICING_BASE_UNITS 逐字一致", () => {
    // 正则失效保护：一条都没解析出来时，下面那条 toEqual 会以「空 vs 非空」的形式红，
    // 但那条红会误导成「真的不一致」。这条先把它说清楚。
    expect(JAVA_USAGE_DIMS.length, "UsageDim 枚举没解析出任何一条，正则失效了").toBeGreaterThan(
      5,
    );
    expect(TS_PRICING_BASE_UNITS.length, "PRICING_BASE_UNITS 没解析出任何一条").toBeGreaterThan(5);

    // 两边是**同一份键集**：Java 少一个 ⇒ 指标报的维度用不上；TS 多一个 ⇒ 运营能存进一个
    // billing 认不出的维度（存进去那一刻不报错，用户提交时才炸）
    expect(TS_PRICING_BASE_UNITS).toEqual(JAVA_USAGE_DIMS);
  });

  it("proto 声明的维度里，多出来的必须正好是**已知欠着**的那几个", () => {
    const proto = [
      ...new Set(
        [...read(`${PROTO}usage.proto`).matchAll(/usage\.[A-Za-z]+/g)].map((m) => m[0]),
      ),
    ].sort();
    expect(proto.length, "usage.proto 里没解析出任何维度").toBeGreaterThan(5);

    const protoOnly = proto.filter((dim) => !JAVA_USAGE_DIMS.includes(dim));
    // 精确相等（不是「包含」）：补实现了要删清单，新欠了要加清单 —— 两个方向都会红
    expect(protoOnly).toEqual(PROTO_ONLY_DIMS);
  });
});

/* ── 2. 规格键：TS ↔ Java worker ───────────────────────────────────────── */

const TS_SPECS = read("backend/libs/shared/billing/billing-specs.ts");
const JAVA_SETTLEMENT = stripComments(
  read(`${JAVA_WORKER}domain/contract/SettlementUsageLines.java`),
);

/** 从一个文件里抠出 `KEY = 'value'` 形式的字符串常量。 */
function tsConst(source: string, name: string): string {
  const m = source.match(new RegExp(`export const ${name}\\s*=\\s*['"]([^'"]+)['"]`));
  expect(m, `没在 TS 里找到常量 ${name}，正则失效了`).not.toBeNull();
  return m![1];
}

/** 从一个文件里抠出 `NAME = "value";` 形式的字符串常量。 */
function javaConst(source: string, name: string): string {
  const m = source.match(new RegExp(`String ${name}\\s*=\\s*"([^"]+)"`));
  expect(m, `没在 Java 里找到常量 ${name}，正则失效了`).not.toBeNull();
  return m![1];
}

describe("★ 计费契约对账：规格键", () => {
  it("视频档的规格键与取值两边逐字一致", () => {
    // 它决定视频 token 的**单价档**（火山官方分「输入不含视频 / 输入包含视频」）。
    // 两边分叉 = 预扣按一档冻、结算按另一档收 —— 账平、无告警、钱错。
    expect(tsConst(TS_SPECS, "VIDEO_TIER_KEY")).toBe(javaConst(JAVA_SETTLEMENT, "VIDEO_TIER"));
    expect(javaConst(JAVA_SETTLEMENT, "VIDEO_TIER_WITH")).toBe(
      TS_SPECS.match(/with:\s*'([^']+)'/)?.[1],
    );
    expect(javaConst(JAVA_SETTLEMENT, "VIDEO_TIER_WITHOUT")).toBe(
      TS_SPECS.match(/without:\s*'([^']+)'/)?.[1],
    );
  });

  it("输入视频时长（秒）的规格键两边逐字一致", () => {
    // 含视频输入时官方公式要把**输入时长**加进 token 估算；量不到就整个键不写（拒绝而不是按 0 估）
    expect(javaConst(JAVA_SETTLEMENT, "VIDEO_INPUT_SECONDS")).toBe("video_input_seconds");
    expect(TS_SPECS).toContain("video_input_seconds");
  });

  it("参考素材数的规格键与预扣侧口径同源", () => {
    // 预扣侧走规格键（`specs.reference_count`），结算侧走 quantity（`usage.referenceCount`）——
    // 两条路，但取值口径必须靠同一份 referenceList 定义对齐
    expect(TS_SPECS).toContain("reference_count");
    expect(JAVA_SETTLEMENT).toContain("referenceList");
  });
});

/* ── 3. MQ topic：生产者与消费者 ───────────────────────────────────────── */

/**
 * ⚠️ topic 名**两边都不写在代码里**，都走「配置项 + 默认值」：
 *   · billing 消费者：`application.yml` 的 `billing.mq.topic-completed`，可被 `BILLING_MQ_TOPIC_COMPLETED` 覆盖
 *   · worker 生产者：`JobSettlementPublisher` 的 `worker.billing.topic-completed`，可被同名 Spring 属性覆盖
 *
 * 所以要对的是**两处的默认值**，不是源码里有没有那个字符串 —— 这正是我第一次写这条测试时
 * 踩的坑（假设字面量在 Java 文件里，结果 billing 侧一个都解析不出来）。
 *
 * ⚠️ 已知的部署隐患（这条测试**管不了**，只能写在这里让人看见）：两边的**覆盖变量名不同**，
 * 且分属两套配置系统。只设一边、或设成不同的值，就会「生产者往 A 发、消费者在 B 等」——
 * 钱不会错，但会永远冻着，且两边日志都正常。要根治得让两边共用一个配置源，不在本次范围。
 */
function billingDefaultTopics(): string[] {
  const yml = read("server/blue-whale-billing/src/main/resources/application.yml");
  return [
    ...new Set(
      [...yml.matchAll(/topic-\w+:\s*\$\{[^:}]+:([^}]+)\}/g)].map((m) => m[1].trim()),
    ),
  ].sort();
}

function workerDefaultTopics(): string[] {
  const src = read(`${JAVA_WORKER}application/service/JobSettlementPublisher.java`);
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
    // ⚠️ 这是最致命的一类漂移：**只改一处 = 事件发出去了但没人消费**。
    //    钱不会错，但会永远冻着 —— 而且没有任何报错，只能靠对账发现。
    const producer = workerDefaultTopics();
    const consumer = billingDefaultTopics();
    expect(producer.length, "worker 侧没解析出 topic 默认值，正则失效了").toBe(2);
    expect(consumer.length, "billing 侧没解析出 topic 默认值，正则失效了").toBe(2);
    expect(consumer).toEqual(producer);
  });

  it("没有任何一边冒出这两个之外的 generation-job-* topic", () => {
    // 挡住「改名改了一半」：新名出现在一处、旧名还在另一处时上一条会红；
    // 这条则挡住「两边都写了个新名的变体」这种更难查的情况。
    const EXPECTED = ["generation-job-completed", "generation-job-failed"];
    expect(billingDefaultTopics()).toEqual(EXPECTED);
    expect(workerDefaultTopics()).toEqual(EXPECTED);
  });
});

/* ── 4. 错误码：Java 码表 ↔ TS 反解常量 ↔ proto 失败语义注释 ─────────────── */

/**
 * Java 侧的**唯一**码表（`BillingErrorTaxonomy.Code` 枚举）。
 *
 * 三处传输层（用户面 gRPC / 管理面 gRPC / 管理面 HTTP）此前各持一份同名字面量，
 * 靠注释写着「改一处等于三处」—— 没有任何机制守。现在只有这一份。
 *
 * 同时取出每个码配的 gRPC status：调用方是按 **(状态, 原因词) 一起判**的，
 * 只对原因词那一半对账，状态漂了不会有任何东西红。
 */
const JAVA_ERROR_CODE_ROWS = (() => {
  const src = stripComments(read(`${JAVA_BILLING}adapter/inbound/BillingErrorTaxonomy.java`));
  const body = src.slice(src.indexOf("public enum Code"));
  return [...body.matchAll(/^\s*([A-Z][A-Z0-9_]*)\(\s*"([^"]+)"\s*,\s*Status\.Code\.([A-Z_]+)/gm)].map(
    (m) => ({ name: m[1], wire: m[2], grpc: m[3] }),
  );
})();

const JAVA_ERROR_CODES = JAVA_ERROR_CODE_ROWS.map((row) => row.wire).sort();

/**
 * TS 侧用来**反解** status description 的原因词常量。
 *
 * `toBillingHoldError` 拿它们对 `error.rawMessage` 做 `includes` —— 服务端换个措辞，
 * 这里就静默匹配不上、退化成 502，两边日志都正常。
 */
const TS_REASON_WORDS = (() => {
  const src = read("backend/libs/shared/billing/billing-client.ts");
  return [...src.matchAll(/const\s+REASON_[A-Z0-9_]+\s*=\s*'([A-Z_]+)'/g)]
    .map((m) => m[1])
    .sort();
})();

describe("★ 计费契约对账：错误码", () => {
  it("Java 码表就是这六个", () => {
    // 显式列举而不是「大于 N 条」：**增删一个码都是一次契约变更**，
    // 应该在这条上红一次、逼人确认（proto 注释、TS 反解、调用方都要跟着看），
    // 而不是安静地滑过去。
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

    // 常量名与 wire 字面量必须同名：不同名的话「改这个码」要改两处，而常量名那一处
    // 不在 wire 上 —— 改漏了不会有任何东西红，只会在读代码时让人以为有第二个码。
    expect(
      JAVA_ERROR_CODE_ROWS.map((row) => row.name).sort(),
      "枚举常量名与 wire 字面量不一致",
    ).toEqual(JAVA_ERROR_CODES);
  });

  it("★ TS 侧反解用的每个原因词，都在 Java 码表里", () => {
    // 这条守的正是那个**静默**失败：TS 按字面量反解 status description，
    // Java 改码或改措辞 → 匹配不上 → 落到 502 `billing_error`，没有任何信号。
    expect(TS_REASON_WORDS.length, "billing-client.ts 没解析出 REASON_* 常量，正则失效了")
      .toBeGreaterThan(1);

    for (const word of TS_REASON_WORDS) {
      expect(JAVA_ERROR_CODES, `TS 反解的原因词 ${word} 不在 Java 码表里`).toContain(word);
    }
  });

  it("proto 失败语义注释里的「状态 / 原因词」两半，都与 Java 码表对得上", () => {
    // proto 是契约本身：它写 `→ <gRPC status> / <原因词>`。
    // ⚠️ 只取斜杠后那一半是不够的 —— 状态那一半漂了不会有任何东西红，
    //    而调用方正是按 (状态, 原因词) **一起**判的（见 toBillingHoldError）。
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
    // 这条是「单一定义点」本身的守卫。没有它，下一份码表会以「就近方便」为由长回来 ——
    // 而三份同名字面量恰恰是此前那套「改一处、漏两处」的成因。
    const adapters = [
      `${JAVA_BILLING}adapter/inbound/grpc/BillingGrpcService.java`,
      `${JAVA_BILLING}adapter/inbound/grpc/BillingAdminGrpcService.java`,
      `${JAVA_BILLING}adapter/inbound/http/AdminExceptionHandler.java`,
    ];

    for (const path of adapters) {
      expect(
        stripComments(read(path)),
        `${path} 又自持了一份错误码表 —— 码只该在 BillingErrorTaxonomy 定义`,
      ).not.toMatch(/static\s+final\s+String\s+CODE_[A-Z0-9_]+\s*=/);
    }
  });
});
