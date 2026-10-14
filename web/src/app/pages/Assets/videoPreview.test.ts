import { describe, expect, it, vi } from 'vitest';
import { startVideoPreview, stopVideoPreview } from './videoPreview';

function createVideo() {
  return {
    muted: false,
    currentTime: 12,
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
  } as unknown as HTMLVideoElement;
}

describe('video hover preview', () => {
  it('starts a muted preview without exposing player controls', async () => {
    const video = createVideo();

    startVideoPreview(video);

    expect(video.muted).toBe(true);
    expect(video.play).toHaveBeenCalledOnce();
  });

  it('stops and rewinds the preview as soon as the pointer leaves', () => {
    const video = createVideo();

    stopVideoPreview(video);

    expect(video.pause).toHaveBeenCalledOnce();
    expect(video.currentTime).toBe(0);
  });

  it('does not surface a failed autoplay attempt to the card interaction', async () => {
    const video = createVideo();
    video.play = vi.fn().mockRejectedValue(new Error('Autoplay blocked'));

    startVideoPreview(video);
    await Promise.resolve();

    expect(video.play).toHaveBeenCalledOnce();
  });
});
