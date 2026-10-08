import type { Node } from '@xyflow/react';
import type { PromptBinding } from '@lib/contracts/prompt-target';

export function draftFileNameOf(type: unknown): string {
  return type === 'video' ? '视频草稿' : type === 'audio' ? '音频草稿' : '图片草稿';
}

export function hasCustomName(node: Node | undefined): boolean {
  return ((node?.data ?? {}) as Record<string, unknown>).customName === true;
}

export function planBindingsCoveredBy(current: PromptBinding[], confirmed: PromptBinding[]): boolean {
  const confirmedKeys = new Set(confirmed.map(binding => `${binding.index}\0${binding.assetId}`));
  return current.every(binding => confirmedKeys.has(`${binding.index}\0${binding.assetId}`));
}

export function readNodeAssetId(data: Record<string, unknown>): string | number | undefined {
  return (data.assetId ?? data.asset_id ?? data.assetID) as string | number | undefined;
}
