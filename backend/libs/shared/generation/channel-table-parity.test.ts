import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  CHANNEL_IDS,
  CHANNEL_MEDIA,
  CHANNELS,
  IMAGE_CHANNEL_PARSERS,
  IMAGE_PROTOCOLS,
  channelOf,
  defaultChannelFor,
  isChannelId,
  parseStoredChannel,
  validateChannel,
  validateRequestMapping,
} from "./image-channel-parser.js";
import { capabilityDigestFromModelCapability } from "../persistence/capability-digest.js";
import { serializePricingRule } from "./handle-create-generation-job.js";


const LEGACY_CHANNEL_IDS = ["seedream", "gpt-inline", "gpt-openai", "banana"] as const;

function read(relFromThisFile: string): string {
  return readFileSync(new URL(relFromThisFile, import.meta.url), "utf8");
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, "").replace(/--.*$/, ""))
    .join("\n");
}

interface ChannelRow {
  id: string;
  media: string;
  parser: string | null;
  protocol: string | null;
}

const JAVA_CHANNEL = read(
  "../../../../server/blue-whale-worker/src/main/java/com/bluewhale/worker/application/processor/ImageChannel.java",
);
const JAVA_PROTOCOL = read(
  "../../../../server/blue-whale-worker/src/main/java/com/bluewhale/worker/infrastructure/gateway/ImageProtocol.java",
);
const WEB_FORM = read("../../../../web/src/admin/pages/ModelList/model-form.ts");
const MIGRATION = read(
  "../../../prisma/migrations/20260926020000_generation_model_capability_channel/migration.sql",
);

function javaProtocolWireValues(source: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of source.matchAll(/^\s*([A-Z][A-Z0-9_]*)\("([^"]+)"\)/gm)) {
    out.set(m[1], m[2]);
  }
  return out;
}

function javaChannelRows(source: string, protocolWire: Map<string, string>): ChannelRow[] {
  const rows: ChannelRow[] = [];
  const re =
    /^\s*[A-Z][A-Z0-9_]*\("([^"]+)",\s*"([^"]+)",\s*(?:"([^"]+)"|null),\s*(?:ImageProtocol\.([A-Z_]+)|null)\)/gm;
  for (const m of source.matchAll(re)) {
    const protocolConstant = m[4];
    const protocol =
      protocolConstant === undefined
        ? null
        : (protocolWire.get(protocolConstant) ??
          `??未识别的协议常量:${protocolConstant}`);
    rows.push({ id: m[1], media: m[2], parser: m[3] ?? null, protocol });
  }
  return rows;
}

function sliceChannelsBlock(source: string): string {
  const start = source.indexOf("export const CHANNELS = [");
  expect(start, "model-form.ts 里找不到 CHANNELS 表").toBeGreaterThanOrEqual(0);
  const end = source.indexOf("] as const", start);
  expect(end, "CHANNELS 表没有 `] as const` 结尾").toBeGreaterThan(start);
  return source.slice(start, end);
}

function webChannelRows(source: string): ChannelRow[] {
  const block = sliceChannelsBlock(source);
  const rows: ChannelRow[] = [];
  for (const m of block.matchAll(/\{[^{}]*\}/g)) {
    const body = m[0];
    const field = (name: string): string | null | undefined => {
      const quoted = new RegExp(`${name}:\\s*'([^']+)'`).exec(body);
      if (quoted) return quoted[1];
      return new RegExp(`${name}:\\s*null`).test(body) ? null : undefined;
    };
    const id = field("id");
    if (id === undefined || id === null) continue;
    const media = field("media");
    if (media === undefined || media === null) continue;
    const parser = field("parser");
    const protocol = field("protocol");
    rows.push({
      id,
      media,
      parser: parser === undefined ? "??缺 parser 字段" : parser,
      protocol: protocol === undefined ? "??缺 protocol 字段" : protocol,
    });
  }
  return rows;
}

function migrationChannelLiterals(source: string): string[] {
  const stripped = stripComments(source);
  const out = new Set<string>();
  for (const m of stripped.matchAll(/\bTHEN\s+'([^']+)'/g)) out.add(m[1]);
  for (const m of stripped.matchAll(/\bELSE\s+'([^']+)'/g)) out.add(m[1]);
  return [...out];
}

