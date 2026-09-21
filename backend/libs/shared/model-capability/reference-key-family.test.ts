import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// IKHEXG：参考上限键**族**的单一形态守卫。
//
// 病根不是某一处写错，而是「两套命名方案在不同时间点各自生长、没有任何机制强制统一」：
// `max_reference_images`（max_<东西>）与 `image_reference_max`（<媒介>_reference_max）撞在一起，
// 字面几乎一样、语义却不同，已实际造成误判与错配。
//
// 本测试把「族」钉死：凡形如 `<媒介>_reference_max` 的键，必须落在白名单内；且**跨进程的三处
// 枚举必须彼此相等**——后端写闸门、前端可编辑键白名单、前端表单标签表。任一处冒出新名字就红。

const EXPECTED = new Set([
  "image_reference_max",
  "video_reference_max",
  "audio_reference_max",
]);

/** 形如 `<任意>_reference_max` 的键——正是本族该有的命名形态。
 *  裸 token 匹配：三处枚举里它既可能是带引号的字符串（写闸门的数组、白名单 Set），
 *  也可能是不带引号的对象属性名（表单标签表）。 */
const FAMILY_SHAPE = /\b([a-z0-9_]+_reference_max)\b/g;

function read(relFromThisFile: string): string {
  return readFileSync(new URL(relFromThisFile, import.meta.url), "utf8");
}

function familyKeysIn(source: string): Set<string> {
  const found = new Set<string>();
  for (const m of source.matchAll(FAMILY_SHAPE)) found.add(m[1]);
  return found;
}

const backendGate = read("./constants.ts");
const webFormKeys = read("../../../../web/src/admin/pages/ModelList/model-form.ts");
const webFormLabels = read(
  "../../../../web/src/admin/pages/ModelList/ModelFormModal.tsx",
);

const SOURCES = {
  "backend 写闸门 constants.ts": backendGate,
  "web 可编辑键白名单 model-form.ts": webFormKeys,
  "web 表单标签表 ModelFormModal.tsx": webFormLabels,
};

describe("IKHEXG 参考上限键族守卫", () => {
  it("解析到了键（防正则静默失效导致整个 describe 空转）", () => {
    for (const [label, source] of Object.entries(SOURCES)) {
      expect(familyKeysIn(source).size, `${label} 应至少解析出一个键`).toBeGreaterThan(0);
    }
  });

  it.each(Object.entries(SOURCES))("%s 不含白名单外的参考上限键", (label, source) => {
    // 新键必须叫 `<媒介>_reference_max`；混进 `max_reference_images` 这类
    // 老方案的键名，或自造第四个名字，都视为命名方案再次分叉。
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
});
