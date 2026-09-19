import { useQuery } from '@tanstack/react-query';
import { assetDetailQueryOptions, type AssetRecord } from '@/api/assets';

/**
 * 详情弹窗要渲染的资产（IKFTQW）：详情优先、列表兜底。
 *
 * 列表接口不返回 `prompt`，只有 `GET /api/assets/:assetId` 有；其余字段两边一致，
 * 所以详情只做增量覆盖，不做替换。三种情况都落回列表记录，弹窗都不会空窗：
 *
 * - 详情还没回来：列表记录先行渲染（点开即出图，不白屏）；
 * - 详情请求失败：保留列表记录继续展示（请求本身 `silent`，不弹错）；
 * - 用户切到了另一张资产：Query 按 id 分键，上一张的在途响应只会写进它自己 key
 *   的缓存，落不到当前弹窗（因此不需要画布那套手写 requestId 守卫）。
 *
 * `previewTarget` 为 null（弹窗已关）时走 `skipToken`，不发请求。
 */
export function usePreviewAsset(previewTarget: AssetRecord | null): AssetRecord | null {
  const detail = useQuery(assetDetailQueryOptions(previewTarget?.id ?? null));
  return detail.data ?? previewTarget;
}
