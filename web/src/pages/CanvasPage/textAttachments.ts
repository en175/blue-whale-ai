import type { Edge, Node } from '@xyflow/react';
import { replaceImageMentionsWithAssetTokens, type MediaMention, type MediaRef } from '@lib/contracts/text-node-media';
import { extractTextNodeText } from './quoteConversation';
import type { ImageTextAttachment } from './components/ImageDialog';

export function textAttachmentsOf(targetNodeId: string, edges: Edge[], textNodes: Node[]): ImageTextAttachment[] {
  return edges
    .filter((e) => e.target === targetNodeId)
    .map((e) => textNodes.find((n) => n.id === e.source))
    .filter((n): n is Node => n?.type === 'textNode')
    .map((n) => ({
      nodeId: n.id,
      isPromptPlan: Boolean(n.data.promptSource),
      title: typeof n.data.title === 'string' && n.data.title ? (n.data.title as string) : '文本节点',
      text: extractTextNodeText(n.data),
    }));
}

export function textAttachmentsForSend(targetNodeId: string, edges: Edge[], textNodes: Node[]): ImageTextAttachment[] {
  return textAttachmentsOf(targetNodeId, edges, textNodes).map((att) => {
    const node = textNodes.find((n) => n.id === att.nodeId);
    const mentions = Array.isArray(node?.data.mediaMentions) ? (node.data.mediaMentions as MediaMention[]) : [];
    const refs = Array.isArray(node?.data.mediaRefs) ? (node.data.mediaRefs as MediaRef[]) : [];
    const imageNodeIds = new Set(refs.filter((ref) => ref.mediaType === 'image').map((ref) => ref.nodeId));
    const promptMentions = Array.isArray(node?.data.promptMentions) ? (node.data.promptMentions as Array<{ start: number; end: number; assetId: string }>) : [];
    const promptMaterials = Array.isArray(node?.data.promptMaterials) ? (node.data.promptMaterials as Array<{ assetId: string; mediaType: 'image' | 'video' | 'audio' }>) : [];
    const promptImageAssetIds = new Set(promptMaterials.filter((m) => m.mediaType === 'image').map((m) => m.assetId));
    const promptMentionsAdapted: MediaMention[] = promptMentions.map((m) => ({ start: m.start, end: m.end, nodeId: m.assetId, assetId: m.assetId }));
    const allMentions = [...mentions, ...promptMentionsAdapted];
    const isImage = (mention: MediaMention) => imageNodeIds.has(mention.nodeId) || promptImageAssetIds.has(mention.assetId);
    return {
      ...att,
      text: replaceImageMentionsWithAssetTokens(att.text, allMentions, isImage),
    };
  });
}
