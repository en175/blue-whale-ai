// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import {
  clearDirectSkillBinding,
  readDirectSkillBinding,
  writeDirectSkillBinding,
} from "./direct-skill-binding";

const KEY = "bw.direct-skill-binding";

describe("direct-skill-binding（IK60WY 一次性绑定）", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("写入后可读回；清除后读不到", () => {
    expect(readDirectSkillBinding()).toBeNull();

    writeDirectSkillBinding({
      creative_skill_id: "poster_gen",
      name: "海报大师",
    });
    expect(readDirectSkillBinding()).toEqual({
      creative_skill_id: "poster_gen",
      name: "海报大师",
    });

    clearDirectSkillBinding();
    expect(readDirectSkillBinding()).toBeNull();
  });

  it("损坏或缺字段的存储内容 → 读为 null（不抛错）", () => {
    window.sessionStorage.setItem(KEY, "{oops");
    expect(readDirectSkillBinding()).toBeNull();

    window.sessionStorage.setItem(KEY, JSON.stringify({ name: "x" }));
    expect(readDirectSkillBinding()).toBeNull();

    window.sessionStorage.setItem(
      KEY,
      JSON.stringify({ creative_skill_id: " ", name: "x" }),
    );
    expect(readDirectSkillBinding()).toBeNull();
  });
});
