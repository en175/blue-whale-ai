/* `features` 结构化字段表的取值整理 —— 纯函数，所以能单测。
 *
 * 这里钉的是**新的输出像素表（`features.video_dimensions`）与高级 JSON 的边界**：
 * 它归结构化控件管，就不该同时在「高级 JSON」里留一份 —— 否则运营把表清空之后，
 * 高级 JSON 里那份旧值会在保存时又写回去（「我删了」变成没删）。
 */
import { describe, expect, it } from 'vitest';
import { buildVideoDimensions, dropKnownFeatures, pickVideoDimensions } from './feature-fields';

describe('输出像素表 video_dimensions', () => {
  it('读回：认 snake_case 与 camelCase 两种写法', () => {
    expect(pickVideoDimensions({ video_dimensions: { 'resolution=480p|aspect_ratio=16:9': '864x496' } })).toEqual([
      { key: 'resolution=480p|aspect_ratio=16:9', value: '864x496' },
    ]);
    expect(pickVideoDimensions({ videoDimensions: { 'a=1|b=2': '10x20' } })).toEqual([
      { key: 'a=1|b=2', value: '10x20' },
    ]);
  });

  it('读回：不是对象（数组 / 字符串）时当没有，不猜', () => {
    expect(pickVideoDimensions({ video_dimensions: ['x'] })).toEqual([]);
    expect(pickVideoDimensions({ video_dimensions: 'oops' })).toEqual([]);
    expect(pickVideoDimensions({})).toEqual([]);
  });

  it('写回：空键 / 空值的行丢掉；一行都没有时整个不写这个键', () => {
    expect(
      buildVideoDimensions([
        { key: 'resolution=480p|aspect_ratio=16:9', value: '864x496' },
        { key: '', value: '' },
        { key: 'resolution=720p|aspect_ratio=16:9', value: ' ' },
      ]),
    ).toEqual({ 'resolution=480p|aspect_ratio=16:9': '864x496' });
    expect(buildVideoDimensions([])).toBeUndefined();
  });
});

describe('高级 JSON 与结构化控件的边界', () => {
  it('★ 归结构化控件管的键不进高级 JSON（对象键与标量键都是）', () => {
    const extra = dropKnownFeatures({
      video_dimensions: { 'resolution=480p|aspect_ratio=16:9': '864x496' },
      videoDimensions: { 'resolution=480p|aspect_ratio=16:9': '864x496' },
      task_types: { first_frame: { allowed_ratios: ['16:9'] } },
      reference_image: true,
      quantity_max: 1,
    });
    expect(extra).toEqual({});
  });

  it('★ 类型不符的脏值留在高级 JSON 里原样回写（静默删掉比让人看到它更危险）', () => {
    const extra = dropKnownFeatures({
      // 数组不是这张表该有的形态 —— 结构化控件表达不了它，原样留着（写侧闸门会给出可读报错）
      video_dimensions: ['oops'],
      task_types: 'oops',
      tools: 'yes',
      something_unknown: 42,
    });
    expect(extra).toEqual({
      video_dimensions: ['oops'],
      task_types: 'oops',
      tools: 'yes',
      something_unknown: 42,
    });
  });
});
