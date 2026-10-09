import type { PromptCardShot } from '@/api/agentSessions';

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
        .filter((shot) => shot.title !== '' || shot.promptText !== '')
    : [];
  if (overview === '' && shots.length === 0) return null;
  return { cardId: text(cardId), overview, shots };
}
