/**
 * IK55VX 卡片库 mock 数据源(后端就绪前的前端 mock,接口形状仅供后端日后参考)。
 *
 * 卡片形状对齐工单:{ id, cardType, name, description, imageAssetId, voiceId? }
 * + createdAt(产品截图卡片上的日期显示,用户确认 1:1 还原)。
 * 「导入=复制快照」:cloneCardSnapshot 产出的字段拷贝进画布节点,编辑不回写库。
 * 「移除资产」:removeCardLibraryItem 从 mock 库删除(内存态,刷新页面还原)。
 * 复用:商品卡导入(IK55VZ)直接以 listCardLibrary({ cardType: "product" }) 复用本模块。
 * IK5MC9「保存到共享资产」:saveToSharedAssets 将画布节点快照写入库(参考卡+媒体节点)。
 */
import type {
  CanvasNode,
  CanvasNodeData,
  MediaKind,
  ReferenceCardType,
} from "./model";
import { richDocToPlainText } from "./model";
import { svgPlaceholder } from "./svgPlaceholder";

/** IK5MC9 共享资产类型 = 参考卡 6 类 + 媒体 4 类。 */
export type SharedAssetType = ReferenceCardType | MediaKind;

export interface CardLibraryItem {
  id: string;
  cardType: SharedAssetType;
  name: string;
  description: string;
  /** 参考图 mock asset id(查 MOCK_CARD_LIBRARY_ASSETS);无图卡缺省 */
  imageAssetId?: string;
  /** 角色卡音色(选择器数据 mock 先行,与 IK55VS 音色区一致) */
  voiceId?: string;
  /** IK55VZ 商品卡详情文本(名称/品类/参数/卖点/人群) */
  detail?: string;
  /** IK55VZ 商品卡图片 asset id 列表(≤8;查 MOCK_CARD_LIBRARY_ASSETS) */
  imageAssetIds?: string[];
  /** IK55VZ 商品卡来源链接 */
  sourceUrl?: string;
  /** IK5MC9 媒体节点产物 assetId（画布 store.assets 引用） */
  assetId?: string;
  /** 创建日期(截图卡片显示,YYYY-MM-DD) */
  createdAt: string;
}

/** 类型中文名(选择器 UI 用;覆盖参考卡 + 媒体)。 */
export const CARD_LIBRARY_TYPE_LABELS: Record<SharedAssetType, string> = {
  style: "风格",
  character: "角色",
  object: "物体",
  environment: "环境",
  custom: "自定义",
  product: "商品",
  image: "图片",
  video: "视频",
  audio: "音频",
  text: "文本",
};

/** 媒体节点自动命名前缀（"图片 3"格式）。 */
const MEDIA_KIND_LABELS: Record<MediaKind, string> = {
  image: "图片",
  video: "视频",
  audio: "音频",
  text: "文本",
};

/** mock 图 asset:内联 data-URL SVG 占位图(无网络依赖,测试/e2e 可跑)。 */
export interface CardLibraryAsset {
  src: string;
  /** 宽高比(width/height),落卡时写节点 referenceImageAspect */
  aspect: number;
}

export const MOCK_CARD_LIBRARY_ASSETS: Record<string, CardLibraryAsset> = {
  "libimg-s1": {
    src: svgPlaceholder(280, "风格 · 赛博朋克"),
    aspect: 320 / 180,
  },
  "libimg-c1": { src: svgPlaceholder(45, "角色 · Apollo"), aspect: 320 / 180 },
  "libimg-o1": { src: svgPlaceholder(40, "物体 · 相机"), aspect: 320 / 180 },
  "libimg-e1": { src: svgPlaceholder(20, "环境 · 日出"), aspect: 320 / 180 },
  // IK55VZ 商品卡 mock 图(同一共享 svgPlaceholder 生成)
  "libimg-p1": {
    src: svgPlaceholder(200, "商品 · 音箱主图"),
    aspect: 320 / 180,
  },
  "libimg-p2": {
    src: svgPlaceholder(160, "商品 · 音箱细节"),
    aspect: 320 / 180,
  },
  "libimg-p3": {
    src: svgPlaceholder(120, "商品 · 音箱场景"),
    aspect: 320 / 180,
  },
  "libimg-p4": { src: svgPlaceholder(90, "商品 · 露营灯"), aspect: 320 / 180 },
};

