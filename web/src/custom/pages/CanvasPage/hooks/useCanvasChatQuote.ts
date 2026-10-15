import type { RefObject } from 'react';
import type { Node } from '@xyflow/react';
import type { SessionContentBlock } from '@/custom/api/agentSessions';
import { createConversationQuote } from '@/custom/api/canvas';
import { isApiError } from '@/shared/api/http';
import { collectMediaBlocks } from '../collectMediaBlocks';
import { QUOTE_TEXT_LIMIT, extractTextNodeText, quoteChipLabel, readPromptSource, textQuoteBlock, type QuoteConversationInput } from '../quoteConversation';

export interface CanvasChatQuoteHost {
  currentId: string;
  textNodesRef: RefObject<Node[]>;
  mediaNodesRef: RefObject<Node[]>;
  productNodesRef: RefObject<Node[]>;
  assetNodesRef: RefObject<Node[]>;
  showToast: (type: 'success' | 'error' | 'warn', msg: string) => void;
  blockInvalidDraft: (ids: string[]) => boolean;
  draftErrorsRef: RefObject<Map<string, string>>;
  setAgentContext: (value: {
    text: string;
    label?: string;
    ts: number;
    mediaBlocks?: SessionContentBlock[];
  }) => void;
  setShowAgent: (value: boolean) => void;
  setAgentCandidate: (value: SessionContentBlock[] | null | ((prev: SessionContentBlock[] | null) => SessionContentBlock[] | null)) => void;
}

export interface CanvasChatQuoteHandles {
  addToChatNode: (id: string) => void;
  confirmAgentCandidate: (blocks: SessionContentBlock[]) => Promise<SessionContentBlock[]>;
}

export function useCanvasChatQuote(host: CanvasChatQuoteHost): CanvasChatQuoteHandles {
  const {
    currentId,
    textNodesRef,
    mediaNodesRef,
    productNodesRef,
    assetNodesRef,
    showToast,
    blockInvalidDraft,
    draftErrorsRef,
    setAgentContext,
    setShowAgent,
    setAgentCandidate,
  } = host;

  const quoteTextIntoChat = async (input: QuoteConversationInput) => {
    if (input.text.length > QUOTE_TEXT_LIMIT) {
      showToast('warn', `正文超过 ${QUOTE_TEXT_LIMIT} 字上限，未添加到对话`);
      return;
    }
    try {
      const { quote } = await createConversationQuote({
        projectId: currentId,
        nodeId: input.nodeId,
        title: input.title,
        text: input.text,
        source: input.source ?? null,
      });
      const label = quoteChipLabel(input.title, input.text);
      const blocks = [textQuoteBlock({ nodeId: input.nodeId, chipId: String(input.ts), label, quote }), ...(input.extraBlocks ?? [])];
      setAgentCandidate((candidate) => (candidate?.some((block) => block.node_id === input.nodeId) ? null : candidate));
      setAgentContext({ text: `@${label}`, label, ts: input.ts, mediaBlocks: blocks });
      setShowAgent(true);
    } catch (e) {
      showToast('error', isApiError(e) ? `添加到对话失败：${e.message}` : '添加到对话失败，请检查网络后重试');
    }
  };
  const confirmAgentCandidate = async (blocks: SessionContentBlock[]): Promise<SessionContentBlock[]> => {
    const first = blocks[0];
    if (first.type !== 'text') return blocks;
    const node = textNodesRef.current.find((item) => item.id === first.node_id);
    if (!node) throw new Error('源文本节点已删除，请取消后重新选择');
    const draftError = draftErrorsRef.current.get(node.id);
    if (draftError) throw new Error(draftError);
    const text = extractTextNodeText(node.data);
    if (!text) throw new Error('文本正文为空，请编辑后重试');
    if (text.length > QUOTE_TEXT_LIMIT) throw new Error(`正文超过 ${QUOTE_TEXT_LIMIT} 字上限`);
    const title = typeof node.data.title === 'string' ? node.data.title : '';
    const { quote } = await createConversationQuote({
      projectId: currentId,
      nodeId: node.id,
      title,
      text,
      source: readPromptSource(node.data.promptSource),
    });
    return [textQuoteBlock({ nodeId: node.id, chipId: first.chip_id!, label: quoteChipLabel(title, text), quote })];
  };
  const addToChatNode = (id: string) => {
    const ts = Date.now();
    const p = productNodesRef.current.find((n) => n.id === id);
    if (p) {
      const name = (p.data?.name as string) || '商品';
      const mediaBlocks = collectMediaBlocks(p, String(ts));
      setAgentContext({
        text: `@${name}`,
        label: name,
        ts,
        mediaBlocks: mediaBlocks.length > 0 ? mediaBlocks : undefined,
      });
      setShowAgent(true);
      return;
    }
    const t = textNodesRef.current.find((n) => n.id === id);
    if (t) {
      if (blockInvalidDraft([id])) return;
      const text = extractTextNodeText(t.data as Record<string, unknown> | undefined);
      if (text) {
        void quoteTextIntoChat({
          nodeId: t.id,
          title: typeof t.data?.title === 'string' ? t.data.title : '',
          text,
          source: readPromptSource(t.data?.promptSource),
          ts,
        });
      } else {
        const label = typeof t.data?.title === 'string' && t.data.title.trim() ? t.data.title : '文本节点';
        setAgentContext({ text: `@${label}`, label, ts });
        setShowAgent(true);
      }
      return;
    }
    const m = mediaNodesRef.current.find((n) => n.id === id);
    if (m) {
      if (m.data?.assetMissing) {
        showToast('warn', '素材已被删除');
        return;
      }
      const type = m.data?.mediaType === 'video' ? '视频' : '图片';
      const label = `[${type}] ${m.data?.fileName || ''}`;
      const mediaBlocks = collectMediaBlocks(m, String(ts));
      setAgentContext({
        text: label,
        label,
        ts,
        mediaBlocks: mediaBlocks.length > 0 ? mediaBlocks : undefined,
      });
      setShowAgent(true);
      return;
    }
    const a = assetNodesRef.current.find((n) => n.id === id);
    if (a) {
      const gc = a.data?.generationCard as { shotTitle?: string; prompt?: string } | undefined;
      const kindTitle: Record<string, string> = {
        style: '风格卡',
        character: '角色卡',
        object: '物体卡',
        environment: '环境卡',
        custom: '自定义卡',
        generation: '生成卡',
      };
      const name = gc?.shotTitle || kindTitle[(a.data?.kind as string) ?? 'custom'] || '资产卡';
      const prompt = typeof gc?.prompt === 'string' ? gc.prompt : '';
      if (gc && prompt.trim()) {
        void quoteTextIntoChat({
          nodeId: a.id,
          title: gc.shotTitle ?? '',
          text: prompt,
          ts,
          extraBlocks: collectMediaBlocks(a, String(ts)),
        });
        return;
      }
      const mediaBlocks = collectMediaBlocks(a, String(ts));
      setAgentContext({
        text: `@${name}`,
        label: name,
        ts,
        mediaBlocks: mediaBlocks.length > 0 ? mediaBlocks : undefined,
      });
      setShowAgent(true);
    }
  };

  return { addToChatNode, confirmAgentCandidate };
}
