export type JobErrorCategory =
  | 'transient'
  | 'content_rejected'
  | 'capability'
  | 'reference'
  | 'model_unavailable'
  | 'quota'
  | 'storage'
  | 'quote_changed'
  | 'unknown';

export interface JobRecoveryFacts {
  category?: JobErrorCategory;
  retryable?: boolean;
}

const JOB_ERROR_CATEGORIES: readonly JobErrorCategory[] = [
  'transient',
  'content_rejected',
  'capability',
  'reference',
  'model_unavailable',
  'quota',
  'storage',
  'quote_changed',
  'unknown',
];

export function readJobRecoveryFacts(
  source?: { category?: unknown; retryable?: unknown } | null,
): JobRecoveryFacts {
  const facts: JobRecoveryFacts = {};
  if (typeof source?.category === 'string' && JOB_ERROR_CATEGORIES.includes(source.category as JobErrorCategory)) {
    facts.category = source.category as JobErrorCategory;
  }
  if (typeof source?.retryable === 'boolean') facts.retryable = source.retryable;
  return facts;
}