const MOCK_CARDS: CardLibraryItem[] = [
  {
    id: "lib-s1",
    cardType: "style",
    name: "赛博朋克霓虹",
    description: "高饱和霓虹配色,雨夜都市,强对比光影",
    imageAssetId: "libimg-s1",
    createdAt: "2026-07-30",
  },
  {
    id: "lib-s2",
    cardType: "style",
    name: "水彩手绘",
    description: "柔和水彩晕染,纸张纹理,低饱和",
    createdAt: "2026-07-28",
  },
  {
    id: "lib-c1",
    cardType: "character",
    name: "Apollo",
    description:
      "Young lean man, long wavy light-blonde hair, piercing blue eyes. Flowing semi-sheer white toga with gold filigree, gold circlet crown, gold arm cuffs, gold waist piece. Glowing spiked white halo radiates from behind his head. Expression stoic and divine.",
    imageAssetId: "libimg-c1",
    voiceId: "voice-demo-1",
    createdAt: "2026-07-30",
  },
  {
    id: "lib-c2",
    cardType: "character",
    name: "旁白老者",
    description: "低沉磁性嗓音,白发长袍",
    voiceId: "voice-demo-2",
    createdAt: "2026-07-25",
  },
  {
    id: "lib-o1",
    cardType: "object",
    name: "复古相机",
    description: "银色金属机身,棕色皮饰,80 年代",
    imageAssetId: "libimg-o1",
    createdAt: "2026-07-22",
  },
  {
    id: "lib-e1",
    cardType: "environment",
    name: "山顶日出",
    description: "云海,金色晨光,远景群山剪影",
    imageAssetId: "libimg-e1",
    createdAt: "2026-07-20",
  },
  {
    id: "lib-e2",
    cardType: "environment",
    name: "地下实验室",
    description: "冷白光,金属走廊,轻微雾气",
    createdAt: "2026-07-18",
  },
  {
    id: "lib-x1",
    cardType: "custom",
    name: "品牌规范备注",
    description: "主色 #6E56CF,禁用纯黑背景",
    createdAt: "2026-07-15",
  },
  {
    id: "lib-p1",
    cardType: "product",
    name: "户外蓝牙音箱",
    description: "露营氛围灯便携音箱",
    detail:
      "品类:便携蓝牙音箱\n核心参数:40h 续航 · IPX7 防水 · 360° 声场\n卖点:露营氛围灯 / 双机串联\n目标人群:18–35 岁户外爱好者",
    imageAssetIds: ["libimg-p1", "libimg-p2", "libimg-p3"],
    sourceUrl: "https://example.com/item/speaker-42",
    createdAt: "2026-07-29",
  },
  {
    id: "lib-p2",
    cardType: "product",
    name: "露营氛围灯",
    description: "暖光多档调光露营灯",
    detail: "品类:露营灯\n核心参数:1200lm · Type-C 充电",
    sourceUrl: "https://example.com/item/lamp-7",
    createdAt: "2026-07-26",
  },
];

/** 可变内存库(支持「移除资产」);初始=MOCK_CARDS 副本。 */
let library: CardLibraryItem[] = [...MOCK_CARDS];

/** 测试专用:还原库到初始 mock 状态。 */
export function resetCardLibrary(): void {
  library = [...MOCK_CARDS];
}

/** 查询卡片;filter.cardType 限定类型(商品卡导入复用时传 "product";媒体 tab 传 image/video/audio/text)。 */
export function listCardLibrary(filter?: {
  cardType?: SharedAssetType;
}): CardLibraryItem[] {
  if (!filter?.cardType) return [...library];
  return library.filter((c) => c.cardType === filter.cardType);
}

/** 移除资产:从 mock 库删除(内存态,刷新页面还原);id 不存在时无操作。 */
export function removeCardLibraryItem(id: string): void {
  library = library.filter((c) => c.id !== id);
}

/** 快照资产的运行期注册表:初始=mock 图,克隆出的新 asset 也登记在此。 */
const assetRegistry = new Map<string, CardLibraryAsset>(
  Object.entries(MOCK_CARD_LIBRARY_ASSETS),
);

/** 取 asset(src+aspect);克隆快照的 referenceAssetId 也经此解析。 */
export function getCardLibraryAsset(id: string): CardLibraryAsset | undefined {
  const hit = assetRegistry.get(id);
  if (hit) return hit;
  // 刷新后注册表丢失:快照 id(<源id>-snap-<uuid>)按源 mock 图前缀确定性重建
  const m =
    /^(.+)-snap-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.exec(
      id,
    );
  if (m) return MOCK_CARD_LIBRARY_ASSETS[m[1]];
  return undefined;
}

/** 导入快照:字段深拷贝 + 带图卡生成独立新 asset id(编辑画布卡/再次导入均不影响库)。 */
export interface CardSnapshot {
  cardType: ReferenceCardType;
  name: string;
  description: string;
  voiceId?: string;
  referenceAssetId?: string;
  referenceImageAspect?: number;
  /** IK55VZ 商品卡:详情/多图(新 snap id 数组)/来源链接 */
  detail?: string;
  imageAssetIds?: string[];
  sourceUrl?: string;
}

