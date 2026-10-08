import { describe, expect, it } from 'vitest';

import { extractSpecs } from './billing-specs.js';

/**
 * 本文件里绝大多数断言是**视频**口径（参考素材落 `references` 单数组）。
 * 包一层省得每一处都写媒介 —— 但**不要**再把新增的图片断言也塞进这里：
 * 「取哪个键按媒介」正是这次改动要钉住的东西，写成默认值就把那件事藏起来了。
 */
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
    // catalog 用 `usage.referenceCount` 配加价倍率，而 `references` 是数组、进不了规格：
    // 没有这个标量键，预扣冻的钱里就不含加价那部分。
    expect(videoSpecs({ references: [{ url: 'a' }, { url: 'b' }] })).toEqual({
      reference_count: '2',
      video: '0',
    });
    // 不带 references = 0 个参考素材，写成 0 而不是缺键：这个维度在提交时刻**总是**已知的
    expect(videoSpecs({ size: '2k' })).toEqual({
      size: '2k',
      reference_count: '0',
      video: '0',
    });
  });

  it('★ 是否含视频输入按 references 的元素类型折算 —— 决定视频 token 的单价档', () => {
    // 火山按 token 计的视频**单价分两档**（无视频输入 / 含视频输入），而「有没有视频参考」
    // 是数组里的元素类型、同样进不了规格。与 reference_count 同一处、同一套理由折算成标量键。
    expect(
      videoSpecs({
        references: [
          { role: 'reference', type: 'image', asset_id: '1' },
          { role: 'reference', type: 'video', asset_id: '2' },
        ],
      }),
    ).toEqual({ reference_count: '2', video: '1' });

    // 只有图片参考 → false（首尾帧也是图片，不算视频输入）
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
    // 旧分字段路径的参考素材（reference_asset_ids / reference_materials）都不进这套口径。
    // 两边口径必须一致 —— 一侧多认一个数组，就会出现「预扣按含视频输入计价、结算按不含收」。
    const specs = videoSpecs({
      reference_asset_ids: ['21', '22'],
      reference_materials: [{ type: 'video' }],
    });

    expect(specs).toEqual({ reference_count: '0', video: '0' });
    expect(specs).not.toHaveProperty('reference_asset_ids');
    expect(specs).not.toHaveProperty('reference_materials');
  });

  it('★ 输入视频时长折算成标量键 —— 官方公式含视频输入时要把输入时长算进 token', () => {
    // 火山官方：含视频输入时 tokens ≈ (输入时长 + 输出时长) × 宽 × 高 × 帧率 ÷ 1024。
    // 时长是 references **元素上**的标量、数组本身进不了规格，所以在这里与上面两个键同一处折算。
    expect(
      videoSpecs({
        references: [{ role: 'reference', type: 'video', asset_id: '2', duration: 5 }],
      }),
    ).toEqual({
      reference_count: '1',
      video: '1',
      video_input_seconds: '5',
    });

    // 多条视频参考 → 求和
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
    // 键缺失 + video=1 时 billing 的估算器判为「含视频输入却量不到输入时长」
    // → 取不到 → 拒绝提交。按 0 估就是明知故犯地少冻（差额平台垫付、账面无信号）。
    expect(
      videoSpecs({
        references: [
          { role: 'reference', type: 'video', asset_id: '2', duration: 5 },
          { role: 'reference', type: 'video', asset_id: '3' }, // 这条没带时长
        ],
      }),
    ).toEqual({ reference_count: '2', video: '1' });
    expect(
      videoSpecs({ references: [{ role: 'reference', type: 'video', asset_id: '2' }] }),
    ).not.toHaveProperty('video_input_seconds');
    // 图片参考不是视频输入 —— 那一项本来就不加，连键都不出现
    expect(
      videoSpecs({
        references: [{ role: 'reference', type: 'image', asset_id: '2', duration: 5 }],
      }),
    ).not.toHaveProperty('video_input_seconds');
  });

  it('★ 创作内容不进规格 —— prompt / title 被排除', () => {
    // 「取所有标量」会把 prompt 也收进来（它是字符串）。后果不是显示问题：
    // 价格预览不必带创作内容，于是预览的规格集合会比预扣少一个键；
    // 今天没有规则按提示词定价所以看不出来，哪天有人配了，**预览价与实扣价就对不上**。
    const specs = videoSpecs({ prompt: '一只猫', title: '我的视频', size: '2k' });

    expect(specs).toEqual({ size: '2k', reference_count: '0', video: '0' });
    expect(specs).not.toHaveProperty('prompt');
    expect(specs).not.toHaveProperty('title');
  });

  it('大小写不敏感地排除内容字段', () => {
    // 规格键统一小写，排除判定也必须先归一 —— 否则 `Prompt` 会漏网
    expect(videoSpecs({ Prompt: 'x', PROMPT: 'y' })).toEqual({
      reference_count: '0',
      video: '0',
    });
  });

  it('★ 按内容长度之类计价应当由上游算成数字规格，而不是塞正文', () => {
    // 这条钉的是「以后有人想按提示词长度定价时该怎么办」的答案：
    // 传 `prompt_length: 128`，不要传 `prompt: '...'`。
    expect(videoSpecs({ prompt_length: 128 })).toEqual({
      prompt_length: '128',
      reference_count: '0',
      video: '0',
    });
  });
});

describe('extractSpecs —— 参考素材数**按媒介取不同的键**', () => {
  it('★ 图片：参考图落 input_asset_ids（不是 references）', () => {
    // 建任务时 imageStrategy.composeInput 把合并去重后的参考图落 input.input_asset_ids，
    // 图片路径**从不写** input.references。改造前 reference_count 只数 references，
    // 所以**所有图片单的参考数一直是 0** —— 不是「没有参考」，是取错了键。
    // 而 Seedream 5.0 Pro 的参考图按张收费（首张免费、第 2 张起 0.02 元），
    // 那个 0 会让加价永远不生效：一次 10 张参考图的单子少收 0.18 元。
    expect(
      extractSpecs(
        { model_id: 'doubao-seedream-5-0-pro-260628', input_asset_ids: ['1', '2', '3'] },
        'image',
      ),
    ).toMatchObject({ reference_count: '3' });

    // 没有参考图的图片单 → 0（键都不存在）
    expect(extractSpecs({ size: '2k' }, 'image')).toMatchObject({ reference_count: '0' });
  });

  it('★ 视频/音频只认 references —— input_asset_ids 在它们那儿不是参考列表', () => {
    // 视频/音频的旧分字段路径（reference_asset_ids / reference_materials / 首尾帧）
    // 从来不计入。这里放开的话，老客户端的单子会突然被算上参考费。
    // ⚠️ 图片则是**只有**这一个键、不存在「新老两条路」，所以只改图片。
    expect(videoSpecs({ input_asset_ids: ['1', '2', '3'] })).toMatchObject({
      reference_count: '0',
    });
    expect(extractSpecs({ input_asset_ids: ['1', '2', '3'] }, 'audio')).toMatchObject({
      reference_count: '0',
    });

    // 视频照旧认 references
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
