// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  NODE_TOOLBAR_ACTIONS,
  NODE_TOOLBAR_VIDEO_ACTIONS,
  NODE_TOOLBAR_AUDIO_ACTIONS,
  toolbarForKind,
} from "./config";

/**
 * D 跨模态：节点 toolbar 按 kind 动态跨模态入口（IJZY24）。
 * 图片→生成视频/音频；视频→提取音频/生成视频；音频→生成视频。
 */
describe("toolbar 按 kind 跨模态入口（D）", () => {
  it("图片 toolbar 含「生成音频」(audio)", () => {
    expect(NODE_TOOLBAR_ACTIONS.some((a) => a.id === "audio")).toBe(true);
  });

  it("视频 toolbar 含「提取音频」(extract-audio)", () => {
    expect(NODE_TOOLBAR_VIDEO_ACTIONS.some((a) => a.id === "extract-audio")).toBe(true);
  });

  it("audio toolbar 含「生成视频」(video)，不含 audio/extract-audio", () => {
    expect(NODE_TOOLBAR_AUDIO_ACTIONS.some((a) => a.id === "video")).toBe(true);
    expect(NODE_TOOLBAR_AUDIO_ACTIONS.some((a) => a.id === "audio")).toBe(false);
    expect(NODE_TOOLBAR_AUDIO_ACTIONS.some((a) => a.id === "extract-audio")).toBe(false);
  });

  it("audio toolbar 保留通用操作（重新编辑/下载/添加到对话）", () => {
    expect(NODE_TOOLBAR_AUDIO_ACTIONS.some((a) => a.id === "refresh")).toBe(true);
    expect(NODE_TOOLBAR_AUDIO_ACTIONS.some((a) => a.id === "download")).toBe(true);
    expect(NODE_TOOLBAR_AUDIO_ACTIONS.some((a) => a.id === "mention")).toBe(true);
  });
});

describe("toolbarForKind 按 kind 选 toolbar", () => {
  it("image → NODE_TOOLBAR_ACTIONS", () => {
    expect(toolbarForKind("image")).toBe(NODE_TOOLBAR_ACTIONS);
  });
  it("video → NODE_TOOLBAR_VIDEO_ACTIONS", () => {
    expect(toolbarForKind("video")).toBe(NODE_TOOLBAR_VIDEO_ACTIONS);
  });
  it("audio → NODE_TOOLBAR_AUDIO_ACTIONS", () => {
    expect(toolbarForKind("audio")).toBe(NODE_TOOLBAR_AUDIO_ACTIONS);
  });
  it("text/group → 默认 NODE_TOOLBAR_ACTIONS", () => {
    expect(toolbarForKind("text")).toBe(NODE_TOOLBAR_ACTIONS);
    expect(toolbarForKind("group")).toBe(NODE_TOOLBAR_ACTIONS);
  });
});
