type AssetReference = {
  assetId?: string | number;
  type?: "image" | "video" | "audio";
};

function positiveAssetId(value: unknown): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function selectDockInputAssetIds(
  mode: "image" | "video",
  mentionAssetIds: number[],
  media: AssetReference[],
  frameAssetIds: number[] = [],
): number[] {
  const candidates = [
    ...frameAssetIds,
    ...mentionAssetIds,
    ...media.filter((item) => !item.type || item.type === "image").map((item) => item.assetId),
  ];
  const ids = candidates.reduce<number[]>((result, candidate) => {
    const id = positiveAssetId(candidate);
    if (id !== null && !result.includes(id)) result.push(id);
    return result;
  }, []);
  return ids.slice(0, mode === "video" ? 6 : 4);
}
