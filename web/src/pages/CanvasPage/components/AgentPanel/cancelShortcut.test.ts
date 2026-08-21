/**
 * IKA4PH。取消回答的入口统一到发送侧后，ESC 成了那颗按钮的键盘等价物。这几条锁住它在
 * 什么情况下接管、什么情况下让路——尤其是让路的那几条，误伤一次就是用户正在编辑生成卡
 * 时整轮回答被取消。
 */
import { describe, expect, it } from 'vitest';
import { shouldCancelOnKey } from './cancelShortcut';

describe('shouldCancelOnKey', () => {
  it('ESC 取消本次回答，焦点在主输入框里也算', () => {
    // 主输入框是 Lexical 的 contentEditable，标签是 div 而不是 input——所以它既不在
    // 下面那条让路名单里，也正是发送后焦点最常待的地方，这一条同时锁住这两件事。
    expect(shouldCancelOnKey({ key: 'Escape', defaultPrevented: false, targetTagName: 'DIV' })).toBe(true);
  });

  it('别的键一概不管', () => {
    for (const key of ['Enter', 'Esc', 'escape', 'Backspace', ' ']) {
      expect(shouldCancelOnKey({ key, defaultPrevented: false, targetTagName: 'DIV' })).toBe(false);
    }
  });

  it('生成卡行内编辑的 ESC 是取消编辑，不能顺手把整轮回答取消掉', () => {
    expect(shouldCancelOnKey({ key: 'Escape', defaultPrevented: false, targetTagName: 'INPUT' })).toBe(false);
    expect(shouldCancelOnKey({ key: 'Escape', defaultPrevented: false, targetTagName: 'TEXTAREA' })).toBe(false);
  });

  it('下拉选择里的 ESC 归下拉', () => {
    expect(shouldCancelOnKey({ key: 'Escape', defaultPrevented: false, targetTagName: 'SELECT' })).toBe(false);
  });

  it('更靠近事件源的处理器已经消费过就让路', () => {
    expect(shouldCancelOnKey({ key: 'Escape', defaultPrevented: true, targetTagName: 'DIV' })).toBe(false);
  });

  it('拿不到目标标签时让路，而不是接管', () => {
    // 默认值翻过来了（IKACCL）：监听挂在 document 上，能收到页面任何地方的 ESC，而这条
    // 快捷键的破坏力不对称——少取消一次用户再按一下就是了，多取消一次是一整轮回答没了。
    expect(shouldCancelOnKey({ key: 'Escape', defaultPrevented: false, targetTagName: undefined })).toBe(false);
  });

  it('弹层里的 ESC 归弹层，不顺手停掉背后的回答', () => {
    expect(
      shouldCancelOnKey({ key: 'Escape', defaultPrevented: false, targetTagName: 'DIV', inOverlay: true }),
    ).toBe(false);
    // 即使目标就是主输入框，只要它在弹层里，也归弹层。
    expect(
      shouldCancelOnKey({
        key: 'Escape',
        defaultPrevented: false,
        targetTagName: 'DIV',
        inOverlay: true,
        isMainComposer: true,
      }),
    ).toBe(false);
  });

  it('别处的 contentEditable 让路，主输入框不让', () => {
    expect(
      shouldCancelOnKey({ key: 'Escape', defaultPrevented: false, targetTagName: 'DIV', isEditable: true }),
    ).toBe(false);
    expect(
      shouldCancelOnKey({
        key: 'Escape',
        defaultPrevented: false,
        targetTagName: 'DIV',
        isEditable: true,
        isMainComposer: true,
      }),
    ).toBe(true);
  });
});
