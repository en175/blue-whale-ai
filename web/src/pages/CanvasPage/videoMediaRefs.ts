/* ============================================
 * videoMediaRefs 视频参考角色连线（IKDMQS）：关系即连线 + 角色挂在 edge.data.refRole。
 * 三种角色：reference 普通参考（图/视频）/ first 首帧（图）/ last 尾帧（图）。
 * Dock 展示与生成提交共用同一推导，保证「显示输入 = 实际任务输入」。
 * 角色随 edges JSON 原样持久化（服务端零改动，延续 IKDMQR）。
 * ============================================ */
import type { Edge, Node } from '@xyflow/react';
import { readAssetId } from './mediaRefs';

/** 视频参考角色：reference 普通参考 / first 首帧 / last 尾帧 */
export type VideoRefRole = 'reference' | 'first' | 'last';

/** 普通参考中视频素材上限（能力接口无视频参考数量位；沿用前端固定 3，图片上限沿用 REF_LIMITS.image，
 *  与图片 Dock 同口径——能力侧约束由服务端校验兜底） */
export const MAX_VIDEO_REFS = 3;

/** 视频媒体参考项：nodeId 用于 Dock 移除时断开对应连线；assetId 进入提交字段；
 *  materialId 非空表示角色库素材（asset- 前缀素材库 ID，提交走 *_material_id/referenceMaterials） */
export interface VideoMediaRef {
  nodeId: string;
  url: string;
  name: string;
  assetId: string;
  mediaType: 'image' | 'video';
  materialId?: string;
}

/** 目标视频草稿的分组参考：首帧/尾帧各至多一项（连线时校验，推导时防御性取首条） */
export interface VideoMediaRefs {
  reference: VideoMediaRef[];
  first?: VideoMediaRef;
  last?: VideoMediaRef;
  invalid?: Array<{ nodeId: string; name: string; role: VideoRefRole; reason: string; materialId?: string }>;
}

/** 角色库素材参考（存草稿节点 data.draftMaterialRefs）：素材库 asset- 前缀 ID 无法落画布节点
 *  （画布按数字 assetId 从 snapshot.assets 取图），仅随草稿 data 持久化并在 Dock 槽位展示 */
export interface VideoMaterialRefData {
  materialId: string;
  url: string;
  name: string;
  mediaType: 'image' | 'video';
  role: VideoRefRole;
}

/** 防御性解析草稿 data.draftMaterialRefs：字段缺失或形态非法返回空数组（兼容旧快照，零迁移） */
export function readDraftMaterialRefs(node: Node | undefined): VideoMaterialRefData[] {
  if (!node) return [];
  const raw = (node.data ?? {}) as Record<string, unknown>['draftMaterialRefs'];
  if (!Array.isArray(raw)) return [];
  const items: VideoMaterialRefData[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const d = item as Record<string, unknown>;
    if (typeof d.materialId !== 'string' || !d.materialId) continue;
    if (typeof d.url !== 'string' || !d.url) continue;
    if (d.mediaType !== 'image' && d.mediaType !== 'video') continue;
    if (d.role !== 'reference' && d.role !== 'first' && d.role !== 'last') continue;
    items.push({
      materialId: d.materialId,
      url: d.url,
      name: typeof d.name === 'string' && d.name ? d.name : d.materialId,
      mediaType: d.mediaType,
      role: d.role,
    });
  }
  return items;
}

/** 合并边推导参考与角色库 material 参考：first/last 槽边推导优先，material 同角色项槽已占时落入 invalid；
 *  reference 追加尾部（上限由添加入口联算控制，此处不截断）；material 间按 materialId 去重；
 *  material 与边推导不互相去重（数字 assetId 与 asset- 前缀 materialId 是两个 ID 空间） */
