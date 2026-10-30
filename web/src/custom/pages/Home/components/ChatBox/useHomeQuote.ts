import { useEffect, useState } from 'react';
import { fetchHomeQuote, type HomeQuotePayload } from '@/custom/api/homeQuote';

const QUOTE_DEBOUNCE_MS = 400;

export function useHomeQuote(payload: HomeQuotePayload | null): number | null {
  const body = payload ? JSON.stringify(payload) : null;
  const [credits, setCredits] = useState<number | null>(null);

  useEffect(() => {
    if (body === null) {
      setCredits(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      fetchHomeQuote(JSON.parse(body) as HomeQuotePayload)
        .then((value) => {
          if (!cancelled) setCredits(value);
        })
        .catch(() => {
          if (!cancelled) setCredits(null);
        });
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [body]);

  return credits;
}
