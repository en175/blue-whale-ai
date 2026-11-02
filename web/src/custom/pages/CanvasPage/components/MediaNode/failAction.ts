import type { JobErrorCategory } from '@/custom/api/jobRecovery';

export type MediaFailAction =
  | 'retry'
  | 'legacy-retry'
  | 'checking'
  | 'edit-content'
  | 'edit-params'
  | 'replace-reference'
  | 'edit-model'
  | 'recharge'
  | 'requote'
  | 'save-failed'
  | 'none';

export interface MediaFailFacts {
  genStatus?: string;
  errorCode?: number | string;
  category?: JobErrorCategory;
  retryable?: boolean;
  videoStage?: 'sample' | 'final';
  hasRetryIdentity: boolean;
}

const SUBMISSION_UNKNOWN_CODE = 1014;

function isSubmissionUnknown(code?: number | string): boolean {
  return code != null && (String(code) === String(SUBMISSION_UNKNOWN_CODE) || String(code) === 'submission_unknown');
}

export function mediaFailAction(facts: MediaFailFacts): MediaFailAction {
  if (facts.genStatus !== 'failed') return 'none';
  if (isSubmissionUnknown(facts.errorCode)) return 'checking';
  if (facts.category === 'storage') return 'save-failed';
  if (facts.category === 'unknown') return 'none';
  if (facts.retryable === true) {
    return facts.videoStage === 'final' || !facts.hasRetryIdentity ? 'none' : 'retry';
  }
  switch (facts.category) {
    case 'content_rejected':
      return 'edit-content';
    case 'capability':
      return 'edit-params';
    case 'reference':
      return 'replace-reference';
    case 'model_unavailable':
      return 'edit-model';
    case 'quota':
      return 'recharge';
    case 'quote_changed':
      return 'requote';
    case 'transient':
      return 'none';
    default:
      break;
  }
  if (facts.videoStage === 'final' || !facts.hasRetryIdentity) return 'none';
  return 'legacy-retry';
}

export const MEDIA_FAIL_ACTION_LABELS: Record<MediaFailAction, string | null> = {
  retry: '重试',
  'legacy-retry': '重试',
  checking: '核对状态',
  'edit-content': '修改内容',
  'edit-params': '修改参数',
  'replace-reference': '更换素材',
  'edit-model': '修改模型',
  recharge: '去充值',
  requote: '重新报价',
  'save-failed': null,
  none: null,
};
