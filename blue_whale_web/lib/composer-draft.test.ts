// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  clearComposerDraft,
  draftStorageKey,
  loadComposerDraft,
  saveComposerDraft,
} from "./composer-draft";

describe("composer-draft（Composer 草稿按 Project 持久化）", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("保存后可按同一 projectId 恢复", () => {
    saveComposerDraft("p1", "想做一张海报");
    expect(loadComposerDraft("p1")).toBe("想做一张海报");
  });

  it("不同 projectId 的草稿互不串扰", () => {
    saveComposerDraft("p1", "甲项目草稿");
    saveComposerDraft("p2", "乙项目草稿");
    expect(loadComposerDraft("p1")).toBe("甲项目草稿");
    expect(loadComposerDraft("p2")).toBe("乙项目草稿");
  });

  it("无草稿时返回 null", () => {
    expect(loadComposerDraft("missing")).toBeNull();
  });

  it("保存空白文本等价于清除", () => {
    saveComposerDraft("p1", "先有内容");
    saveComposerDraft("p1", "   ");
    expect(loadComposerDraft("p1")).toBeNull();
  });

  it("clearComposerDraft 删除草稿", () => {
    saveComposerDraft("p1", "内容");
    clearComposerDraft("p1");
    expect(loadComposerDraft("p1")).toBeNull();
    expect(window.localStorage.getItem(draftStorageKey("p1"))).toBeNull();
  });

  it("存储键按 projectId 命名且带稳定前缀", () => {
    expect(draftStorageKey("p1")).toBe("blue-whale:canvas-composer-draft:p1");
  });
});
