import { describe, expect, it } from 'vitest';

import { extractSpecs } from './billing-specs.js';

describe('extractSpecs', () => {
  it('只取标量，键统一小写', () => {
    expect(
      extractSpecs({ Size: '2K', Duration: 5, Flag: true, refs: [{ url: 'x' }], none: null }),
    ).toEqual({
      size: '2k',
      duration: '5',
      flag: 'true',
      reference_count: '0',
      has_video_input: 'false',
    });
  });

  it('★ 参考素材数按数组长度进规格 —— 数组本身不进，只取长度', () => {
    // catalog 用 `usage.referenceCount` 配加价倍率，而 `references` 是数组、进不了规格：
    // 没有这个标量键，预扣冻的钱里就不含加价那部分。
    expect(extractSpecs({ references: [{ url: 'a' }, { url: 'b' }] })).toEqual({
      reference_count: '2',
      has_video_input: 'false',
    });
    // 不带 references = 0 个参考素材，写成 0 而不是缺键：这个维度在提交时刻**总是**已知的
    expect(extractSpecs({ size: '2k' })).toEqual({
      size: '2k',
      reference_count: '0',
      has_video_input: 'false',
    });
  });

  it('★ 是否含视频输入按 references 的元素类型折算 —— 决定视频 token 的单价档', () => {
    // 火山按 token 计的视频**单价分两档**（无视频输入 / 含视频输入），而「有没有视频参考」
    // 是数组里的元素类型、同样进不了规格。与 reference_count 同一处、同一套理由折算成标量键。
    expect(
      extractSpecs({
        references: [
          { role: 'reference', type: 'image', asset_id: '1' },
          { role: 'reference', type: 'video', asset_id: '2' },
        ],
      }),
    ).toEqual({ reference_count: '2', has_video_input: 'true' });

    // 只有图片参考 → false（首尾帧也是图片，不算视频输入）
    expect(
      extractSpecs({
        references: [
          { role: 'first_frame', type: 'image' },
          { role: 'last_frame', type: 'image' },
        ],
      }),
    ).toEqual({ reference_count: '2', has_video_input: 'false' });
  });

  it('★ has_video_input 的口径与 reference_count 逐条相同：只认 references 这一个数组', () => {
    // 旧分字段路径的参考素材（reference_asset_ids / reference_materials）都不进这套口径。
    // 两边口径必须一致 —— 一侧多认一个数组，就会出现「预扣按含视频输入计价、结算按不含收」。
    const specs = extractSpecs({
      reference_asset_ids: ['21', '22'],
      reference_materials: [{ type: 'video' }],
    });

    expect(specs).toEqual({ reference_count: '0', has_video_input: 'false' });
    expect(specs).not.toHaveProperty('reference_asset_ids');
    expect(specs).not.toHaveProperty('reference_materials');
  });

  it('★ 创作内容不进规格 —— prompt / title 被排除', () => {
    // 「取所有标量」会把 prompt 也收进来（它是字符串）。后果不是显示问题：
    // 价格预览不必带创作内容，于是预览的规格集合会比预扣少一个键；
    // 今天没有规则按提示词定价所以看不出来，哪天有人配了，**预览价与实扣价就对不上**。
    const specs = extractSpecs({ prompt: '一只猫', title: '我的视频', size: '2k' });

    expect(specs).toEqual({ size: '2k', reference_count: '0', has_video_input: 'false' });
    expect(specs).not.toHaveProperty('prompt');
    expect(specs).not.toHaveProperty('title');
  });

  it('大小写不敏感地排除内容字段', () => {
    // 规格键统一小写，排除判定也必须先归一 —— 否则 `Prompt` 会漏网
    expect(extractSpecs({ Prompt: 'x', PROMPT: 'y' })).toEqual({
      reference_count: '0',
      has_video_input: 'false',
    });
  });

  it('★ 按内容长度之类计价应当由上游算成数字规格，而不是塞正文', () => {
    // 这条钉的是「以后有人想按提示词长度定价时该怎么办」的答案：
    // 传 `prompt_length: 128`，不要传 `prompt: '...'`。
    expect(extractSpecs({ prompt_length: 128 })).toEqual({
      prompt_length: '128',
      reference_count: '0',
      has_video_input: 'false',
    });
  });
});

describe('extractSpecs —— 不该出现在定价那侧的字段', () => {
  it('★ 凭证绝不进规格 —— 它是密钥，会跟着请求离开本进程', () => {
    // 建任务时把上游 key 明文写进 job.input.provider_credential。
    // 它是字符串，于是被「取所有标量」一并收进 specs → 跟着 Hold/Quote 的请求
    // 离开本进程、落进 billing 的 MQ 日志与计费记录。
    // **实测撞到过**：billing 的 MQ 日志里能读到明文 key。
    const specs = extractSpecs({
      size: '1080p',
      duration: 5,
      provider_credential: 'sk-should-never-leave-this-process',
    });

    expect(specs).not.toHaveProperty('provider_credential');
    // ⚠️ 断言「整串里没有它」，而不是「只有那两个键」——
    //    后者会因为**别人合理地加了派生规格**而误报（本文件另有两处派生键），
    //    而这条测试要守的只有一件事：凭证不离开本进程。
    expect(JSON.stringify(specs)).not.toContain('sk-should-never-leave');
    expect(specs).toMatchObject({ size: '1080p', duration: '5' });
  });
});
