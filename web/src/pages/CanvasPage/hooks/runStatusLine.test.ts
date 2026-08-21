/**
 * 这条状态行的存在理由是「屏幕上什么都没有」的那几十秒，所以这些用例里最重要的一类是
 * **它什么时候不许消失**。IKA4PG 之后又多了一条：回答结束也不许消失，要留下来报账。
 */
import { describe, expect, it } from 'vitest';
import {
  deriveRunStatus,
  estimateOutputTokens,
  formatElapsed,
  formatTokens,
  parseRunContextCapacity,
  parseRunTokenUsage,
} from './runStatusLine';

const base = {
  activeSince: 1_000_000,
  now: 1_000_000,
  activity: null,
  stalled: false,
  hasRunId: true,
  outcome: null,
  finishedAt: null,
  streamedText: '',
  tokenUsage: null,
  contextCapacity: null,
} as const;

describe('deriveRunStatus', () => {
  it('从来没跑过时不显示', () => {
    expect(deriveRunStatus({ ...base, activeSince: null })).toBeNull();
  });

  it('模型还没吐出任何东西时也要显示，这是它存在的全部意义', () => {
    expect(deriveRunStatus(base)).toMatchObject({ phase: 'working', label: '正在思考', seconds: 0, tone: 'working' });
  });

  it('还没拿到 runId 时也不许空着——请求在途，表已经在走了', () => {
    expect(deriveRunStatus({ ...base, hasRunId: false, now: 1_003_000 })).toMatchObject({
      phase: 'dispatching',
      label: '正在提交',
      seconds: 3,
    });
  });

  it('秒数按经过的时间走', () => {
    expect(deriveRunStatus({ ...base, now: 1_014_600 })?.seconds).toBe(14);
  });

  it('有可见节点后换成节点描述', () => {
    expect(deriveRunStatus({ ...base, now: 1_014_000, activity: '正在编排分镜与提示词' })).toMatchObject({
      label: '正在编排分镜与提示词',
      seconds: 14,
      tone: 'working',
    });
  });

  it('长时间无进展只换语气，绝不隐藏——此时最需要它', () => {
    expect(
      deriveRunStatus({ ...base, now: 1_090_000, activity: '正在逐个分镜生成画面描述', stalled: true }),
    ).toMatchObject({ phase: 'stalled', tone: 'stalled', seconds: 90 });
  });

  it('起点来自服务端时间、浏览器时钟偏慢时，计时器不会倒着走', () => {
    expect(deriveRunStatus({ ...base, now: 999_000 })?.seconds).toBe(0);
  });

  describe('终态', () => {
    it('回答结束后留在屏幕上报账，而不是消失', () => {
      expect(
        deriveRunStatus({ ...base, outcome: 'completed', finishedAt: 1_051_000, now: 1_051_000 }),
      ).toMatchObject({ phase: 'completed', label: '已完成', seconds: 51, tone: 'done', settled: true });
    });

    it('终态后秒数冻结，不跟着当前时间继续走', () => {
      const later = deriveRunStatus({ ...base, outcome: 'completed', finishedAt: 1_051_000, now: 1_400_000 });
      expect(later?.seconds).toBe(51);
    });

    it('取消和失败分别有自己的语气', () => {
      expect(deriveRunStatus({ ...base, outcome: 'cancelled', finishedAt: 1_009_000 })).toMatchObject({
        phase: 'cancelled',
        label: '已取消',
        tone: 'done',
      });
      expect(deriveRunStatus({ ...base, outcome: 'failed', finishedAt: 1_009_000 })).toMatchObject({
        phase: 'failed',
        label: '未能完成',
        tone: 'error',
      });
    });

    it('刷新后拿不到 finishedAt 也不会读秒——已结束的东西继续跳数看起来像还在跑', () => {
      const status = deriveRunStatus({ ...base, outcome: 'completed', finishedAt: null, now: 1_030_000 });
      expect(status?.settled).toBe(true);
      expect(status?.seconds).toBe(30);
    });
  });

  describe('token', () => {
    it('流式期间按已收到的正文估算，并标明是估的', () => {
      // 走的必须是与生产同一条路径：正文原样传进来，按 CJK 规则数，而不是先塌成一个长度。
      expect(deriveRunStatus({ ...base, streamedText: '海边小镇的温暖黄昏' })?.tokens).toEqual({
        output: 9,
        estimated: true,
      });
    });

    it('一个字都还没收到时不显示 token 那一段', () => {
      expect(deriveRunStatus(base)?.tokens).toBeNull();
    });

    it('真实用量一到就盖掉估算值', () => {
      const status = deriveRunStatus({
        ...base,
        outcome: 'completed',
        finishedAt: 1_051_000,
        streamedText: '已经吐出了很多正文'.repeat(100),
        tokenUsage: { input_tokens: 30_000, cached_input_tokens: 28_500, output_tokens: 412, reasoning_tokens: null },
      });
      expect(status?.tokens).toEqual({ output: 412, estimated: false });
    });
  });

  describe('上下文占用', () => {
    it('没报时为 null，UI 据此不渲染那一段', () => {
      expect(deriveRunStatus(base)?.context).toBeNull();
    });

    it('报了就带出占用与压缩状态', () => {
      expect(
        deriveRunStatus({
          ...base,
          contextCapacity: {
            used_input_tokens: 30_000,
            configured_max_tokens: 120_000,
            ratio: 0.25,
            compaction_state: 'compacted',
          },
        })?.context,
      ).toEqual({ usedTokens: 30_000, maxTokens: 120_000, ratio: 0.25, compacted: true });
    });

    it('服务端给的比例越界时夹回 [0,1]，不让进度条画出框', () => {
      const ctx = deriveRunStatus({
        ...base,
        contextCapacity: {
          used_input_tokens: 1,
          configured_max_tokens: 1,
          ratio: 1.4,
          compaction_state: 'none',
        },
      })?.context;
      expect(ctx?.ratio).toBe(1);
    });
  });
});

