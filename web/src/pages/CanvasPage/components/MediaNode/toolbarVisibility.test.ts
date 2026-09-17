import { describe, expect, it } from 'vitest';
import { mediaNodeToolbarVisibility } from './toolbarVisibility';

describe('mediaNodeToolbarVisibility', () => {
  it('hides mention, generate-image, image-quality menu and generate-video on audio nodes', () => {
    expect(mediaNodeToolbarVisibility('audio')).toEqual({
      mention: false,
      genImage: false,
      genVideo: false,
      imageQuality: false,
    });
  });

  it('keeps mention and generate actions on image nodes', () => {
    expect(mediaNodeToolbarVisibility('image')).toEqual({
      mention: true,
      genImage: true,
      genVideo: true,
      imageQuality: true,
    });
  });

  it('keeps mention and generate-video on video nodes, still hides generate-image and image-quality menu', () => {
    expect(mediaNodeToolbarVisibility('video')).toEqual({
      mention: true,
      genImage: false,
      genVideo: true,
      imageQuality: false,
    });
  });

  it('treats unspecified media as an image node', () => {
    expect(mediaNodeToolbarVisibility(undefined)).toEqual({
      mention: true,
      genImage: true,
      genVideo: true,
      imageQuality: true,
    });
  });
});
