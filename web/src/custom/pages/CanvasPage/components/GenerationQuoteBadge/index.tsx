import { type GenerationJobType } from '@/custom/enums';
import { useQuery } from '@tanstack/react-query';
import { Zap } from 'lucide-react';
import { generationQuoteOptions, type QuoteJobParameters } from '@/custom/api/generationQuote';
import type { GenerationRefItem } from '@/custom/api/jobs';
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
  const { data, isError } = useQuery({
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
  if (credits === null) {
    if (!isError) return null;
    return (
      <span className={`${styles.badge} ${styles.danger}`} data-testid="generation-quote">
        加载计费失败
      </span>
    );
  }

  return (
    <span className={styles.badge} data-testid="generation-quote">
      <Zap size={12} fill="currentColor" strokeWidth={0} />
      <strong>{credits}</strong>
    </span>
  );
}
