import { useQuery } from '@tanstack/react-query';
import { Zap } from 'lucide-react';
import {
  generationQuoteOptions,
  type GenerationJobType,
  type QuoteJobParameters,
} from '@/api/generationQuote';
import type { GenerationRefItem } from '@/api/jobs';
import styles from './index.module.css';

interface GenerationQuoteBadgeProps {
  projectId: string;
  type: GenerationJobType;
  parameters: QuoteJobParameters;
  references?: GenerationRefItem[];
  targetNodeId?: string;
}

export default function GenerationQuoteBadge(props: GenerationQuoteBadgeProps) {
  if (!props.projectId) return null;
  return <QuoteBadge {...props} />;
}

function QuoteBadge({ projectId, type, parameters, references, targetNodeId }: GenerationQuoteBadgeProps) {
  const { data } = useQuery({
    ...generationQuoteOptions(projectId, {
      type,
      parameters,
      expected_output_count: 1,
      ...(references && references.length > 0 ? { references } : {}),
      ...(targetNodeId ? { target_node_id: targetNodeId } : {}),
    }),
    enabled: parameters.model_id !== '',
  });

  const credits = data?.credits ?? null;
  if (credits === null) return null;

  return (
    <span className={styles.badge} data-testid="generation-quote">
      <Zap size={12} strokeWidth={2} />
      <span>本次预计消耗 {credits} 积分</span>
      {}
      {data?.duration_basis === 'source_video' && (
        <span className={styles.basisTag} data-testid="generation-quote-basis">按源视频时长预估</span>
      )}
    </span>
  );
}
