import { describe, expect, it } from 'vitest';
import type { GenerationModel } from '@/custom/api/generation';
import { buildImageQuotePayload, buildVideoQuotePayload } from './homeQuoteParams';

const baseFeatures = {
  reference_image: true,
  watermark: false,
  quantity_max: 1,
  sequential_image_generation: false,
  stream: false,
  tools: false,
  first_frame: true,
  last_frame: true,
  first_last_frame: true,
  audio: true,
  image_reference_max: 10,
};

function model(overrides: Partial<GenerationModel> = {}): GenerationModel {
  return {
    model_id: 'seedance-2.5',
    provider_id: 'p',
    model_label: 'Seedance 2.5',
    icon: null,
    supported_sizes: [
      { id: '720p', label: '720p', api_value: '720p' },
      { id: '1080p', label: '1080p', api_value: 'fhd' },
    ],
    supported_aspect_ratios: [{ id: '16:9', label: '16:9' }],
    supported_formats: ['mp4'],
    supported_durations: { min: 4, max: 15, step: 1 },
    default_size: '720p',
    default_format: 'mp4',
    default_aspect_ratio: '16:9',
    default_duration: 5,
    features: { ...baseFeatures },
    is_default: false,
    version: 1,
    digest: '',
    ...overrides,
  };
}

describe('首页预估请求体（IKR63N 报价接线）', () => {
  it('视频清晰度取 supported_sizes 的 api_value，与提交口径一致', () => {
    const payload = buildVideoQuotePayload({
      model: model(),
      mode: 'text2video',
      aspectRatio: '16:9',
      resolution: '1080p',
      duration: 8,
      generateAudio: true,
      prompt: '海边日落',
      references: [],
    });

    expect(payload?.parameters.resolution).toBe('fhd');
    expect(payload?.parameters.duration).toBe(8);
    expect(payload?.parameters.mode).toBe('text2video');
    expect(payload?.parameters.generate_audio).toBe(true);
  });

  it('模型不支持音频时不带 generate_audio；空提示词不带 prompt', () => {
    const payload = buildVideoQuotePayload({
      model: model({ features: { ...baseFeatures, audio: false } }),
      mode: 'text2video',
      aspectRatio: '16:9',
      resolution: '720p',
      duration: 8,
      generateAudio: true,
      prompt: '   ',
      references: [],
    });

    expect(payload?.parameters).not.toHaveProperty('generate_audio');
    expect(payload?.parameters).not.toHaveProperty('prompt');
  });

  it('参考视频带时长，参考图只带类型', () => {
    const payload = buildVideoQuotePayload({
      model: model(),
      mode: 'omni',
      aspectRatio: '16:9',
      resolution: '720p',
      duration: 8,
      generateAudio: true,
      prompt: 'x',
      references: [{ type: 'video', duration: 6 }, { type: 'image' }],
    });

    expect(payload?.references).toEqual([{ type: 'video', duration: 6 }, { type: 'image' }]);
  });

  it('未选模型时不请求', () => {
    expect(buildVideoQuotePayload({
      model: undefined,
      mode: 'text2video',
      aspectRatio: '16:9',
      resolution: '720p',
      duration: 8,
      generateAudio: true,
      prompt: 'x',
      references: [],
    })).toBeNull();
    expect(buildImageQuotePayload({
      model: undefined,
      size: '2k',
      aspectRatio: '1:1',
      prompt: 'x',
      references: [],
    })).toBeNull();
  });

  it('图片请求带 size 与 aspect_ratio，不带视频字段', () => {
    const payload = buildImageQuotePayload({
      model: model({ model_id: 'seedream-5' }),
      size: '2k',
      aspectRatio: '1:1',
      prompt: '插画',
      references: [{ type: 'image' }],
    });

    expect(payload).toEqual({
      type: 'image',
      parameters: { model_id: 'seedream-5', size: '2k', aspect_ratio: '1:1', prompt: '插画' },
      references: [{ type: 'image' }],
    });
  });
});
