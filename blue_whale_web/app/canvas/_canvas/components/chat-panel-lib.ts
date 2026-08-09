// IK74V6：AgentChatPanel 的常量/纯函数/类型（从面板文件下沉）。
import type { MentionFailure } from "@blue-whale/core";
import { isApiError } from "@/lib/api/errors";
import type { MediaKind } from "@/lib/mediaSize";

/** 显式引用 pill 数量上限，对齐 Core mentions 最大长度 10。 */
export const MENTION_LIMIT = 10;

const MENTION_FAILURE_REASONS = new Set([
  "deleted",
  "stale",
  "permission_lost",
  "wrong_project",
]);

export function mentionFailuresOf(error: unknown): MentionFailure[] {
  if (!isApiError(error) || error.code !== "mention.unavailable") return [];
  const detail = error.detail;
  if (!detail || typeof detail !== "object") return [];
  const mentions = (detail as Record<string, unknown>).mentions;
  if (!Array.isArray(mentions)) return [];
  return mentions.filter((mention): mention is MentionFailure => {
    if (!mention || typeof mention !== "object") return false;
    const value = mention as Record<string, unknown>;
    return (
      typeof value.index === "number" &&
      Number.isSafeInteger(value.index) &&
      value.index >= 0 &&
      (value.type === "asset" || value.type === "scene_card") &&
      typeof value.reason === "string" &&
      MENTION_FAILURE_REASONS.has(value.reason)
    );
  });
}

/** 欢迎态预设：点击只填入输入框，不发送、不创建产品事实（IK67GD T02）。 */
export const WELCOME_PRESETS = [
  {
    label: "生成一张插画",
    text: "帮我生成一张插画，主题是夏日海边的小镇，色调温暖明亮。",
  },
  {
    label: "构思一个短视频",
    text: "帮我构思一个 15 秒的短视频，用于展示一款环保水杯。",
  },
  {
    label: "头脑风暴创意方向",
    text: "我想做一个品牌视觉方案，先帮我头脑风暴几个创意方向。",
  },
];

/** 「总结当前对话」固定提示词（IK60X1，契约 §15.1）：预填进输入框供用户审阅编辑，
 *  必须手动发送；发送时随消息体携带 skill_summarize: true 显式意图字段。 */
export const SKILL_SUMMARIZE_PROMPT =
  "请总结当前对话中的创作方法和要点，生成一份可复用的技能，并保存为我的个人技能。";

/** 输入区上传条目（IK67GX T03）：每文件一条；成功插 pill，失败可单独重试/移除。 */
export type ComposerUploadEntry = {
  id: string;
  name: string;
  file: File;
  status: "uploading" | "success" | "error";
  assetId?: string;
  url?: string;
  kind?: MediaKind;
};
/** Agent 对话面板模型候选（展示用 mock 档位）。 */
export type AgentModelChoice = { id: string; label: string; costMultiplier: string };

/** Agent 对话面板模型档位（IK74V6：从面板 useMemo 下沉为常量）。 */
export const AGENT_MODELS: AgentModelChoice[] = [
  { id: "claude-opus-4-7", label: "Claude Opus 4.7", costMultiplier: "5x" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", costMultiplier: "3x" },
  { id: "gemini-3-5-flash", label: "Gemini 3.5 Flash", costMultiplier: "2x" },
  { id: "qwen-3-7-max", label: "Qwen 3.7 Max", costMultiplier: "1.3x" },
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", costMultiplier: "1x" },
  { id: "gemini-3-1-flash-lite", label: "Gemini 3.1 Flash Lite", costMultiplier: "0.3x" },
];