export function mergeVideoMaterialRefs(
  refs: VideoMediaRefs,
  materials: VideoMaterialRefData[],
): VideoMediaRefs {
  if (materials.length === 0) return refs;
  const merged: VideoMediaRefs = { ...refs, reference: [...refs.reference] };
  const seenMaterialIds = new Set<string>();
  for (const m of materials) {
    if (seenMaterialIds.has(m.materialId)) continue;
    seenMaterialIds.add(m.materialId);
    const item: VideoMediaRef = {
      nodeId: m.materialId,
      url: m.url,
      name: m.name,
      assetId: m.materialId,
      mediaType: m.mediaType,
      materialId: m.materialId,
    };
    if (m.role === 'reference') {
      merged.reference.push(item);
    } else if (m.role === 'first') {
      if (!merged.first) merged.first = item;
      else (merged.invalid ??= []).push({ nodeId: m.materialId, name: m.name, role: 'first', reason: '首帧已指定', materialId: m.materialId });
    } else {
      if (!merged.last) merged.last = item;
      else (merged.invalid ??= []).push({ nodeId: m.materialId, name: m.name, role: 'last', reason: '尾帧已指定', materialId: m.materialId });
    }
  }
  return merged;
}

/** 边推导 + 角色库 material 的合并推导（显示输入 = 实际任务输入的唯一口径）：
 *  Dock 展示、连线校验、角色改写与提交防线统一走此函数 */
export function mergedVideoMediaRefsOf(
  targetNodeId: string,
  edges: Edge[],
  mediaNodes: Node[],
): VideoMediaRefs {
  const byId = new Map(mediaNodes.map((n) => [n.id, n]));
  return mergeVideoMaterialRefs(
    videoMediaRefsOf(targetNodeId, edges, mediaNodes),
    readDraftMaterialRefs(byId.get(targetNodeId)),
  );
}

/** 当前模型是否支持视频参考（仅 Seedance 2.0 系）：UI 禁用与提交防线共用同一判定 */
export function supportsVideoReferenceModel(modelId: string): boolean {
  return modelId === 'seedance-2' || /^doubao-seedance-2-0(?:-|$)/.test(modelId);
}

/** 视频草稿身份判定（IKDMQQ 约定延伸）：draft 标记 + 视频媒体类型 */
export function isVideoDraftNode(node: Node | undefined): boolean {
  if (!node || node.type !== 'mediaNode') return false;
  const data = (node.data ?? {}) as Record<string, unknown>;
  return data.draft === true && data.mediaType === 'video';
}

/** 读连线角色：缺省/非法值归一为 reference（普通参考）。画布拖线与「到节点选择」默认普通参考，
 *  首帧/尾帧必须在 Dock 显式指定，不按连入顺序猜测。 */
export function readRefRole(edge: Edge): VideoRefRole {
  const role = (edge.data as Record<string, unknown> | undefined)?.refRole;
  return role === 'first' || role === 'last' ? role : 'reference';
}

/** 来源有效性（不含媒体类型检查）：与图片参考同口径——待生成/生成中/失败/失效/上传中/无资产均不可用 */
function baseSourceError(node: NonNullable<Node>): string | null {
  const data = (node.data ?? {}) as Record<string, unknown>;
  if (data.genStatus === 'draft') return '待生成的草稿不能作为参考';
  if (data.genStatus === 'generating') return '生成中的卡片不能作为参考';
  if (data.genStatus === 'failed' || data.genStatus === 'cancelled') return '生成失败的卡片不能作为参考';
  if (data.assetMissing) return '素材已被删除';
  const src = typeof data.src === 'string' ? data.src : '';
  if (src.startsWith('blob:')) return '素材上传中，请稍候再选择';
  if (!src) return '素材已被删除';
  if (readAssetId(data) === undefined) return '素材未关联资产，无法作为参考';
  return null;
}

/** 视频参考来源校验：返回 null 表示可用，否则为用户可读拒绝原因。
 *  有效性口径与图片参考一致（仅有效媒体结果）；普通参考接受图片与视频，首尾帧槽只接受图片。 */
