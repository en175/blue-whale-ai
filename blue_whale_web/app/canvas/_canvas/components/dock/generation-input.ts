import {
  isWireInteger,
  wireInteger,
  wireIntegersEqual,
  type WireInteger,
} from "@/lib/wire-integer";

type AssetReference = {
  assetId?: WireInteger;
  type?: "image" | "video" | "audio";
};

function positiveAssetId(value: unknown): WireInteger | null {
  if (!isWireInteger(value) || BigInt(value) <= BigInt(0)) return null;
  return wireInteger(String(value));
}

function orderedReferences(
  mentionAssetIds: WireInteger[],
  media: AssetReference[],
): Array<{ id: WireInteger; type: "image" | "video" }> {
  const references: Array<{ id: WireInteger; type: "image" | "video" }> = [];
  const add = (value: unknown, type: "image" | "video") => {
    const id = positiveAssetId(value);
    if (id !== null && !references.some((item) => wireIntegersEqual(item.id, id))) {
      references.push({ id, type });
    }
  };
  for (const id of mentionAssetIds) add(id, "image");
  for (const item of media) {
    if (!item.type || item.type === "image") add(item.assetId, "image");
    else if (item.type === "video") add(item.assetId, "video");
  }
  return references;
}

export function validateImageDockReferences(
  mentionAssetIds: WireInteger[],
  media: AssetReference[],
  referenceImageSupported = true,
): string | null {
  const references = orderedReferences(mentionAssetIds, media);
  if (!referenceImageSupported && references.length > 0) {
    return "当前模型不支持参考图";
  }
  return references.length > 4 ? "图片生成最多支持 4 张参考图" : null;
}

export function validateVideoDockReferences(
  refModeId: string,
  mentionAssetIds: WireInteger[],
  media: AssetReference[],
  frames: {
    firstFrameAssetId?: WireInteger;
    lastFrameAssetId?: WireInteger;
    firstFrameUrl?: string;
    lastFrameUrl?: string;
  } = {},
): string | null {
  if (refModeId === "first-last") {
    const hasFirst = Boolean(frames.firstFrameAssetId || frames.firstFrameUrl);
    const hasLast = Boolean(frames.lastFrameAssetId || frames.lastFrameUrl);
    return hasLast && !hasFirst ? "请先添加首帧，再添加尾帧" : null;
  }
  const references = orderedReferences(mentionAssetIds, media);
  if (references.filter((item) => item.type === "image").length > 9) {
    return "视频生成最多支持 9 张参考图";
  }
  if (references.filter((item) => item.type === "video").length > 3) {
    return "视频生成最多支持 3 个参考视频";
  }
  return null;
}

export function selectDockInputAssetIds(
  mode: "image" | "video",
  mentionAssetIds: WireInteger[],
  media: AssetReference[],
  frameAssetIds: WireInteger[] = [],
): WireInteger[] {
  const candidates = [
    ...frameAssetIds,
    ...mentionAssetIds,
    ...media
      .filter(
        (item) =>
          !item.type ||
          item.type === "image" ||
          (mode === "video" && item.type === "video"),
      )
      .map((item) => item.assetId),
  ];
  const seen = new Set<string>();
  const ids = candidates.reduce<WireInteger[]>((result, candidate) => {
    const id = positiveAssetId(candidate);
    const key = id === null ? null : String(id);
    if (id !== null && key !== null && !seen.has(key)) {
      seen.add(key);
      result.push(id);
    }
    return result;
  }, []);
  return ids.slice(0, mode === "video" ? 12 : 4);
}

export function selectVideoDockAssetIds(
  refModeId: string,
  mentionAssetIds: WireInteger[],
  media: AssetReference[],
): { referenceAssetIds: WireInteger[] } {
  if (refModeId === "first-last") {
    return { referenceAssetIds: [] };
  }

  const referenceAssetIds = selectDockInputAssetIds(
    "video",
    mentionAssetIds,
    media,
  );
  return { referenceAssetIds };
}