export function cloneCardSnapshot(item: CardLibraryItem): CardSnapshot {
  const snap: CardSnapshot = {
    cardType: item.cardType as ReferenceCardType,
    name: item.name,
    description: item.description,
  };
  if (item.voiceId) snap.voiceId = item.voiceId;
  if (item.detail != null) snap.detail = item.detail;
  if (item.sourceUrl != null) snap.sourceUrl = item.sourceUrl;
  if (item.imageAssetId) {
    const source = MOCK_CARD_LIBRARY_ASSETS[item.imageAssetId];
    if (source) {
      const newId = `${item.imageAssetId}-snap-${crypto.randomUUID()}`;
      assetRegistry.set(newId, { ...source });
      snap.referenceAssetId = newId;
      snap.referenceImageAspect = source.aspect;
    }
  }
  // IK55VZ 商品卡多图:每个 asset 复制为独立新 snap id(同单图注册表模式)
  if (item.imageAssetIds) {
    snap.imageAssetIds = item.imageAssetIds.flatMap((srcId) => {
      const source = MOCK_CARD_LIBRARY_ASSETS[srcId];
      if (!source) return [];
      const newId = `${srcId}-snap-${crypto.randomUUID()}`;
      assetRegistry.set(newId, { ...source });
      return [newId];
    });
  }
  return snap;
}

/**
 * 快照 → 画布节点 data(IK55VX/IK55VZ 导入分发共用):
 * 基础字段全带;单图卡带 referenceAssetId/Aspect;商品卡带 detail/imageAssetIds/sourceUrl。
 */
export function snapshotToNodeData(
  snap: CardSnapshot,
): Partial<CanvasNodeData> & {
  cardType: ReferenceCardType;
} {
  return {
    cardType: snap.cardType,
    name: snap.name,
    description: snap.description,
    ...(snap.referenceAssetId
      ? {
          referenceAssetId: snap.referenceAssetId,
          referenceImageAspect: snap.referenceImageAspect,
        }
      : {}),
    ...(snap.detail != null ? { detail: snap.detail } : {}),
    ...(snap.imageAssetIds ? { imageAssetIds: [...snap.imageAssetIds] } : {}),
    ...(snap.sourceUrl != null ? { sourceUrl: snap.sourceUrl } : {}),
  };
}

/** IK5MC9 自动命名：统计库中同类型媒体条目最大编号 +1（如"图片 3"）。 */
function nextMediaName(kind: MediaKind): string {
  const prefix = MEDIA_KIND_LABELS[kind];
  let max = 0;
  for (const item of library) {
    if (item.cardType !== kind) continue;
    const m = new RegExp(`^${prefix}\\s*(\\d+)$`).exec(item.name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix} ${max + 1}`;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * IK5MC9 保存到共享资产：将画布节点快照写入 mock 库。
 * - 参考卡（kind=reference）：name 取卡片名称，cardType 取 cardType。
 * - 媒体节点（image/video/audio/text）：自动命名（如"图片 3"），cardType=kind。
 * - 分组（kind=group）：静默跳过。
 * 返回实际保存数量。
 */
export function saveToSharedAssets(nodes: CanvasNode[]): number {
  const savable = nodes.filter((n) => n.data.kind !== "group");
  if (savable.length === 0) return 0;

  let count = 0;
  for (const node of savable) {
    const d = node.data;
    let item: CardLibraryItem;
    if (d.kind === "reference") {
      item = {
        id: `saved-${crypto.randomUUID()}`,
        cardType: d.cardType ?? "custom",
        name: d.name ?? CARD_LIBRARY_TYPE_LABELS[d.cardType ?? "custom"],
        description: d.description ?? "",
        createdAt: todayStr(),
      };
      if (d.referenceAssetId) item.imageAssetId = d.referenceAssetId;
      if (d.voiceId) item.voiceId = d.voiceId as string;
      if (d.detail != null) item.detail = d.detail;
      if (d.imageAssetIds) item.imageAssetIds = [...d.imageAssetIds];
      if (d.sourceUrl) item.sourceUrl = d.sourceUrl;
    } else {
      const kind = d.kind as MediaKind;
      const desc =
        kind === "text"
          ? (d.richDoc ? richDocToPlainText(d.richDoc) : "").slice(0, 100) ||
            (d.prompt ?? "")
          : (d.prompt ?? "");
      item = {
        id: `saved-${crypto.randomUUID()}`,
        cardType: kind,
        name: nextMediaName(kind),
        description: desc,
        createdAt: todayStr(),
      };
      if (d.assetId) item.assetId = d.assetId;
    }
    library = [...library, item];
    count++;
  }

  return count;
}
