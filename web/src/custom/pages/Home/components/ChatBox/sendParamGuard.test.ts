import { describe, expect, it } from 'vitest';
import type { GenerationModel } from '@/custom/api/generation';
import { imageParamsRejected, videoParamsRejected } from './sendParamGuard';

const baseFeatures = {
  reference_image: true,
  image_reference_max: 10,
  video_reference: true,
  video_reference_max: 3,
  watermark: false,
  quantity_max: 1,
  sequential_image_generation: false,
  stream: false,
  tools: false,
  first_frame: true,
  last_frame: true,
  first_last_frame: true,
  task_types: {
    text2video: {},
    omni: {},
    image_reference: {},
    first_frame: {},
    first_last_frame: {},
  },
  audio: true,
};

const videoModel: GenerationModel = {
  model_id: 'seedance-2.5',
  provider_id: 'p',
  model_label: 'Seedance 2.5',
  icon: null,
  supported_sizes: [
    { id: '720p', label: '720p', api_value: '720p', width: null, height: null },
    { id: '1080p', label: '1080p', api_value: '1080p', width: null, height: null },
  ],
  supported_aspect_ratios: [{ id: 'adaptive', label: 'adaptive' }, { id: '16:9', label: '16:9' }],
  supported_formats: ['mp4'],
  supported_durations: { min: 4, max: 15, step: 1 },
  default_size: '720p',
  default_format: 'mp4',
  default_aspect_ratio: '16:9',
  default_duration: 10,
  features: baseFeatures,
  is_default: false,
  version: 1,
  digest: '',
};

describe('videoParamsRejected', () => {
  const ok = { aspectRatio: '16:9', resolution: '720p', duration: 10, mode: 'text2video' as const };

  it('合法参数放行', () => {
    expect(videoParamsRejected(videoModel, ok)).toBe(false);
  });

  it('比例不在模型能力内时拦截', () => {
    expect(videoParamsRejected(videoModel, { ...ok, aspectRatio: '21:9' })).toBe(true);
  });

  it('清晰度不在模型能力内时拦截', () => {
    expect(videoParamsRejected(videoModel, { ...ok, resolution: '2160p' })).toBe(true);
  });

  it('时长超出区间时拦截', () => {
    expect(videoParamsRejected(videoModel, { ...ok, duration: 30 })).toBe(true);
    expect(videoParamsRejected(videoModel, { ...ok, duration: 1 })).toBe(true);
  });

  it('模型缺失时不误拦截', () => {
    expect(videoParamsRejected(undefined, ok)).toBe(false);
  });
});

describe('imageParamsRejected', () => {
  const imageModel: GenerationModel = {
    ...videoModel,
    model_id: 'img-1',
    supported_sizes: [{ id: '1024', label: '1024', api_value: '1024', width: 1024, height: 1024 }],
    supported_aspect_ratios: [{ id: '1:1', label: '1:1' }],
    supported_formats: ['png'],
    supported_durations: null,
    default_size: '1024',
    default_format: 'png',
    default_aspect_ratio: '1:1',
    features: { ...baseFeatures, audio: false },
  };

  it('合法参数放行', () => {
    expect(imageParamsRejected(imageModel, { ratio: '1:1', size: '1024' })).toBe(false);
  });

  it('尺寸不在能力内时拦截', () => {
    expect(imageParamsRejected(imageModel, { ratio: '1:1', size: '2048' })).toBe(true);
  });

  it('比例不属于当前尺寸时拦截', () => {
    expect(imageParamsRejected(imageModel, { ratio: '16:9', size: '1024' })).toBe(true);
  });
});
