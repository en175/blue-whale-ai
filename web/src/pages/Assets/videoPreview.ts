/** 仅用于素材卡片的静音悬浮视频预览，不启用播放器控件。 */
export function startVideoPreview(video: HTMLVideoElement | null): void {
  if (!video) return;

  video.muted = true;
  try {
    void video.play().catch(() => undefined);
  } catch {
    // 浏览器可能在资源尚未准备好时同步拒绝播放，卡片仍可正常打开详情。
  }
}

/** 悬浮结束或组件卸载时立即停止，并尽可能回到首帧。 */
export function stopVideoPreview(video: HTMLVideoElement | null): void {
  if (!video) return;

  video.pause();
  try {
    video.currentTime = 0;
  } catch {
    // 视频元数据尚未就绪时无法定位，停在当前帧即可。
  }
}
