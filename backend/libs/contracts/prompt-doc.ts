/* ============================================
 * 引用标签派生（IKFA1M 展示编号规则的存续部分）
 *
 * IKG6EK / ADR-0088：`prompt_doc` 已退役——正文由提交方给全（`parameters.prompt` 一律权威），
 * 服务端对提示词只做一件事：把正文里的引用标记 `&<身份>&` 按本次请求的素材顺序换成 `@标签`
 * （见 backend/libs/core/transfer-reference-markers.ts）。
 *
 * 本文件因此只保留「身份 → 展示编号」的派生：编号跟真实媒体输入顺序，编号不是身份。
 * doc 的结构 schema、身份复核与正文编译（compilePromptDoc / compileVideoPromptDoc）随契约退役。
 * 历史语义权威文档：docs/specs/2026-09-12-ikfa1m-image-prompt-ref-contract.md（已由 ADR-0088 取代）。
 * ============================================ */

/**
 * 展示编号派生：图片N = asset_id 在最终有效输入顺序（保序）中的下标 + 1。
 * 编号跟真实媒体输入顺序，不跟正文出现顺序；身份不在集合中返回 null（失效）。
 */
export function imageRefLabel(
  assetId: string,
  orderedAssetIds: readonly string[],
): string | null {
  const index = orderedAssetIds.indexOf(assetId);
  return index < 0 ? null : `图片${index + 1}`;
}

/* ============================================
 * IKFA1O：视频多媒体标签与首尾帧角色
 *
 * 视频参考集合即生成接纳的单数组 references（保序，帧在前）；
 * 标签文案按身份的实际角色/类型派生——首尾帧按角色显示，普通参考按
 * 同类型在 reference 序中的顺序连续编号（图片N/视频N/音频N）。
 * ============================================ */

/** 视频参考输入：references 单数组元素的编译投影（asset_id/material_id 统一为 id） */
export interface VideoRefItem {
  id: string;
  role: "first_frame" | "last_frame" | "reference";
  type: "image" | "video" | "audio";
}

const VIDEO_TYPE_LABELS: Record<VideoRefItem["type"], string> = {
  image: "图片",
  video: "视频",
  audio: "音频",
};

/**
 * 视频标签文案派生：首帧/尾帧按角色；普通参考按同类型顺序编号；身份不在集合返回 null（失效）。
 * 文案跟提交的 references 实际结构，不信任客户端 label 缓存（C1：角色变化同步标签）。
 */
export function videoRefLabel(
  refId: string,
  refs: readonly VideoRefItem[],
): string | null {
  const typeCounters = new Map<VideoRefItem["type"], number>();
  for (const ref of refs) {
    if (ref.role === "first_frame") {
      if (ref.id === refId) return "首帧";
      continue;
    }
    if (ref.role === "last_frame") {
      if (ref.id === refId) return "尾帧";
      continue;
    }
    const next = (typeCounters.get(ref.type) ?? 0) + 1;
    typeCounters.set(ref.type, next);
    if (ref.id === refId) return `${VIDEO_TYPE_LABELS[ref.type]}${next}`;
  }
  return null;
}

/**
 * IKG6EK / ADR-0088：引用标记（`&<身份>&`）的身份 → 标签表。
 *
 * 与 videoRefLabel 同一套规则（首尾帧按角色、普通参考按同类型顺序编号），
 * 供正文标记转移 `transferReferenceMarkers` 使用；返回的文案**不带 `@`**，
 * 前缀由转移函数统一补。
 *
 * 入参 refs 的 `id` = **本次 references 里该素材的身份原样**（`asset_id ?? material_id`）：
 * 本地 Asset 是纯数字 id，素材库 / 虚拟角色库是 `asset-` 前缀 id。**本函数不碰库、不做身份解析**
 * ——标记里写哪种身份，取决于提交方是以哪种身份提交的；把 material_id 转成上游载体是 worker 的事。
 * （早期实现曾在此做「本地 asset id → material 位次」的回查桥，随 ADR-0088 删除。）
 */
export function buildReferenceMarkerLabels(
  refs: readonly VideoRefItem[],
): Map<string, string> {
  const labels = new Map<string, string>();
  for (const ref of refs) {
    const label = videoRefLabel(ref.id, refs);
    if (label !== null) labels.set(ref.id, label);
  }
  return labels;
}
