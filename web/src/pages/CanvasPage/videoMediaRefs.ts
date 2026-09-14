/* ============================================
 * videoMediaRefs 视频参考角色连线（IKDMQS）：关系即连线 + 角色挂在 edge.data.refRole。
 * 三种角色：reference 普通参考（图/视频）/ first 首帧（图）/ last 尾帧（图）。
 * Dock 展示与生成提交共用同一推导，保证「显示输入 = 实际任务输入」。
 * 角色随 edges JSON 原样持久化（服务端零改动，延续 IKDMQR）。
 * ============================================ */
import type { Edge, Node } from '@xyflow/react';
import { baseSourceError, cardNameOfNode, isMaterialLibraryId, readAssetId } from './mediaRefs';

/** 视频参考角色：reference 普通参考 / first 首帧 / last 尾帧 */
export type VideoRefRole = 'reference' | 'first' | 'last';

/** 媒体类型归一（IKFE8U）：画布节点 data / 资产记录的 mediaType 收敛为参考三类型；
 *  调用方已按类型过滤，未知值归图片与历史展示口径一致 */
export function asVideoRefMediaType(type: unknown): 'image' | 'video' | 'audio' {
  return type === 'video' ? 'video' : type === 'audio' ? 'audio' : 'image';
}

/** IKFC1T：目标是否存在任一有效媒体参考（普通参考或首尾帧；invalid 单列不计）——
 *  文生视频门控（enabledVideoFollowModes）与面板模式冲突判定共用谓词 */
export const hasAnyMediaRef = (refs: VideoMediaRefs): boolean =>
  refs.reference.length > 0 || Boolean(refs.first || refs.last);

/** 视频媒体参考项：nodeId 用于 Dock 移除时断开对应连线；assetId 进入提交字段；
 *  materialId 非空表示角色库素材（asset- 前缀素材库 ID，提交走 *_material_id/referenceMaterials）；
 *  duration 为来源节点回填的媒体时长（秒，IKFCKQ 音频缩略图预览卡片显示用，缺失不携带） */
