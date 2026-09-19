export type CanvasMediaType = 'image' | 'video' | 'audio';

export function mediaNodeToolbarVisibility(mediaType: CanvasMediaType | undefined) {
  const isAudio = mediaType === 'audio';
  const isVideo = mediaType === 'video';
  return {
    mention: !isAudio,
    genImage: !isAudio && !isVideo,
    genVideo: !isAudio,
    /** 「高清 ▾」下拉（IKGOT7，原「高清放大」单按钮改造）：与「生成图片」同族，仅图片卡显示；
     *  菜单项（高清/擦除，扩图后续插入中间位）随下拉整体出现 */
    imageQuality: !isAudio && !isVideo,
  };
}

/** 悬浮工具条数据门（IKGYYB 审查收口，命名对齐资产卡 assetCardToolbarVisible 先例）：
 *  生成流程卡（genStatus 有值）/ 素材缺失（assetMissing）/ 空壳上传卡（emptyShell）不显。
 *  迁出钉屏幕层前该判定在 MediaNode 卡内；迁移后 CanvasPage 显隐门与 MediaNodeToolbar
 *  渲染兜底构成同一门双实现，统一为此谓词共用（两处口径本就一致，行为不变）。
 *  字段收宽为 unknown：CanvasPage 侧节点 data 是未收窄的 Record。 */
export function mediaCardToolbarVisible(
  data: { genStatus?: unknown; assetMissing?: unknown; emptyShell?: unknown },
): boolean {
  return !data.genStatus && !data.assetMissing && data.emptyShell !== true;
}