describe('estimateOutputTokens', () => {
  it('中文长文不会被系统性低估——这里曾经按长度折半算，对中文偏小一倍', () => {
    const text = '海边小镇的温暖黄昏'.repeat(50);
    expect(estimateOutputTokens(text)).toBe(450);
    expect(estimateOutputTokens(text)).toBeGreaterThan(Math.round(text.length / 2));
  });

  it('中文按一字一 token', () => {
    expect(estimateOutputTokens('海边小镇的温暖黄昏')).toBe(9);
  });

  it('英文按四字符一 token', () => {
    expect(estimateOutputTokens('abcdefgh')).toBe(2);
  });

  it('中英混排各算各的', () => {
    expect(estimateOutputTokens('海边abcd')).toBe(3);
  });

  it('空串是 0', () => {
    expect(estimateOutputTokens('')).toBe(0);
  });
});

describe('formatElapsed', () => {
  it('一分钟以内只报秒', () => {
    expect(formatElapsed(51)).toBe('51s');
  });

  it('超过一分钟报分秒', () => {
    expect(formatElapsed(176)).toBe('2m 56s');
  });

  it('整分钟不拖一个 0s 的尾巴', () => {
    expect(formatElapsed(120)).toBe('2m');
  });
});

describe('formatTokens', () => {
  it('千位以下原样显示——数字要能一眼看出在变', () => {
    expect(formatTokens(412)).toBe('412');
  });

  it('上千后缩写', () => {
    expect(formatTokens(5_700)).toBe('5.7k');
    expect(formatTokens(28_500)).toBe('29k');
  });
});

/**
 * 这两个 parser 守的是「坏值不许上屏」。契约在 agent 仓，本仓编译期什么都验不到，
 * 所以下面这些用例列的就是裸 `as` 会放过、而用户会看见的那几种脏数据。
 */
describe('parseRunTokenUsage', () => {
  it('形状完整时原样带出，cached 与 reasoning 的 null 保持为 null', () => {
    expect(
      parseRunTokenUsage({
        input_tokens: 30_000,
        cached_input_tokens: null,
        output_tokens: 412,
        reasoning_tokens: null,
      }),
    ).toEqual({
      input_tokens: 30_000,
      cached_input_tokens: null,
      output_tokens: 412,
      reasoning_tokens: null,
    });
  });

  it('主体字段缺失时整段当没报——否则 formatTokens(undefined) 会渲染成 "NaNk"', () => {
    expect(parseRunTokenUsage({ input_tokens: 30_000 })).toBeNull();
    expect(parseRunTokenUsage({ output_tokens: '412' })).toBeNull();
  });

  it('cached 是脏值时落到 null，绝不兜成 0——0 和「没上报」会让 KV cache 诊断得出相反结论', () => {
    expect(parseRunTokenUsage({ input_tokens: 1, output_tokens: 1, cached_input_tokens: 'x' })).toMatchObject({
      cached_input_tokens: null,
    });
    expect(parseRunTokenUsage({ input_tokens: 1, output_tokens: 1, cached_input_tokens: NaN })).toMatchObject({
      cached_input_tokens: null,
    });
  });

  it('不是对象就是没报', () => {
    expect(parseRunTokenUsage(null)).toBeNull();
    expect(parseRunTokenUsage('30000')).toBeNull();
    expect(parseRunTokenUsage(undefined)).toBeNull();
  });
});

describe('parseRunContextCapacity', () => {
  it('形状完整时带出，未知的 compaction_state 按没压缩过处理', () => {
    expect(
      parseRunContextCapacity({
        used_input_tokens: 30_000,
        configured_max_tokens: 120_000,
        ratio: 0.25,
        compaction_state: 'something-new',
      }),
    ).toEqual({
      used_input_tokens: 30_000,
      configured_max_tokens: 120_000,
      ratio: 0.25,
      compaction_state: 'none',
    });
  });

  it('字段缺失或非数时当没报——否则会渲染出「上下文 NaN%」', () => {
    expect(parseRunContextCapacity({ used_input_tokens: 1, configured_max_tokens: 2 })).toBeNull();
    expect(parseRunContextCapacity({ used_input_tokens: 1, configured_max_tokens: 2, ratio: 'x' })).toBeNull();
  });

  it('上限为 0 时当没报，占用条没有有意义的分母', () => {
    expect(parseRunContextCapacity({ used_input_tokens: 0, configured_max_tokens: 0, ratio: 0 })).toBeNull();
  });

  it('坏值不会绕过 deriveRunStatus 的夹取变成 NaN%', () => {
    const status = deriveRunStatus({ ...base, contextCapacity: parseRunContextCapacity({ ratio: 'x' }) });
    expect(status?.context).toBeNull();
  });
});
