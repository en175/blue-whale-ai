/**
 * IK55VZ 商品卡 mock 链接导入解析(L0 纯函数,后端就绪前的确定性 mock)。
 *
 * parseProductUrl:同一 url 恒同输出(简单 hash 派生变体);images 为 4 张内联
 * SVG data-URL 占位图(共享 svgPlaceholder,不同色相渐变,合法 data URL,不依赖网络);
 * 空串/非法 url 走确定性兜底,不抛异常。
 */
import { svgPlaceholder } from "./svgPlaceholder";

/** 链接导入区空态显示的平台占位（IK5JV4 定稿：抖音/淘宝/天猫/京东/亚马逊，固定 5 个）。 */
export const PRODUCT_PLATFORMS: { id: string; label: string }[] = [
  { id: "douyin", label: "抖" },
  { id: "taobao", label: "淘" },
  { id: "tmall", label: "猫" },
  { id: "jd", label: "京" },
  { id: "amazon", label: "亚" },
];

export interface ParsedProduct {
  name: string;
  images: string[];
  description: string;
}

/** 简单字符串 hash(确定性,仅用于派生 mock 变体)。 */
function hashOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

const MOCK_CATEGORIES = [
  "便携蓝牙音箱",
  "露营氛围灯",
  "无线降噪耳机",
  "户外保温水壶",
];
const MOCK_PARAMS = [
  "40h 续航 · IPX7 防水",
  "1200lm · Type-C 快充",
  "42dB 降噪 · 蓝牙 5.4",
  "316 不锈钢 · 24h 保温",
];
const MOCK_SELLING_POINTS = [
  "露营氛围灯 / 双机串联",
  "无极调光 / 磁吸底座",
  "自适应降噪 / 空间音频",
  "一键弹盖 / 防漏锁扣",
];
const MOCK_AUDIENCES = [
  "18–35 岁户外爱好者",
  "精致露营人群",
  "通勤白领 / 差旅人群",
  "健身与徒步人群",
];

/** 取 url 主机名;非法 url 兜底为截断串或「未知来源」。 */
function hostOf(url: string): string {
  try {
    const host = new URL(url).hostname;
    if (host) return host;
  } catch {
    // 非法 url 走下方兜底
  }
  const trimmed = url.trim();
  return trimmed ? trimmed.slice(0, 24) : "未知来源";
}

/** 商品卡图片上限(原型「已启用 n/8」)。 */
export const MAX_PRODUCT_IMAGES = 8;

/** 多图追加语义:已有 + 新增,保持顺序,超出 8 截断(满了不再追加)。 */
export function mergeProductImageIds(
  existing: string[] | undefined,
  added: string[],
): string[] {
  return [...(existing ?? []), ...added].slice(0, MAX_PRODUCT_IMAGES);
}

/** 导入解析名仅在名称未填或仍是「商品 N」自动编号时采用(不覆盖用户改过的名)。 */
export function shouldAdoptParsedName(name: string | undefined): boolean {
  return !name || /^商品\s*\d+$/.test(name);
}

/**
 * 链接导入填充 patch(组件 harness 与 runtime 共用同一份语义):
 * 图片 id 合并(≤8)、detail=解析文案、sourceUrl=输入链接;
 * name 仅在自动编号/未填时带解析名(用户改过的名不覆盖 → patch 无 name 键)。
 */
export function productImportPatch(
  current: { imageAssetIds?: string[]; name?: string },
  parsed: ParsedProduct,
  url: string,
  newImageIds: string[],
): {
  imageAssetIds: string[];
  detail: string;
  sourceUrl: string;
  name?: string;
} {
  return {
    imageAssetIds: mergeProductImageIds(current.imageAssetIds, newImageIds),
    detail: parsed.description,
    sourceUrl: url,
    ...(shouldAdoptParsedName(current.name) ? { name: parsed.name } : {}),
  };
}

/** 导入图的确定性 asset id(同一 url+index 恒同):刷新后按 sourceUrl 确定性重建 src。 */
export function productImportImageId(url: string, index: number): string {
  return `impimg-${hashOf(url).toString(36)}-${index}`;
}

/**
 * 刷新后水合(纯函数):product 卡 imageAssetIds 里的导入图(impimg- 前缀、
 * 节点带 sourceUrl)在 store 缺失时,按 parseProductUrl(sourceUrl) 确定性重建待注册 asset 列表。
 * 已存在的 asset 不重复注册;无 sourceUrl/非 product 卡不产出。
 */
export function productImportHydrationAssets(
  nodes: Iterable<{
    data: {
      cardType?: string;
      sourceUrl?: string;
      imageAssetIds?: string[];
    };
  }>,
  existingAssets: Record<string, unknown>,
): { id: string; kind: "image"; src: string; source: "uploaded" }[] {
  const out: { id: string; kind: "image"; src: string; source: "uploaded" }[] =
    [];
  for (const n of nodes) {
    if (n.data.cardType !== "product" || !n.data.sourceUrl) continue;
    const url = n.data.sourceUrl;
    const wanted = new Set(n.data.imageAssetIds ?? []);
    if (wanted.size === 0) continue;
    const parsed = parseProductUrl(url);
    for (const [i, src] of parsed.images.entries()) {
      const id = productImportImageId(url, i);
      if (!wanted.has(id) || existingAssets[id]) continue;
      out.push({ id, kind: "image", src, source: "uploaded" });
    }
  }
  return out;
}

/**
 * mock 链接导入解析:确定性(同一 url 同一输出,hash 派生变体)。
 * 空串/非法 url 给出确定性兜底输出,不抛异常。
 */
export function parseProductUrl(url: string): ParsedProduct {
  const h = hashOf(url);
  return {
    name: `导入商品 · ${hostOf(url)}`,
    images: [0, 1, 2, 3].map((i) =>
      svgPlaceholder((h + i * 60) % 360, `商品图 ${i + 1}`),
    ),
    description:
      `品类:${MOCK_CATEGORIES[h % MOCK_CATEGORIES.length]}\n` +
      `核心参数:${MOCK_PARAMS[h % MOCK_PARAMS.length]}\n` +
      `卖点:${MOCK_SELLING_POINTS[h % MOCK_SELLING_POINTS.length]}\n` +
      `目标人群:${MOCK_AUDIENCES[h % MOCK_AUDIENCES.length]}`,
  };
}
