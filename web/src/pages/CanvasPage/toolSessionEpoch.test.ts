import { canvasToolSessionFixture } from './testing/canvasToolSessionFixture';
/* IKI61O 会话纪元机制单测（toolSessionCoordinator.createToolSessionEpoch）：
   覆盖全部会话种类的进入/退出/项目切换推进与 capture/isCurrent 比对语义——
   迟到响应「只做任务收尾、不碰当前会话」的判定只活在这一个机制里，各家族不各自发明。
   IKI8KZ 审查修订：ALL_KINDS 自 coordinator 导出的 TOOL_SESSION_KINDS 派生，
   不再手抄全集副本（此前 audioMix 由 IKI68W 加入时手抄清单漏列过）——新增/遗漏
   种类时测试遍历自动跟随权威集合暴露缺口。 */
import { describe, expect, it } from 'vitest';
import {
  createToolSessionEpoch,
} from './toolSessionCoordinator';

const ALL_KINDS = canvasToolSessionFixture().tools.kinds;

describe('IKI61O createToolSessionEpoch', () => {
  it('初始纪元为 0，capture 不推进纪元', () => {
    const epoch = createToolSessionEpoch(ALL_KINDS);
    for (const kind of ALL_KINDS) {
      expect(epoch.capture(kind)).toBe(0);
      expect(epoch.isCurrent(kind, 0)).toBe(true);
    }
  });

  it('进入推进纪元：发送后退出再重进，旧捕获失效、新会话捕获有效', () => {
    const epoch = createToolSessionEpoch(ALL_KINDS);
    epoch.enter('audioTrim');
    const sentAt = epoch.capture('audioTrim');
    epoch.exit('audioTrim');
    expect(epoch.isCurrent('audioTrim', sentAt)).toBe(false);
    epoch.enter('audioTrim');
    expect(epoch.isCurrent('audioTrim', sentAt)).toBe(false);
    const resentAt = epoch.capture('audioTrim');
    expect(epoch.isCurrent('audioTrim', resentAt)).toBe(true);
  });

  it('同工具换卡重进不触发出，enter 推进仍区分前后两次会话身份', () => {
    const epoch = createToolSessionEpoch(ALL_KINDS);
    epoch.enter('erase');
    const firstSend = epoch.capture('erase');
    epoch.enter('erase');
    expect(epoch.isCurrent('erase', firstSend)).toBe(false);
    expect(epoch.isCurrent('erase', epoch.capture('erase'))).toBe(true);
  });

  it('退出推进纪元：发送在途退出（未重进），迟到响应失效', () => {
    const epoch = createToolSessionEpoch(ALL_KINDS);
    epoch.enter('audioSpeed');
    const sentAt = epoch.capture('audioSpeed');
    epoch.exit('audioSpeed');
    expect(epoch.isCurrent('audioSpeed', sentAt)).toBe(false);
  });

  it('音频混合（IKI8L8）：进入/退出/重开均推进纪元，旧捕获在重开后失效、新捕获有效', () => {
    const epoch = createToolSessionEpoch(ALL_KINDS);
    epoch.enter('audioMix');
    const sentAt = epoch.capture('audioMix');
    expect(epoch.isCurrent('audioMix', sentAt)).toBe(true);
    epoch.exit('audioMix'); // 发送在途 Esc 退出——此前唯一不推进纪元的退出函数
    expect(epoch.isCurrent('audioMix', sentAt)).toBe(false);
    epoch.enter('audioMix'); // 重开新会话（进入亦推进）
    expect(epoch.isCurrent('audioMix', sentAt)).toBe(false);
    const resentAt = epoch.capture('audioMix');
    expect(epoch.isCurrent('audioMix', resentAt)).toBe(true);
  });

  it('项目切换 advanceAll：全部会话种类的旧捕获一并失效', () => {
    const epoch = createToolSessionEpoch(ALL_KINDS);
    const captured = ALL_KINDS.map((kind) => {
      epoch.enter(kind);
      return epoch.capture(kind);
    });
    epoch.advanceAll();
    ALL_KINDS.forEach((kind, i) => {
      expect(epoch.isCurrent(kind, captured[i]!)).toBe(false);
    });
  });

  it('各种类纪元互相隔离：推进一种不影响其余种类的判定', () => {
    const epoch = createToolSessionEpoch(ALL_KINDS);
    epoch.enter('audioTrim');
    const trimSentAt = epoch.capture('audioTrim');
    epoch.enter('vocalSplit');
    epoch.exit('vocalSplit');
    expect(epoch.isCurrent('audioTrim', trimSentAt)).toBe(true);
    expect(epoch.isCurrent('vocalSplit', epoch.capture('vocalSplit'))).toBe(true);
  });

  it('全种类进出循环后捕获与判定一致（无种类串扰）', () => {
    const epoch = createToolSessionEpoch(ALL_KINDS);
    for (const kind of ALL_KINDS) {
      epoch.enter(kind);
      const sentAt = epoch.capture(kind);
      expect(epoch.isCurrent(kind, sentAt)).toBe(true);
      epoch.exit(kind);
      expect(epoch.isCurrent(kind, sentAt)).toBe(false);
    }
  });
});
