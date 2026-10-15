export function computeFlyoutOffset(params: {
  rowTop: number;
  panelTop: number;
  panelHeight: number;
  flyoutHeight: number;
  rowHeight?: number;
}): number {
  const rowHeight = params.rowHeight ?? 38;
  const rowOffset = params.rowTop - params.panelTop;
  const rowBottom = rowOffset + rowHeight;
  const snapToDialog = params.panelHeight - params.flyoutHeight;
  const maxOffset = rowOffset;
  const minOffset = rowBottom - params.flyoutHeight;
  return Math.min(maxOffset, Math.max(minOffset, snapToDialog));
}
