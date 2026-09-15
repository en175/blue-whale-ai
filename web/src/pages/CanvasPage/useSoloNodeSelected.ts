import { useStore } from '@xyflow/react';

/** 当前画布是否处于多节点选中（框选 / Ctrl 加选 / Ctrl+A 等） */
function isMultiNodeSelection(nodes: { selected?: boolean }[]): boolean {
  let selectedCount = 0;
  for (const node of nodes) {
    if (!node.selected) continue;
    selectedCount += 1;
    if (selectedCount > 1) return true;
  }
  return false;
}

/**
 * 仅在「本节点被选中且画布只有这一个选中节点」时为 true。
 * 框选多节点时只保留选中高亮，不弹出单节点操作条。
 */
export function useSoloNodeSelected(selected?: boolean): boolean {
  const multiSelected = useStore((state) => isMultiNodeSelection(state.nodes));
  return Boolean(selected) && !multiSelected;
}
