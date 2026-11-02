import { apiRequest } from '@/shared/api/http';

export interface HomeQuoteRef {
  type: 'image' | 'video';
  duration?: number;
}

export interface HomeQuoteParameters {
  model_id: string;
  prompt?: string;
  aspect_ratio?: string;
  resolution?: string;
  size?: string;
  duration?: number;
  generate_audio?: boolean;
  mode?: string;
}

export interface HomeQuotePayload {
  type: 'image' | 'video';
  parameters: HomeQuoteParameters;
  references: HomeQuoteRef[];
}

interface HomeQuoteData {
  credits: number | null;
}

const CACHE_TTL_MS = 45_000;
const cache = new Map<string, { at: number; credits: number | null }>();

export async function fetchHomeQuote(payload: HomeQuotePayload): Promise<number | null> {
  const body = JSON.stringify(payload);
  const hit = cache.get(body);
  const now = Date.now();
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.credits;
  const data = await apiRequest<HomeQuoteData>('/api/generation-quotes', {
    method: 'POST',
    body,
    silent: true,
  });
  const credits = typeof data?.credits === 'number' && data.credits > 0 ? data.credits : null;
  cache.set(body, { at: now, credits });
  return credits;
}
