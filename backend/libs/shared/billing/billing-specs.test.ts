import { describe, expect, it } from 'vitest';

import { extractSpecs } from './billing-specs.js';

const videoSpecs = (input: Record<string, unknown>) => extractSpecs(input, 'video');

describe('extractSpecs', () => {
  it('只取标量，键统一小写', () => {
    expect(
      videoSpecs({ Size: '2K', Duration: 5, Flag: true, refs: [{ url: 'x' }], none: null }),
    ).toEqual({
      size: '2k',
      duration: '5',
      flag: 'true',
      reference_count: '0',
      video: '0',
    });
  });

  it('★ 参考素材数按数组长度进规格 —— 数组本身不进，只取长度', () => {
    expect(videoSpecs({ references: [{ url: 'a' }, { url: 'b' }] })).toEqual({
      reference_count: '2',
      video: '0',
    });
    expect(videoSpecs({ size: '2k' })).toEqual({
      size: '2k',
      reference_count: '0',
      video: '0',
    });
  });

  it('★ 是否含视频输入按 references 的元素类型折算 —— 决定视频 token 的单价档', () => {
    expect(
      videoSpecs({
        references: [
          { role: 'reference', type: 'image', asset_id: '1' },
          { role: 'reference', type: 'video', asset_id: '2' },
        ],
      }),
    ).toEqual({ reference_count: '2', video: '1' });

    expect(
      videoSpecs({
        references: [
          { role: 'first_frame', type: 'image' },
          { role: 'last_frame', type: 'image' },
        ],
      }),
    ).toEqual({ reference_count: '2', video: '0' });
  });

  it('★ video 档的口径与 reference_count 逐条相同：只认 references 这一个数组', () => {
    const specs = videoSpecs({
      reference_asset_ids: ['21', '22'],
      reference_materials: [{ type: 'video' }],
    });

    expect(specs).toEqual({ reference_count: '0', video: '0' });
    expect(specs).not.toHaveProperty('reference_asset_ids');
    expect(specs).not.toHaveProperty('reference_materials');
  });

  it('★ 输入视频时长折算成标量键 —— 官方公式含视频输入时要把输入时长算进 token', () => {
    expect(
      videoSpecs({
        references: [{ role: 'reference', type: 'video', asset_id: '2', duration: 5 }],
      }),
    ).toEqual({
      reference_count: '1',
      video: '1',
      video_input_seconds: '5',
    });

    expect(
      videoSpecs({
        references: [
          { role: 'reference', type: 'video', asset_id: '2', duration: 5 },
          { role: 'reference', type: 'video', asset_id: '3', duration: 8 },
        ],
      }),
    ).toMatchObject({ video_input_seconds: '13' });
  });

  it('★ 量不到输入时长就整个键不写 —— 不许按 0 估', () => {
    expect(
      videoSpecs({
        references: [
          { role: 'reference', type: 'video', asset_id: '2', duration: 5 },
          { role: 'reference', type: 'video', asset_id: '3' },
        ],
      }),
    ).toEqual({ reference_count: '2', video: '1' });
    expect(
      videoSpecs({ references: [{ role: 'reference', type: 'video', asset_id: '2' }] }),
    ).not.toHaveProperty('video_input_seconds');
    expect(
      videoSpecs({
        references: [{ role: 'reference', type: 'image', asset_id: '2', duration: 5 }],
      }),
    ).not.toHaveProperty('video_input_seconds');
  });

  it('★ 创作内容不进规格 —— prompt / title 被排除', () => {
    const specs = videoSpecs({ prompt: '一只猫', title: '我的视频', size: '2k' });

    expect(specs).toEqual({ size: '2k', reference_count: '0', video: '0' });
    expect(specs).not.toHaveProperty('prompt');
    expect(specs).not.toHaveProperty('title');
  });

  it('大小写不敏感地排除内容字段', () => {
    expect(videoSpecs({ Prompt: 'x', PROMPT: 'y' })).toEqual({
      reference_count: '0',
      video: '0',
    });
  });

  it('★ 按内容长度之类计价应当由上游算成数字规格，而不是塞正文', () => {
    expect(videoSpecs({ prompt_length: 128 })).toEqual({
      prompt_length: '128',
      reference_count: '0',
      video: '0',
    });
  });
});

describe('extractSpecs —— 参考素材数**按媒介取不同的键**', () => {
  it('★ 图片：参考图落 input_asset_ids（不是 references）', () => {
    expect(
      extractSpecs(
        { model_id: 'doubao-seedream-5-0-pro-260628', input_asset_ids: ['1', '2', '3'] },
        'image',
      ),
    ).toMatchObject({ reference_count: '3' });

    expect(extractSpecs({ size: '2k' }, 'image')).toMatchObject({ reference_count: '0' });
  });

  it('★ 视频/音频只认 references —— input_asset_ids 在它们那儿不是参考列表', () => {
    expect(videoSpecs({ input_asset_ids: ['1', '2', '3'] })).toMatchObject({
      reference_count: '0',
    });
    expect(extractSpecs({ input_asset_ids: ['1', '2', '3'] }, 'audio')).toMatchObject({
      reference_count: '0',
    });

    expect(videoSpecs({ references: [{ type: 'image' }, { type: 'image' }] })).toMatchObject({
      reference_count: '2',
    });
  });

  it('★ 同一个 input 传不同媒介 → 不同的参考数（防止有人把媒介参数写死）', () => {
    const input = { input_asset_ids: ['1', '2'], references: [{ type: 'image' }] };
    expect(extractSpecs(input, 'image')).toMatchObject({ reference_count: '2' });
    expect(extractSpecs(input, 'video')).toMatchObject({ reference_count: '1' });
  });
});

describe('extractSpecs —— 凭证不进规格', () => {
  it('★ provider_credential 被排除，密钥不随请求离开本进程', () => {
    const specs = videoSpecs({
      size: '1080p',
      duration: 5,
      provider_credential: 'sk-should-never-leave-this-process',
    });

    expect(specs).not.toHaveProperty('provider_credential');
    expect(JSON.stringify(specs)).not.toContain('sk-should-never-leave');
    expect(specs).toMatchObject({ size: '1080p', duration: '5' });
  });
});
