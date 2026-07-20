/**
 * localStorage 历史记录读写
 *
 * Key: bw-history — 存储 HistoryItem[] 的 JSON 序列化。
 * 类型：画布（canvas）/ 对话（chat）。seedDemoHistory 首次空时写入 demo 数据。
 */

export interface HistoryItem {
  id: string;
  type: "canvas" | "chat"; // 画布 / 对话
  title: string;
  createdAt: number; // Date.now()
}

const HISTORY_KEY = "bw-history";

function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 10);
}

export function loadHistory(): HistoryItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item: unknown): item is HistoryItem =>
        typeof (item as HistoryItem)?.id === "string" &&
        ((item as HistoryItem)?.type === "canvas" || (item as HistoryItem)?.type === "chat") &&
        typeof (item as HistoryItem)?.title === "string" &&
        typeof (item as HistoryItem)?.createdAt === "number",
    );
  } catch {
    return [];
  }
}

export function saveHistory(items: HistoryItem[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
  } catch {
    /* ignore */
  }
}

/** 首次空时写入 demo 数据，返回写入后的列表 */
export function seedDemoHistory(): HistoryItem[] {
  const existing = loadHistory();
  if (existing.length > 0) return existing;

  const now = Date.now();
  const demo: HistoryItem[] = [
    {
      id: generateId(),
      type: "canvas",
      title: "产品海报设计画布",
      createdAt: now - 1000 * 60 * 15, // 15 分钟前
    },
    {
      id: generateId(),
      type: "chat",
      title: "短视频脚本撰写对话",
      createdAt: now - 1000 * 60 * 60 * 2, // 2 小时前
    },
    {
      id: generateId(),
      type: "canvas",
      title: "营销落地页布局",
      createdAt: now - 1000 * 60 * 60 * 5, // 5 小时前
    },
    {
      id: generateId(),
      type: "chat",
      title: "AI 文案优化对话",
      createdAt: now - 1000 * 60 * 60 * 24, // 1 天前
    },
    {
      id: generateId(),
      type: "canvas",
      title: "品牌 VI 设计稿",
      createdAt: now - 1000 * 60 * 60 * 24 * 3, // 3 天前
    },
  ];

  saveHistory(demo);
  return demo;
}
