export interface WorkerInputAsset {
  id: string;
  type: string;
  url: string;
  mime: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  material_id: string | null;
}

export interface AssetMediaInfo {
  durationMs: number;
  width: number | null;
  height: number | null;
}

export interface AssetOwnershipOps {
  resolveInputAssets(
    assetIds: string[],
    userId: string,
    projectId: string,
  ): Promise<WorkerInputAsset[]>;
  findStorageKeys(
    assetIds: string[],
    userId: string,
    projectId: string,
  ): Promise<Map<string, string>>;
  saveMediaInfo(assetId: string, info: AssetMediaInfo): Promise<boolean>;
}
