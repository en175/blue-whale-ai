import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";


const EXPECTED = new Set([
  "image_reference_max",
  "video_reference_max",
  "audio_reference_max",
]);

const FAMILY_SHAPE = /\b([a-z0-9_]+_reference_max)\b/g;

function read(relFromThisFile: string): string {
  return readFileSync(new URL(relFromThisFile, import.meta.url), "utf8");
}

function familyKeysIn(source: string): Set<string> {
  const found = new Set<string>();
  for (const m of source.matchAll(FAMILY_SHAPE)) found.add(m[1]);
  return found;
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

const backendGate = read("./constants.ts");
const webFormKeys = read("../../../../web/src/admin/pages/ModelList/model-form.ts");
const webFormLabels = read("../../../../web/src/admin/enums/model.ts");

const SOURCES = {
  "backend 写闸门 constants.ts": backendGate,
  "web 可编辑键白名单 model-form.ts": webFormKeys,
  "web 表单标签表 admin/enums/model.ts": webFormLabels,
};

describe("IKHEXG 参考上限键族守卫", () => {
  it("解析到了键（防正则静默失效导致整个 describe 空转）", () => {
    for (const [label, source] of Object.entries(SOURCES)) {
      expect(familyKeysIn(source).size, `${label} 应至少解析出一个键`).toBeGreaterThan(0);
    }
  });

  it.each(Object.entries(SOURCES))("%s 不含白名单外的参考上限键", (label, source) => {
    const unexpected = [...familyKeysIn(source)].filter((k) => !EXPECTED.has(k));
    expect(unexpected, `${label} 出现白名单外的参考上限键`).toEqual([]);
  });

  it("后端写闸门收齐全三个键（漏一个就配不进库）", () => {
    const keys = familyKeysIn(backendGate);
    for (const expected of EXPECTED) expect(keys.has(expected), `写闸门缺 ${expected}`).toBe(true);
  });

  it("三处枚举彼此相等（跨进程契约 = HTTP JSON 形状，两端各自实现、靠本断言锁一致）", () => {
    const backend = familyKeysIn(backendGate);
    const form = familyKeysIn(webFormKeys);
    const labels = familyKeysIn(webFormLabels);
    expect(form).toEqual(backend);
    expect(labels).toEqual(backend);
  });

  it.each(Object.entries(SOURCES))("%s 不含已退役的旧键名（注释除外）", (label, source) => {
    expect(stripComments(source), `${label} 出现已退役的 max_reference_images`).not.toMatch(
      /max_reference_images|maxReferenceImages/,
    );
  });
});
