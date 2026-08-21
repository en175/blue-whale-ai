/**
 * IKA4PH。取消回答的入口统一到发送侧后，ESC 成了那颗按钮的键盘等价物。这几条锁住它在
 * 什么情况下接管、什么情况下让路——尤其是让路的那几条，误伤一次就是用户正在编辑生成卡
 * 时整轮回答被取消。
 */
import { describe, expect, it } from 'vitest';
import { shouldCancelOnKey } from './cancelShortcut';

describe('shouldCancelOnKey', () => {
  it('ESC 取消本次回答', () => {
    expect(shouldCancelOnKey({ key: 'Escape', defaultPrevented: false, targetTagName: 'DIV' })).toBe(true);
  });

  it('焦点在主输入框时也要能取消——那是发送后焦点最常待的地方', () => {
    // Lexical 的 contentEditable 是 div，不是 input。
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

  it('拿不到目标标签时按可取消处理，而不是静默失效', () => {
    // 宁可多取消一次（用户还能重发），也不要让快捷键在某些浏览器上莫名其妙不工作。
    expect(shouldCancelOnKey({ key: 'Escape', defaultPrevented: false, targetTagName: undefined })).toBe(true);
  });
});
