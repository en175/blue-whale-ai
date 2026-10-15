export function formatTime(sec: number): string {
  if (!isFinite(sec) || sec <= 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function toggleVideoPlayback(video: HTMLVideoElement | null) {
  if (!video) return;
  if (video.paused) void video.play().catch(() => {});
  else video.pause();
}

export function sampleDeadlineExpired(at?: string | null): boolean {
  if (!at) return false;
  const d = new Date(at);
  return !Number.isNaN(d.getTime()) && Date.now() > d.getTime();
}

export interface VideoSourceOption {
  src: string;
  type: string;
}

export function videoSourceList(src?: string, srcH264?: string): VideoSourceOption[] {
  const list: VideoSourceOption[] = [];
  if (src) list.push({ src, type: 'video/mp4' });
  if (srcH264 && srcH264 !== src) list.push({ src: srcH264, type: 'video/mp4; codecs="avc1"' });
  return list;
}

export function videoLoadErrorMessage(code?: number): string {
  switch (code) {
    case 4: return '浏览器不支持该视频编码，请更换浏览器';
    case 3: return '视频解码失败';
    case 2: return '视频加载失败';
    default: return '视频无法播放';
  }
}
