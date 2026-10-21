import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiRequest } from '@/shared/api/http';
import { useAuthStore } from '@/shared/stores/auth';

export interface MediaToolQuoteInput {
  duration?: number;
  resolution?: string;
  fps?: number;
  multiple?: number;
}

export interface MediaToolQuote {
  credits: number | null;
  quote_revision: string | null;
}

export const mediaToolQuoteKeys = {
  all: ['media-tool-quote'] as const,
  one: (toolType: string, input: MediaToolQuoteInput, userId: number | null = null) =>
    [...mediaToolQuoteKeys.all, toolType, userId, input] as const,
};

export function fetchMediaToolQuote(
  toolType: string,
  input: MediaToolQuoteInput,
): Promise<MediaToolQuote> {
  return apiRequest<MediaToolQuote>(
    `/api/media-tools/${encodeURIComponent(toolType)}/quote`,
    {
      method: 'POST',
      body: JSON.stringify({ input }),
      silent: true,
    },
  );
}

export function mediaToolQuoteOptions(
  toolType: string,
  input: MediaToolQuoteInput,
  userId: number | null = null,
) {
  return queryOptions({
    queryKey: mediaToolQuoteKeys.one(toolType, input, userId),
    queryFn: () => fetchMediaToolQuote(toolType, input),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

function useDebouncedSerialized(input: MediaToolQuoteInput | null): MediaToolQuoteInput | null {
  const serialized = input === null ? null : JSON.stringify(input);
  const [debounced, setDebounced] = useState(serialized);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(serialized), 300);
    return () => clearTimeout(timer);
  }, [serialized]);
  return debounced === null ? null : (JSON.parse(debounced) as MediaToolQuoteInput);
}

export function useMediaToolQuote(
  toolType: string,
  input: MediaToolQuoteInput | null,
) {
  const debounced = useDebouncedSerialized(input);
  const userId = useAuthStore((state) => state.user?.userId ?? null);
  const query = useQuery({
    ...mediaToolQuoteOptions(toolType, debounced ?? {}, userId),
    enabled: debounced !== null,
  });
  return {
    credits: query.data?.credits ?? null,
    hasData: query.data !== undefined,
    isFetching: query.isFetching,
    isError: query.isError,
  };
}
