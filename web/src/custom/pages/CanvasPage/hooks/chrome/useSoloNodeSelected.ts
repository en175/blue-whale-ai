import { useStore } from '@xyflow/react';

export function isMultiNodeSelection(nodes: { selected?: boolean }[]): boolean {
  let selectedCount = 0;
  for (const node of nodes) {
    if (!node.selected) continue;
    selectedCount += 1;
    if (selectedCount > 1) return true;
  }
  return false;
}

export function useSoloNodeSelected(selected?: boolean): boolean {
  const multiSelected = useStore((state) => isMultiNodeSelection(state.nodes));
  return Boolean(selected) && !multiSelected;
}
