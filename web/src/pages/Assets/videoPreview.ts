export function startVideoPreview(video: HTMLVideoElement | null): void {
  if (!video) return;

  video.muted = true;
  try {
    void video.play().catch(() => undefined);
  } catch {
  }
}

export function stopVideoPreview(video: HTMLVideoElement | null): void {
  if (!video) return;

  video.pause();
  try {
    video.currentTime = 0;
  } catch {
  }
}
