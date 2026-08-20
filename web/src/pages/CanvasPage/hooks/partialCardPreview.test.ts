import { describe, expect, it } from 'vitest';
import { toPartialCardPreview } from './partialCardPreview';

describe('toPartialCardPreview', () => {
  it('只有 overview 时也能上屏——那是最先写出来的部分', () => {
    expect(toPartialCardPreview('card-1', { overview: '夏日海边小镇' })).toEqual({
      cardId: 'card-1',
      overview: '夏日海边小镇',
      shots: [],
    });
  });

  it('分镜逐个填内容，提示词会越来越长', () => {
    expect(
      toPartialCardPreview('card-1', {
        overview: '夏日海边小镇',
        shots: [{ shot_no: 1, title: '全景', prompt_text: 'A warm and bright' }],
      }),
    ).toEqual({
      cardId: 'card-1',
      overview: '夏日海边小镇',
      shots: [{ title: '全景', promptText: 'A warm and bright' }],
    });
  });

  it('空的分镜占位不上屏，否则会先闪一排空框', () => {
    const preview = toPartialCardPreview('card-1', { overview: '夏日', shots: [{}, { title: '全景' }] });
    expect(preview?.shots).toEqual([{ title: '全景', promptText: '' }]);
  });

  it('什么都还没写出来时不显示', () => {
    expect(toPartialCardPreview('card-1', {})).toBeNull();
    expect(toPartialCardPreview('card-1', { overview: '', shots: [] })).toBeNull();
  });

  // 下面几条是这个函数存在的理由：数据未经校验，任何形状都不许把事件处理掀翻。
  it.each([
    ['null', null],
    ['字符串', '还没写完'],
    ['数字', 42],
    ['数组', [1, 2, 3]],
  ])('不是对象时安静地返回 null（%s）', (_label, payload) => {
    expect(() => toPartialCardPreview('card-1', payload)).not.toThrow();
    expect(toPartialCardPreview('card-1', payload)).toBeNull();
  });

  it('字段类型不对时当作没写，而不是抛出来', () => {
    expect(() =>
      toPartialCardPreview('card-1', { overview: { nested: true }, shots: 'not-an-array' }),
    ).not.toThrow();
    expect(toPartialCardPreview('card-1', { overview: { nested: true }, shots: 'not-an-array' })).toBeNull();
  });

  it('分镜里混进 null 也不会炸', () => {
    expect(toPartialCardPreview('card-1', { shots: [null, { title: '全景' }, 7] })).toEqual({
      cardId: 'card-1',
      overview: '',
      shots: [{ title: '全景', promptText: '' }],
    });
  });
});
