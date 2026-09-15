/** 子菜单（flyout）相对主面板顶部的垂直偏移。
 *
 * IKFO27：子菜单改为与触发它的分类行顶部对齐。原先子菜单固定贴主面板顶部，
 * 而分类行位于面板中下部，鼠标从分类行斜向移向子菜单时会穿过两者之间的空白区，
 * 菜单根容器的 onMouseLeave 提前触发，子菜单在光标到达前关闭。
 * 对齐之后子菜单的垂直范围覆盖触发它的那一行，鼠标水平移过去即可到达。
 *
 * 下方放不下时整体上移（贴主面板底部），保持子菜单不越出面板范围；
 * 子菜单比面板还高时退回顶部对齐，与既有表现一致。
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
}): number {
  const aligned = params.rowTop - params.panelTop;
  const lowest = params.panelHeight - params.flyoutHeight;
  return Math.max(0, Math.min(aligned, lowest));
}
