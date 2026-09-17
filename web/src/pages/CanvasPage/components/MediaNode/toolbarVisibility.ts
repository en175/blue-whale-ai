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
