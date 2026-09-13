/* ============================================
 * 统一附件来源入口的类型筛选边界（IKFE8S/IKFE8T/IKFE8U）：
 * 各生成面板普通参考允许的媒体类型表——来源列表过滤（资产弹窗 mediaTypes）
 * 与画布禁选提示共用同一表。文本不在此表：文本沿用文本节点/文本附件与
 * 正文引用链路，不经媒体来源菜单筛选。类型表是上限，不承诺每种来源
 * 拥有全部类型；数量/格式/只读/满额等模型限制仍由既有规则执行。
 * 视频含模式维度：全能参考收图/视频/音频（画布接纳校验走 videoRefSourceError
 * 角色感知口径，不经本表），图生视频仅图片；音频面板仅音频。
 * ============================================ */

type MediaTypesEntry = { types: readonly string[]; canvasRefError?: string };

/** 面板普通参考定义：允许的媒体类型 + 画布禁选提示文案（单表收敛，避免平行结构） */
export const PANEL_REF_MEDIA_TYPES = {
  audio: { types: ['audio'], canvasRefError: '音频参考仅支持音频素材' },
  image: { types: ['image'], canvasRefError: '图片参考仅支持图片素材' },
  /** 视频全能参考（IKFE8U）：普通参考收图片/视频/音频；供资产弹窗过滤与
   *  接纳防线（图9/视频3/音频3 联算）消费，画布校验走 videoRefSourceError */
  videoAll: { types: ['image', 'video', 'audio'] },
  /** 视频图生视频（IKFE8U）：普通参考仅图片（画布禁选提示走本键）；
   *  首尾帧槽同为仅图片（槽位资产过滤直接 ['image']，与 checkAddVideoRef 首尾帧约束同口径） */
  videoText2Video: { types: ['image'], canvasRefError: '图生视频参考仅支持图片素材' },
} as const;

export type RefPanelKind = keyof typeof PANEL_REF_MEDIA_TYPES;

/** 画布节点能否作为指定面板的普通参考：不可选时返回用户可读原因
 *  （画布保留节点、禁选并提示，不产生参考或附件），可选返回 null。 */
export function panelCanvasRefError(panel: RefPanelKind, mediaType: unknown): string | null {
  const def = PANEL_REF_MEDIA_TYPES[panel] as MediaTypesEntry;
  return def.types.includes(mediaType as never) ? null : (def.canvasRefError ?? '不支持该类型素材');
}