function normalize(rows: ChannelRow[]): ChannelRow[] {
  return [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const TS_ROWS: ChannelRow[] = CHANNELS.map((c) => ({
  id: c.id,
  media: c.media,
  parser: c.parser,
  protocol: c.protocol,
}));
const JAVA_ROWS = javaChannelRows(JAVA_CHANNEL, javaProtocolWireValues(JAVA_PROTOCOL));
const WEB_ROWS = webChannelRows(WEB_FORM);

describe("渠道表跨语言对账", () => {
  it("解析到了渠道（防正则静默失效导致整个 describe 空转）", () => {
    expect(TS_ROWS.length, "TS 渠道表应至少解析出一条").toBeGreaterThan(0);
    expect(JAVA_ROWS.length, "worker-java ImageChannel 应至少解析出一条").toBeGreaterThan(0);
    expect(WEB_ROWS.length, "前端 CHANNELS 应至少解析出一条").toBeGreaterThan(0);
    expect(javaProtocolWireValues(JAVA_PROTOCOL).size, "ImageProtocol 应至少解析出两条").toBe(2);
  });

  it("① 三端 id 集合相等（写闸门 = worker = 前端可编辑）", () => {
    const ids = (rows: ChannelRow[]) => rows.map((r) => r.id).sort();
    expect(ids(JAVA_ROWS)).toEqual(ids(TS_ROWS));
    expect(ids(WEB_ROWS)).toEqual(ids(TS_ROWS));
  });

  it("② 每条的 (media, parser, protocol) 逐条相等", () => {
    expect(normalize(JAVA_ROWS)).toEqual(normalize(TS_ROWS));
    expect(normalize(WEB_ROWS)).toEqual(normalize(TS_ROWS));
  });

  it("③ 渠道取值集合 == 迁移回填里的字面值集合（新增渠道必须同时回填存量）", () => {
    expect(migrationChannelLiterals(MIGRATION).sort()).toEqual([...CHANNEL_IDS].sort());
  });

  it("④ 写闸门枚举 == 前端可编辑枚举（两端各自实现，靠本断言锁一致）", () => {
    for (const row of TS_ROWS) {
      expect(isChannelId(row.id), `写闸门不收「${row.id}」`).toBe(true);
    }
    for (const row of WEB_ROWS) {
      expect(isChannelId(row.id), `前端可编辑但写闸门不收「${row.id}」`).toBe(true);
    }
  });

  it("★ 旧前端取值一律不认（R2：同义不同名，缓存页面提交必须被拒而不是被当成别的渠道）", () => {
    for (const legacy of LEGACY_CHANNEL_IDS) {
      expect(isChannelId(legacy), `旧取值「${legacy}」不该被认作渠道`).toBe(false);
    }
    expect(CHANNEL_IDS.filter((id) => (LEGACY_CHANNEL_IDS as readonly string[]).includes(id))).toEqual([]);
  });

  it("⑤ 表里的 parser / protocol 没有孤儿分支（每个取值都有实现者）", () => {
    const parsers = [...new Set(TS_ROWS.map((r) => r.parser).filter((p): p is string => p !== null))].sort();
    expect(parsers).toEqual([...IMAGE_CHANNEL_PARSERS].sort());
    const orphanSample: Record<string, unknown> = {
      seedream: { matrix: 42 },
      gpt: { matrix: { "1K": { "1:1": "不是官方尺寸" } } },
      banana: { quality: {}, size: {} },
    };
    expect(Object.keys(orphanSample).sort(), "给了新解析器却没给它的哨兵样本").toEqual(parsers);
    for (const parser of parsers) {
      const err = validateRequestMapping(parser as never, orphanSample[parser], null);
      expect(
        err,
        `解析器「${parser}」在 validateRequestMapping 里没有对应的校验分支`,
      ).toContain(parser);
    }
    const protocols = [...new Set(TS_ROWS.map((r) => r.protocol).filter((p): p is string => p !== null))].sort();
    expect(protocols).toEqual([...IMAGE_PROTOCOLS].sort());
  });

  it("⑥ 非图片渠道的 parser / protocol 必须为 null（配了也没人读）", () => {
    for (const row of TS_ROWS) {
      if (row.media === "image") continue;
      expect(row.parser, `${row.id} 是非图片渠道，不该有解析器`).toBeNull();
      expect(row.protocol, `${row.id} 是非图片渠道，不该有出站协议`).toBeNull();
    }
    for (const row of TS_ROWS) {
      if (row.media !== "image") continue;
      expect(row.parser, `${row.id} 是图片渠道，必须有解析器`).not.toBeNull();
      expect(row.protocol, `${row.id} 是图片渠道，必须有出站协议`).not.toBeNull();
    }
  });

  it("媒介取值与能力行的 capability_type 同域（后端对不上就永远回落）", () => {
    expect([...CHANNEL_MEDIA].sort()).toEqual(["audio", "image", "text", "video"]);
    for (const row of TS_ROWS) {
      expect(CHANNEL_MEDIA).toContain(row.media);
    }
  });
});

describe("渠道读侧归一与写侧闸门", () => {
  it("★ 列为 NULL / 认不出 → 按**行的媒介**回落（video 行不会落到图片渠道）", () => {
    expect(parseStoredChannel(null, "image")).toBe("seedream-image");
    expect(parseStoredChannel(null, "video")).toBe("seedream-video");
    expect(parseStoredChannel(null, "audio")).toBe("seedream-audio");
    expect(parseStoredChannel(null, "text")).toBe("seedream-text");
    expect(parseStoredChannel("随便写的", "video")).toBe("seedream-video");
    expect(parseStoredChannel(null, undefined)).toBe("seedream-image");
    for (const media of CHANNEL_MEDIA) {
      expect(channelOf(defaultChannelFor(media)).media).toBe(media);
    }
  });

  it("★ 归一（trim + 小写）只用于比对，认得出取原表的规范拼写", () => {
    expect(parseStoredChannel("  GPT-Image-OpenAI  ", "image")).toBe("gpt-image-openai");
    expect(parseStoredChannel("SEEDREAM-VIDEO", "video")).toBe("seedream-video");
  });

  it("★ 写闸门拦「媒体与行的类型不一致」（漏了它，视频行能配成图片渠道而没人发现）", () => {
    expect(validateChannel("seedream-image", "image")).toBeNull();
    expect(validateChannel("seedream-video", "video")).toBeNull();
    expect(validateChannel("seedream-image", "video")).toMatch(/image/);
    expect(validateChannel("gpt-image", "text")).toMatch(/image/);
  });

  it("★ 写闸门不接受表外的取值，也不在类型缺失时静默放行", () => {
    expect(validateChannel("seedream", "image")).not.toBeNull();
    expect(validateChannel(undefined, "image")).not.toBeNull();
    expect(validateChannel(null, "image")).not.toBeNull();
    expect(validateChannel("seedream-image", undefined)).not.toBeNull();
    expect(validateChannel("seedream-image", "别的类型")).not.toBeNull();
  });
});

describe("★ 渠道不进钱路径（改渠道 ≠ 改金额）", () => {
  const capBase = {
    supported_sizes: [{ id: "1k", label: "1K" }],
    supported_aspect_ratios: ["1:1"],
    supported_durations: null,
    supported_formats: [],
    default_size: "1k",
    default_format: null,
    default_aspect_ratio: "1:1",
    default_duration: null,
  };
  const PRICING = { baseUnit: "constant:1", basePrice: { kind: "const", value: 30000 } };

  it("★ 渠道不进能力 digest（多一位会让历史快照全部误判漂移）", () => {
    expect(
      capabilityDigestFromModelCapability({ ...capBase, channel: "gpt-image" } as never),
    ).toBe(
      capabilityDigestFromModelCapability({ ...capBase, channel: "banana-image" } as never),
    );
  });

  it("★ 渠道不进 Hold 的规则快照文本（快照是 billing 结算的唯一输入）", () => {
    const a = serializePricingRule({ pricing: PRICING, channel: "seedream-image" } as never);
    const b = serializePricingRule({ pricing: PRICING, channel: "banana-image" } as never);
    expect(a).toBe(b);
    expect(a).not.toContain("banana-image");
  });

  it("★ 渠道不进 proto：Hold / Quote 请求里没有这个字段（跨进程契约面钉死）", () => {
    const proto = read("../../../../contracts/proto/billing/v1/billing.proto");
    expect(proto.length, "proto 读空 = 这条断言恒真").toBeGreaterThan(1000);
    expect(proto).not.toMatch(/\bchannel\b/);
  });

  it("★ 迁移不碰 pricing 一个字（这次只加列 + 回填）", () => {
    expect(stripComments(MIGRATION)).not.toContain("pricing");
    expect(stripComments(MIGRATION)).toContain("`channel`");
  });
});
