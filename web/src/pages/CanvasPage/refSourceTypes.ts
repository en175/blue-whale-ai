/* ============================================
 * 统一附件来源入口的类型筛选边界（IKFE8S/IKFE8T）：
 * 各生成面板普通参考允许的媒体类型表——来源列表过滤（资产弹窗 mediaTypes）
 * 与画布选取校验共用同一表。文本不在此表：文本沿用文本节点/文本附件与
 * 正文引用链路，不经媒体来源菜单筛选。类型表是上限，不承诺每种来源
 * 拥有全部类型；数量/格式/只读/满额等模型限制仍由既有规则执行。
 * 视频/音频面板由后续子任务按键补充（视频含模式维度，按模式定义边界）。
 * ============================================ */

/** 面板普通参考定义：允许的媒体类型 + 画布禁选提示文案（单表收敛，避免平行结构） */
export const PANEL_REF_MEDIA_TYPES = {
  image: { types: ['image'], canvasRefError: '图片参考仅支持图片素材' },
} as const;

export type RefPanelKind = keyof typeof PANEL_REF_MEDIA_TYPES;

/** 画布节点能否作为指定面板的普通参考：不可选时返回用户可读原因
 *  （画布保留节点、禁选并提示，不产生参考或附件），可选返回 null。 */
export function panelCanvasRefError(panel: RefPanelKind, mediaType: unknown): string | null {
  const def = PANEL_REF_MEDIA_TYPES[panel];
  return def.types.includes(mediaType as never) ? null : def.canvasRefError;
}
