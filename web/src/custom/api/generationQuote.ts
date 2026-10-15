








import { queryOptions } from '@tanstack/react-query';
import { apiRequest, silentInit } from '@/shared/api/http';
import type { GenerationJobType, GenerationRefItem } from './jobs';
import type { StageQuoteView } from '@lib/contracts/video-sample-mode';



export type { GenerationJobType };








export interface QuoteJobParameters {
  model_id: string;

  size?: string;

  resolution?: string;
  aspect_ratio?: string;

  duration?: number;

  generate_audio?: boolean;


  sample_mode?: true;
  mode?: string;

  prompt?: string;
}


export interface QuoteJobPayload {
  type: GenerationJobType;
  parameters: QuoteJobParameters;
  expected_output_count: number;













  references?: GenerationRefItem[];





  target_node_id?: string;
}






export type GenerationQuote = StageQuoteView;







export function quoteGenerationJob(
  projectId: string,
  payload: QuoteJobPayload,
  init?: { silent?: boolean },
): Promise<GenerationQuote> {
  return apiRequest<GenerationQuote>(
    `/api/projects/${encodeURIComponent(projectId)}/generation-jobs/quote`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
      ...silentInit(init),
    },
  );
}

export const generationQuoteKeys = {
  all: ['generation-quote'] as const,


  quote: (projectId: string, payload: QuoteJobPayload) =>
    [...generationQuoteKeys.all, projectId, payload] as const,
};

export function generationQuoteOptions(
  projectId: string,
  payload: QuoteJobPayload,
) {
  return queryOptions({
    queryKey: generationQuoteKeys.quote(projectId, payload),
    queryFn: () => quoteGenerationJob(projectId, payload, { silent: true }),
  });
}