export interface VideoMediaRef {
  nodeId: string;
  url: string;
  name: string;
  assetId: string;
  mediaType: 'image' | 'video' | 'audio';
  materialId?: string;
  duration?: number;
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

/** 防御性解析草稿 data.draftMaterialRefs：字段缺失或形态非法返回空数组（兼容旧快照，零迁移）。
 *  IKFC1T 修复：断言写法错误导致 raw 取到 node.data 整体（非数组恒早退），角色库参考从未被读到 */
export function readDraftMaterialRefs(node: Node | undefined): VideoMaterialRefData[] {
  if (!node) return [];
  const raw = ((node.data ?? {}) as Record<string, unknown>).draftMaterialRefs;
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
      // 纯角色库项没有画布节点：nodeId 与 materialId 同值，删除时据此与「连线参考」区分
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

/** 是否为草稿 data 里的纯角色库参考（无画布连线）。
 *  连线推导的参考也可能带合规 materialId，但不能按「有 materialId」当成角色库项去删。 */
export function isLibraryOnlyVideoRef(
  item: Pick<VideoMediaRef, 'nodeId' | 'materialId'>,
): item is { nodeId: string; materialId: string } {
  return item.materialId != null && item.nodeId === item.materialId;
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

/** 视频参考中需要合规入库的图片（首帧 / 尾帧 / 普通参考图） */
export function listVideoImageRefs(refs: VideoMediaRefs): VideoMediaRef[] {
  const images: VideoMediaRef[] = [];
  if (refs.first?.mediaType === 'image') images.push(refs.first);
  if (refs.last?.mediaType === 'image') images.push(refs.last);
  for (const item of refs.reference) {
    if (item.mediaType === 'image') images.push(item);
  }
  return images;
}

/** 快照参考的名称刷新（IKFA8Y）：待提交的暂存参考按来源节点身份取当前名称。
 *  只改展示名称；槽位、顺序、素材 ID 与角色沿用快照；角色库参考（materialId）与来源节点
 *  已不在画布的参考保留原名称（取当前值 + 回落快照值，快照本身不被改写）。 */
export function freshVideoCanvasRefs(refs: VideoMediaRefs, mediaNodes: Node[]): VideoMediaRefs {
  const byId = new Map(mediaNodes.map((n) => [n.id, n]));
  const fresh = (ref: VideoMediaRef): VideoMediaRef => {
    if (ref.materialId != null) return ref;
    const current = cardNameOfNode(byId.get(ref.nodeId));
    return current === undefined || current === ref.name ? ref : { ...ref, name: current };
  };
  const next: VideoMediaRefs = { reference: refs.reference.map(fresh) };
  if (refs.first) next.first = fresh(refs.first);
  if (refs.last) next.last = fresh(refs.last);
  if (refs.invalid) next.invalid = [...refs.invalid];
  return next;
}

/** 当前模型是否支持视频参考（ADR-0086：由能力行 features.video_reference 驱动，替代旧 seedance-2 前缀特判）。
 *  UI 禁用与提交防线共用同一判定。 */
export function supportsVideoReferenceModel(modelId: string, caps?: VideoRefCapabilities | null): boolean {
  // 兼容旧签名（仅 modelId）：能力位缺省时维持 seedance-2 前缀特判（生产旧行未配新键时行为不变）。
  if (!caps) return modelId === 'seedance-2' || /^doubao-seedance-2-0(?:-|$)/.test(modelId);
  return caps.videoReference;
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

/** 视频参考来源校验：返回 null 表示可用，否则为用户可读拒绝原因。
 *  有效性口径与图片参考一致（仅有效媒体结果）；普通参考接受图片与视频，首尾帧槽只接受图片。 */
export function videoRefSourceError(node: Node | undefined, role: VideoRefRole): string | null {
  if (!node) return '素材不存在';
  const data = (node.data ?? {}) as Record<string, unknown>;
  if (role !== 'reference' && data.mediaType !== 'image') return '首尾帧仅支持图片素材';
  if (data.mediaType !== 'image' && data.mediaType !== 'video' && data.mediaType !== 'audio') return '视频参考仅支持图片、视频或音频素材';
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
    const materialId =
      typeof data.materialId === 'string' && data.materialId
        ? data.materialId
        : isMaterialLibraryId(assetId)
          ? assetId
          : undefined;
    const item: VideoMediaRef = {
      nodeId: source.id,
      url: data.src as string,
      name: typeof data.fileName === 'string' && data.fileName ? data.fileName : source.id,
      assetId,
      mediaType: data.mediaType as 'image' | 'video' | 'audio',
      materialId,
      duration: typeof data.duration === 'number' && data.duration > 0 ? data.duration : undefined,
    };
    if (role === 'reference') refs.reference.push(item);
    else if (role === 'first') refs.first = item;
    else refs.last = item;
  }
  return refs;
}

/** 模型能力（GenerationModel.features 中与视频参考相关的位 + 分类上限，ADR-0086） */
export interface VideoRefCapabilities {
  firstFrame: boolean;
  lastFrame: boolean;
  firstLastFrame: boolean;
  referenceImage: boolean;
  /** ADR-0086：视频生成是否接受视频素材作普通参考（替代 seedance-2 前缀特判）。 */
  videoReference: boolean;
  /** ADR-0086：视频生成是否接受音频素材作参考。 */
  audioReference: boolean;
  /** ADR-0086：普通参考中视频素材上限。 */
  videoReferenceMax: number;
  /** ADR-0086：音频生成中音频参考上限。 */
  audioReferenceMax: number;
  /** ADR-0086：音频生成中图片参考上限。 */
  imageReferenceMax: number;
  /** ADR-0086：普通参考中图片素材上限。 */
  imageMax: number;
}

/** 视频参考组合校验：返回 null 表示当前输入可提交，否则为用户可读的阻止原因。
 *  与服务端 400 同口径的结构约束（首尾帧与普通参考互斥）+ 普通参考能力位；
 *  首帧/尾帧**不做**模型能力位门控（服务端 first_last_frame / last_frame 标记不可靠，
 *  实际能否使用以后端返回为准），不兼容时明确提示，禁止静默丢弃或降级。
 *  添加阶段允许先只传首帧/尾帧其一（见 checkAddVideoRef / canAddRefRole），
 *  但**发送阶段**要求首帧与尾帧齐全，否则提示补全。 */
export function videoRefConflict(
  refs: VideoMediaRefs,
  caps: VideoRefCapabilities,
): string | null {
  if (refs.invalid?.length) return '参考素材不可用，请恢复素材或移除失效引用后发送';
  if ((refs.first || refs.last) && refs.reference.length > 0) {
    return '首尾帧与普通参考不能混用，请移除其中一类输入';
  }
  // 首尾帧模式发送：首帧与尾帧需齐全，否则按缺项提示补全
  if (refs.first || refs.last) {
    if (!refs.first) return '请补充首帧';
    if (!refs.last) return '请补充尾帧';
  }
  if (refs.reference.length > 0 && !caps.referenceImage) {
    return '当前模型不支持图片参考，请移除普通参考';
  }
  return null;
}

/** 角色槽能否添加：能力位 + 槽位空闲。首帧与尾帧独立使用，允许只传其一。 */
export function canAddRefRole(
  role: VideoRefRole,
  refs: VideoMediaRefs,
  caps: VideoRefCapabilities,
): boolean {
  if (role === 'first') return caps.firstFrame && !refs.first;
  if (role === 'last') return caps.lastFrame && !refs.last;
  return caps.referenceImage;
}

/** 统一校验「向视频草稿添加参考素材」：重复素材 / 槽位已占 / 首尾帧收视频 / 普通参考超限。
 *  ADR-0086：分类上限由能力行（videoReferenceMax / audioReferenceMax / imageMax）驱动，不再硬编码 3/9。
 *  返回 null 表示可添加；否则为用户可读的拒绝原因——所有添加入口（连线 / 到节点选择 /
 *  角色库 / 资产 / Dock 角色改写）必须调本函数，禁止各自复制 guard。 */
export function checkAddVideoRef(
  role: VideoRefRole,
  mediaType: 'image' | 'video' | 'audio',
  assetId: string | undefined,
  refs: VideoMediaRefs,
  caps?: VideoRefCapabilities | null,
): string | null {
  // 首尾帧槽只收图片
  if (role !== 'reference' && mediaType !== 'image') return '首尾帧仅支持图片素材';
  // 槽位已占
  if (role === 'first' && refs.first) return '首帧已指定，请先移除现有首帧';
  if (role === 'last' && refs.last) return '尾帧已指定，请先移除现有尾帧';
  // 素材已连入同一草稿（跨角色去重）；首尾帧用「素材重复」，普通参考沿用「重复的素材已跳过」
  if (assetId) {
    const occupied =
      refs.reference.some((r) => r.assetId === assetId) ||
      [refs.first, refs.last].some((r) => r?.assetId === assetId);
    if (occupied) return role !== 'reference' ? '素材重复' : '重复的素材已跳过';
  }
  // 普通参考上限（ADR-0086：读能力行，缺省回落旧 3/3/9）
  if (role === 'reference') {
    const videoMax = caps?.videoReferenceMax ?? 3;
    const audioMax = caps?.audioReferenceMax ?? 3;
    const imageMax = caps?.imageMax ?? 9;
    if (mediaType === 'video') {
      const videoCount = refs.reference.filter((r) => r.mediaType === 'video').length;
      if (videoCount >= videoMax) return `参考视频最多 ${videoMax} 个`;
    } else if (mediaType === 'audio') {
      if (refs.reference.filter(r => r.mediaType === 'audio').length >= audioMax) return `参考音频最多 ${audioMax} 个`;
    } else if (refs.reference.filter(r => r.mediaType === 'image').length >= imageMax) {
      return `参考图最多 ${imageMax} 张`;
    }
  }
  return null;
}
