export type DerivedAgentPhase =
  | 'idle'
  | 'processing'
  | 'awaiting_input'
  | 'awaiting_confirm'
  | 'generating_cards'
  | 'cards_ready'
  | 'applying'
  | 'applied'
  | 'payment_required'
  | 'failed';

interface PhaseMessage {
  role: 'user' | 'assistant';
  blocks?: { type: string }[];
}

interface DeriveAgentPhaseInput {
  messages: PhaseMessage[];
  running: boolean;
  streaming: boolean;
  failed: boolean;
  sessionPhase: string;
  paymentRequired: boolean;
}

/** 将服务端阶段、运行态与最新正式消息归并为唯一用户可见状态。 */
export function deriveAgentPhase(input: DeriveAgentPhaseInput): DerivedAgentPhase {
  const { messages, running, streaming, failed, sessionPhase, paymentRequired } = input;
  if (paymentRequired) return 'payment_required';
  if (failed) return 'failed';

  const assistantMessages = messages.filter((message) => message.role === 'assistant');
  const blocks = assistantMessages.at(-1)?.blocks ?? [];
  const hasCards = blocks.some((block) => block.type === 'card');

  if (running || streaming) return hasCards ? 'generating_cards' : 'processing';
  if (sessionPhase === 'awaiting_understanding_confirmation') return 'awaiting_confirm';
  if (hasCards) return 'cards_ready';
  if (assistantMessages.length === 1) return 'awaiting_input';

  // 没有活跃 Run、确认门、失败或交付卡时，本轮已经结束，面板必须回到可输入态。
  return 'idle';
}