export function videoRefSourceError(node: Node | undefined, role: VideoRefRole): string | null {
  if (!node) return '素材不存在';
  const data = (node.data ?? {}) as Record<string, unknown>;
  if (role !== 'reference' && data.mediaType === 'video') return '首尾帧仅支持图片素材';
  if (data.mediaType !== 'image' && data.mediaType !== 'video') return '视频参考仅支持图片或视频素材';
  return baseSourceError(node);
}

/** 目标节点的视频媒体参考分组：连线 target=该节点，普通参考按连线顺序；
 *  有效来源分组消费，失效来源保留原因并阻止提交，连线保留待恢复或用户断开；
 *  同一素材（相同 assetId）跨角色只取首条（历史画布防御，与连线时重复校验同口径）。 */
export function videoMediaRefsOf(
  targetNodeId: string,
  edges: Edge[],
  mediaNodes: Node[],
): VideoMediaRefs {
  const byId = new Map(mediaNodes.map((n) => [n.id, n]));
  const refs: VideoMediaRefs = { reference: [] };
  const seenAssetIds = new Set<string>();
  for (const edge of edges) {
    if (edge.target !== targetNodeId) continue;
    const source = byId.get(edge.source);
    if (!source || source.type !== 'mediaNode') continue;
    const role = readRefRole(edge);
    const reason = videoRefSourceError(source, role);
    if (reason) {
      (refs.invalid ??= []).push({
        nodeId: source.id,
        name: String(source.data.fileName || source.id),
        role,
        reason,
      });
      continue;
    }
    const data = (source.data ?? {}) as Record<string, unknown>;
    const assetId = readAssetId(data)!;
    if (seenAssetIds.has(assetId)) continue;
    if (role !== 'reference' && (role === 'first' ? refs.first : refs.last)) continue;
    seenAssetIds.add(assetId);
    const item: VideoMediaRef = {
      nodeId: source.id,
      url: data.src as string,
      name: typeof data.fileName === 'string' && data.fileName ? data.fileName : source.id,
      assetId,
      mediaType: data.mediaType === 'video' ? 'video' : 'image',
    };
    if (role === 'reference') refs.reference.push(item);
    else if (role === 'first') refs.first = item;
    else refs.last = item;
  }
  return refs;
}

/** 模型能力（GenerationModel.features 中与视频参考相关的位） */
export interface VideoRefCapabilities {
  firstFrame: boolean;
  lastFrame: boolean;
  firstLastFrame: boolean;
  referenceImage: boolean;
}

/** 视频参考组合校验：返回 null 表示当前输入可提交，否则为用户可读的阻止原因。
 *  与服务端 400 同口径的结构约束（尾帧必须配首帧、首尾帧与普通参考互斥）+ 普通参考能力位；
 *  首帧/尾帧**不做**模型能力位门控（服务端 first_last_frame / last_frame 标记不可靠，
 *  实际能否使用以后端返回为准），不兼容时明确提示，禁止静默丢弃或降级。 */
export function videoRefConflict(
  refs: VideoMediaRefs,
  caps: VideoRefCapabilities,
): string | null {
  if (refs.invalid?.length) return '参考素材不可用，请恢复素材或移除失效引用后发送';
  if (refs.last && !refs.first) return '尾帧必须与首帧一起使用，请补充首帧或尾帧';
  if ((refs.first || refs.last) && refs.reference.length > 0) {
    return '首尾帧与普通参考不能混用，请移除其中一类输入';
  }
  if (refs.reference.length > 0 && !caps.referenceImage) {
    return '当前模型不支持图片参考，请移除普通参考';
  }
  return null;
}

/** 角色槽能否添加：能力位 + 槽位空闲。尾帧还要求已指定首帧（服务端「尾帧必须与首帧一起使用」，
 *  因此 last 实际可用 = lastFrame && firstLastFrame）。 */
export function canAddRefRole(
  role: VideoRefRole,
  refs: VideoMediaRefs,
  caps: VideoRefCapabilities,
): boolean {
  if (role === 'first') return caps.firstFrame && !refs.first;
  if (role === 'last') return caps.lastFrame && caps.firstLastFrame && !!refs.first && !refs.last;
  return caps.referenceImage;
}
