/**
 * IK55VX 卡片库 mock 数据源(后端就绪前的前端 mock,接口形状仅供后端日后参考)。
 *
 * 卡片形状对齐工单:{ id, cardType, name, description, imageAssetId, voiceId? }
 * + createdAt(产品截图卡片上的日期显示,用户确认 1:1 还原)。
 * 「导入=复制快照」:cloneCardSnapshot 产出的字段拷贝进画布节点,编辑不回写库。
 * 「移除资产」:removeCardLibraryItem 从 mock 库删除(内存态,刷新页面还原)。
 * 复用:商品卡导入(IK55VZ)直接以 listCardLibrary({ cardType: "product" }) 复用本模块。
 */
import type { ReferenceCardType } from "./model";

export interface CardLibraryItem {
  id: string;
  cardType: ReferenceCardType;
  name: string;
  description: string;
  /** 参考图 mock asset id(查 MOCK_CARD_LIBRARY_ASSETS);无图卡缺省 */
  imageAssetId?: string;
  /** 角色卡音色(选择器数据 mock 先行,与 IK55VS 音色区一致) */
  voiceId?: string;
  /** 创建日期(截图卡片显示,YYYY-MM-DD) */
  createdAt: string;
}

/** 卡片类型中文名(选择器 UI 用;卡头英文名在 REFERENCE_CARD_TYPES.label)。 */
export const CARD_LIBRARY_TYPE_LABELS: Record<ReferenceCardType, string> = {
  style: "风格",
  character: "角色",
  object: "物体",
  environment: "环境",
  custom: "自定义",
};

/** mock 图 asset:内联 data-URL SVG 占位图(无网络依赖,测试/e2e 可跑)。 */
export interface CardLibraryAsset {
  src: string;
  /** 宽高比(width/height),落卡时写节点 referenceImageAspect */
  aspect: number;
}

function svgCover(hue: number, label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},45%,28%)"/><stop offset="1" stop-color="hsl(${hue + 40},50%,16%)"/></linearGradient></defs><rect width="320" height="180" fill="url(#g)"/><text x="160" y="96" font-size="20" fill="rgba(255,255,255,0.75)" text-anchor="middle" font-family="sans-serif">${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export const MOCK_CARD_LIBRARY_ASSETS: Record<string, CardLibraryAsset> = {
  "libimg-s1": { src: svgCover(280, "风格 · 赛博朋克"), aspect: 320 / 180 },
  "libimg-c1": { src: svgCover(45, "角色 · Apollo"), aspect: 320 / 180 },
  "libimg-o1": { src: svgCover(40, "物体 · 相机"), aspect: 320 / 180 },
  "libimg-e1": { src: svgCover(20, "环境 · 日出"), aspect: 320 / 180 },
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
];

/** 可变内存库(支持「移除资产」);初始=MOCK_CARDS 副本。 */
let library: CardLibraryItem[] = [...MOCK_CARDS];

/** 测试专用:还原库到初始 mock 状态。 */
export function resetCardLibrary(): void {
  library = [...MOCK_CARDS];
}

/** 查询卡片;filter.cardType 限定类型(商品卡导入复用时传 "product")。 */
export function listCardLibrary(filter?: {
  cardType?: ReferenceCardType;
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
}

export function cloneCardSnapshot(item: CardLibraryItem): CardSnapshot {
  const snap: CardSnapshot = {
    cardType: item.cardType,
    name: item.name,
    description: item.description,
  };
  if (item.voiceId) snap.voiceId = item.voiceId;
  if (item.imageAssetId) {
    const source = MOCK_CARD_LIBRARY_ASSETS[item.imageAssetId];
    if (source) {
      const newId = `${item.imageAssetId}-snap-${crypto.randomUUID()}`;
      assetRegistry.set(newId, { ...source });
      snap.referenceAssetId = newId;
      snap.referenceImageAspect = source.aspect;
    }
  }
  return snap;
}
