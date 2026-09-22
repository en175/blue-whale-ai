/** 子菜单（flyout）相对主面板顶部的垂直偏移。
 *
 * IKFO27：子菜单必须覆盖触发它的分类行，鼠标才能从分类行水平移过去；
 * 否则会穿过空白区，根容器 onMouseLeave 提前关掉子菜单。
 *
 * IKGMAF：一级菜单位置由主面板单独撑开，子菜单绝对定位、不参与外壳高度。
 * 子菜单在保持与触发行连通的前提下，优先把底部贴住主面板（吸附对话框）；
 * 素材过多、子菜单高于面板时允许向上伸出，而不是把一级菜单顶走。
 */
export function computeFlyoutOffset(params: {
  /** 触发行的顶部（视口坐标） */
  rowTop: number;
  /** 主面板顶部（视口坐标） */
  panelTop: number;
  /** 主面板高度 */
  panelHeight: number;
  /** 子菜单自身高度 */
  flyoutHeight: number;
  /** 触发行高度，缺省按分类行 38px */
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
