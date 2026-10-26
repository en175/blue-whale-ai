import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiRequest } from '@/shared/api/http';
import { useAuthStore } from '@/shared/stores/auth';

export type MediaToolQuoteParams = Record<string, unknown>;

export interface MediaToolQuote {
  credits: number | null;
  quote_revision: string | null;
}

export const mediaToolQuoteKeys = {
  all: ['media-tool-quote'] as const,
  one: (toolType: string, params: MediaToolQuoteParams, userId: number | null = null) =>
    [...mediaToolQuoteKeys.all, toolType, userId, params] as const,
};

export function fetchMediaToolQuote(
  toolType: string,
  params: MediaToolQuoteParams,
): Promise<MediaToolQuote> {
  return apiRequest<MediaToolQuote>(
    `/api/media-tools/${encodeURIComponent(toolType)}/quote`,
    {
      method: 'POST',
      body: JSON.stringify(params),
      silent: true,
    },
  );
}

export function mediaToolQuoteOptions(
  toolType: string,
  params: MediaToolQuoteParams,
  userId: number | null = null,
) {
  return queryOptions({
    queryKey: mediaToolQuoteKeys.one(toolType, params, userId),
    queryFn: () => fetchMediaToolQuote(toolType, params),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

function useDebouncedSerialized(
  params: MediaToolQuoteParams | null,
): MediaToolQuoteParams | null {
  const serialized = params === null ? null : JSON.stringify(params);
  const [debounced, setDebounced] = useState(serialized);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(serialized), 300);
    return () => clearTimeout(timer);
  }, [serialized]);
  return debounced === null ? null : (JSON.parse(debounced) as MediaToolQuoteParams);
}

export function useMediaToolQuote(
  toolType: string,
  params: MediaToolQuoteParams | null,
) {
  const debounced = useDebouncedSerialized(params);
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
