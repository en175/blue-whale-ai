import { useContext } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { Zap } from 'lucide-react';
import { useAuthStore } from '@/shared/stores/auth';
import { useMediaToolQuote, type MediaToolQuoteParams } from '@/custom/api/mediaToolQuote';
import styles from './index.module.css';

interface MediaToolQuoteBadgeProps {
  toolType: string;
  params?: MediaToolQuoteParams | null;
  variant?: 'pill' | 'hint';
  testId?: string;
}

export default function MediaToolQuoteBadge(props: MediaToolQuoteBadgeProps) {
  const client = useContext(QueryClientContext);
  if (!client) return null;
  return <QuoteBadge {...props} />;
}

function QuoteBadge({
  toolType,
  params,
  variant = 'pill',
  testId,
}: MediaToolQuoteBadgeProps) {
  const { credits, hasData, isFetching, isError } = useMediaToolQuote(
    toolType,
    params ?? null,
  );
  const balance = useAuthStore((state) => state.credits);

  if (params === undefined || params === null) return null;

  const base = variant === 'pill' ? styles.pill : styles.hint;
  const iconSize = variant === 'pill' ? 10 : 11;

  if (credits === null) {
    if (!isError) return null;
    return (
      <span className={base} data-testid={testId}>
        <Zap size={iconSize} fill="currentColor" strokeWidth={0} />
        暂无法报价
      </span>
    );
  }

  if (credits <= 0) {
    return (
      <span className={base} data-testid={testId}>
        <Zap size={iconSize} fill="currentColor" strokeWidth={0} />
        本工具当前不计费
      </span>
    );
  }

  const insufficient = typeof balance === 'number' && balance < credits;
  const className = [
    base,
    insufficient ? styles.danger : '',
    isFetching && hasData ? styles.loading : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={className} data-testid={testId}>
      <Zap size={iconSize} fill="currentColor" strokeWidth={0} />
      本次预计消耗 <strong>{credits} 积分</strong>
      {insufficient ? ` · 余额 ${balance}` : null}
    </span>
  );
}
