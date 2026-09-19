/** 参考素材输入（提交任务时归属解析结果）。与 worker 同名结构，仅保留 API 侧消费字段。 */
export interface WorkerInputAsset {
  id: string;
  type: string;
  url: string;
  mime: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  /** IKDJNZ：关联的素材库素材 id（生成时命中走 asset://，不走 url）；无关联为 null。 */
  material_id: string | null;
}

/** 提交任务时复用 worker 资产归属查询的窄接口（IKE7JP，归属逻辑单份不漂移）。 */
export interface AssetOwnershipOps {
  resolveInputAssets(
    assetIds: string[],
    userId: string,
    projectId: string,
  ): Promise<WorkerInputAsset[]>;
}
