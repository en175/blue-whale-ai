
export interface MediaContentSizeInput {
  mediaType?: 'image' | 'video' | 'audio';
  width?: number;
  height?: number;
  ratio?: string;
}

export interface MediaContentBox {
  width: number;
  height: number;
}

export interface MediaDims {
  width?: number;
  height?: number;
  duration?: number;
}

export const MEDIA_CONTENT_SHORT_SIDE = 280;
const MEDIA_CONTENT_LONG_SIDE_MAX = 840;

const MEDIA_AUDIO_CONTENT_WIDTH = 480;
const MEDIA_AUDIO_CONTENT_HEIGHT = 240;

export const MEDIA_CONTENT_TOP_OFFSET = 22.5;

function parseRatio(ratio?: string): number | null {
  if (!ratio) return null;
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(ratio.trim());
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!(w > 0) || !(h > 0)) return null;
  return w / h;
}

export function mediaContentBox({ mediaType, width, height, ratio }: MediaContentSizeInput): MediaContentBox {
  if (mediaType === 'audio') {
    return { width: MEDIA_AUDIO_CONTENT_WIDTH, height: MEDIA_AUDIO_CONTENT_HEIGHT };
  }
  let r: number | null = null;
  if (typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0) {
    r = width / height;
  } else {
    r = parseRatio(ratio);
  }
  if (r == null) {
    return { width: MEDIA_CONTENT_SHORT_SIDE, height: MEDIA_CONTENT_SHORT_SIDE };
  }
  let w: number;
  let h: number;
  if (r >= 1) {
    h = MEDIA_CONTENT_SHORT_SIDE;
    w = MEDIA_CONTENT_SHORT_SIDE * r;
  } else {
    w = MEDIA_CONTENT_SHORT_SIDE;
    h = MEDIA_CONTENT_SHORT_SIDE / r;
  }
  const long = Math.max(w, h);
  if (long > MEDIA_CONTENT_LONG_SIDE_MAX) {
    const s = MEDIA_CONTENT_LONG_SIDE_MAX / long;
    w *= s;
    h *= s;
  }
  return { width: w, height: h };
}
