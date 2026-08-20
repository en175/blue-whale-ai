import type { PromptCardShot } from '@/api/agentSessions';

/**
 * 产卡过程中那张"写到一半"的卡（prompt_card.partial.v1）。
 *
 * 产卡是一个 Run 里最长的一次等待，而这段时间模型大部分在写不在等。事件把每一版快照送过来，
 * 这里负责把它变成能上屏的样子。
 *
 * 关键前提：**这份数据没有经过校验**。它是模型正在写的对象，字段会缺、类型会不对、下一版还会
 * 改。所以这个函数必须是全函数——任何形状进来都不许抛，否则一个半成品会掀掉整个事件处理。
 * 它产出的东西也只配当预览：能落到画布上的卡片只有终态那一张。
 */
export interface PartialCardPreview {
  cardId: string;
  overview: string;
  shots: { title: string; promptText: string }[];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function toPartialCardPreview(cardId: unknown, payload: unknown): PartialCardPreview | null {
  if (!payload || typeof payload !== 'object') return null;
  const raw = payload as { overview?: unknown; shots?: unknown };
  const overview = text(raw.overview);
  const shots = Array.isArray(raw.shots)
    ? raw.shots
        .map((shot) => {
          const s = (shot ?? {}) as Partial<PromptCardShot>;
          return { title: text(s.title), promptText: text(s.prompt_text) };
        })
        // 分镜数组会先出现空占位再逐个填内容，空的不占一行，否则预览会先闪一排空框。
        .filter((shot) => shot.title !== '' || shot.promptText !== '')
    : [];
  if (overview === '' && shots.length === 0) return null;
  return { cardId: text(cardId), overview, shots };
}
