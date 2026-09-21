// @vitest-environment jsdom
/**
 * 工具行 / 思考块 / 轮尾账的渲染回归（IKDK5K / IKDK5L）。
 *
 * 用户看到的 bug 是「正在读取图片」一直卡着、点不了、读完也不变。这里把三种状态各画一遍，
 * 断言文案随状态换、耗时出现、子步骤能展开。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LastTurnLine, ProcessGroup, ThinkingBlock, ToolCallRow, TurnFooter } from './TurnTimeline';
import type { ProcessItem, TimelineItem, TurnAccount } from '../../hooks/sessionTimeline';

let root: Root;
let mountNode: HTMLDivElement;

async function render(element: ReturnType<typeof createElement>) {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(element);
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  mountNode?.remove();
  vi.useRealTimers();
});

type ToolItem = Extract<TimelineItem, { kind: 'tool' }>;

const readImage = (over: Partial<ToolItem> = {}): ToolItem => ({
  kind: 'tool',
  tool: 'read_asset',
  summary: '正在读取图片',
  status: 'completed',
  startedAt: null,
  elapsedMs: 8460,
  calls: 1,
  substeps: [
    { summary: '正在打开素材文件', status: 'completed', elapsedMs: 242 },
    { summary: '正在读取_smoke.jpg（图片 400×400）', status: 'completed', elapsedMs: 8170 },
  ],
  ...over,
});

describe('ToolCallRow', () => {
  it('运行中：进行时文案、转圈、子步骤默认展开且最后一条还在跑', async () => {
    await render(
      createElement(ToolCallRow, {
        item: readImage({
          status: 'running',
          startedAt: Date.now() - 3500,
          elapsedMs: null,
          substeps: [
            { summary: '正在打开素材文件', status: 'completed', elapsedMs: 242 },
            { summary: '正在读取_smoke.jpg（图片 400×400）', status: 'running', elapsedMs: null },
          ],
        }),
      }),
    );
    const head = mountNode.querySelector('button')!;
    expect(head.textContent).toContain('正在读取图片');
    expect(head.textContent).toMatch(/\d+s/);
    expect(head.getAttribute('aria-expanded')).toBe('true');
    expect(mountNode.textContent).toContain('已打开素材文件');
    expect(mountNode.textContent).toContain('0.2s');
    expect(mountNode.textContent).toContain('正在读取_smoke.jpg（图片 400×400）');
  });

  it('完成：翻成过去式带耗时，子步骤默认收起，点一下展开', async () => {
    await render(createElement(ToolCallRow, { item: readImage() }));
    const head = mountNode.querySelector('button')!;
    expect(head.textContent).toContain('已读取图片');
    expect(head.textContent).toContain('8.5s');
    expect(head.textContent).not.toContain('正在');
    expect(head.getAttribute('aria-expanded')).toBe('false');
    expect(mountNode.textContent).not.toContain('已打开素材文件');
    await act(async () => {
      head.click();
    });
    expect(head.getAttribute('aria-expanded')).toBe('true');
    expect(mountNode.textContent).toContain('已打开素材文件');
    expect(mountNode.textContent).toContain('已读取_smoke.jpg（图片 400×400）');
    expect(mountNode.textContent).toContain('8.2s');
  });

  it('失败与被门挡下各有语气；没有子步骤的行不可展开', async () => {
    await render(createElement(ToolCallRow, { item: readImage({ status: 'failed', substeps: [] }) }));
    const head = mountNode.querySelector('button')!;
    expect(head.textContent).toContain('读取图片失败');
    expect(head.hasAttribute('disabled')).toBe(true);
    expect(head.getAttribute('aria-expanded')).toBeNull();
    await act(async () => {
      root.render(
        createElement(ToolCallRow, {
          item: readImage({ tool: 'workflow-prompt-card-authoring', summary: '正在编排分镜与提示词', status: 'rejected', substeps: [] }),
        }),
      );
    });
    expect(mountNode.textContent).toContain('已跳过编排分镜与提示词');
  });
});

describe('ProcessGroup（IKFLB9 定稿）', () => {
  const items: ProcessItem[] = [
    { kind: 'waiting', summary: '正在等待模型响应', elapsedMs: 9_800 },
    { kind: 'thought', text: '先按创作方法把需求过一遍。', running: false, startedAt: null, elapsedMs: 5_200 },
    readImage({ summary: '正在查阅对应的创作方法', elapsedMs: 30, substeps: [] }),
    { kind: 'thought', text: '还没定的：视角、时刻。', running: false, startedAt: null, elapsedMs: 2_500 },
  ];

  it('结束：一行「已处理 · 思考 N 段 · 工具 N 次」默认折起；点开是阶段，阶段再点开才是思考原文；总数减各段是「写回复」', async () => {
    await render(createElement(ProcessGroup, { items, live: false, totalMs: 31_000 }));
    const head = mountNode.querySelector('button')!;
    expect(head.textContent).toBe('✻已处理 31s · 思考 2 段 · 工具 1 次');
    expect(head.getAttribute('aria-expanded')).toBe('false');
    expect(mountNode.textContent).not.toContain('理解需求');
    await act(async () => head.click());
    expect(mountNode.textContent).toContain('理解需求');
    expect(mountNode.textContent).toContain('15s');
    expect(mountNode.textContent).toContain('查阅对应的创作方法');
    expect(mountNode.textContent).toContain('整理回复');
    // 31 − (9.8 + 5.2 + 0.03 + 2.5) = 13.47s 是把回复打出来的时间，不补上头上的数和里面的加不起来。
    expect(mountNode.textContent).toContain('写回复');
    expect(mountNode.textContent).toContain('13s');
    const writing = [...mountNode.querySelectorAll('button')].find((b) => b.textContent?.includes('写回复'))!;
    expect(writing.hasAttribute('disabled')).toBe(true);
    expect(mountNode.textContent).not.toContain('先按创作方法');
    const phase = [...mountNode.querySelectorAll('button')].find((b) => b.textContent?.includes('理解需求'))!;
    await act(async () => phase.click());
    expect(mountNode.textContent).toContain('思考了');
    await act(async () => {
      [...mountNode.querySelectorAll('button')].find((b) => b.textContent?.includes('思考了'))!.click();
    });
    expect(mountNode.textContent).toContain('先按创作方法把需求过一遍。');
  });

  it('运行中：「处理中」并展开，正在跑的阶段也展开', async () => {
    const live: ProcessItem[] = [
      { kind: 'thought', text: '想完了。', running: false, startedAt: null, elapsedMs: 3_000 },
      { kind: 'thought', text: '还在想。', running: true, startedAt: Date.now() - 2_000, elapsedMs: null },
    ];
    await render(createElement(ProcessGroup, { items: live, live: true }));
    const head = mountNode.querySelector('button')!;
    expect(head.textContent).toContain('处理中');
    expect(head.getAttribute('aria-expanded')).toBe('true');
    expect(mountNode.textContent).toContain('进行中');
    expect(mountNode.textContent).toContain('还在想。');
  });

  it('什么过程都没有就不画', async () => {
    await render(createElement(ProcessGroup, { items: [], live: false }));
    expect(mountNode.textContent).toBe('');
  });
});

describe('ThinkingBlock', () => {
  it('运行中展开，最后一步保留进行时，前面的翻成过去式', async () => {
    await render(
      createElement(ThinkingBlock, {
        steps: ['正在理解创作需求', '正在根据生成结果整理回复'],
        reasoning: '这张图是纯色底。',
        live: true,
        autoOpen: true,
      }),
    );
    expect(mountNode.textContent).toContain('思考过程');
    expect(mountNode.textContent).toContain('已理解创作需求');
    expect(mountNode.textContent).toContain('正在根据生成结果整理回复');
    expect(mountNode.textContent).toContain('这张图是纯色底。');
  });

  it('结束后默认收起，用户点开以用户为准', async () => {
    await render(createElement(ThinkingBlock, { steps: ['正在理解创作需求'], reasoning: '原话', live: false }));
    expect(mountNode.textContent).not.toContain('原话');
    await act(async () => {
      mountNode.querySelector('button')!.click();
    });
    expect(mountNode.textContent).toContain('已理解创作需求');
    expect(mountNode.textContent).toContain('原话');
  });

  it('什么都没有就不画', async () => {
    await render(createElement(ThinkingBlock, { steps: [], reasoning: '', live: false }));
    expect(mountNode.textContent).toBe('');
  });
});

describe('TurnFooter', () => {
  const base: TurnAccount = {
    batchId: 'A',
    outcome: 'completed',
    seconds: 17,
    finishedAt: new Date(2026, 8, 15, 21, 37).getTime(),
    tokenUsage: { input_tokens: 12217, cached_input_tokens: 7799, output_tokens: 791, reasoning_tokens: 452 },
    contextCapacity: { used_input_tokens: 6536, configured_max_tokens: 200000, ratio: 0.033, compaction_state: 'none' },
    failureText: null,
    failureRetryable: true,
    cardFailureText: null,
    cardFailureRetryable: true,
  };

  // IKFLB9 定稿：耗时、token、上下文只在输入框上方那一行，轮尾不再重复。
  it('完成：轮尾什么都不写，账在 LastTurnLine', async () => {
    await render(createElement(TurnFooter, { account: base }));
    expect(mountNode.textContent).toBe('');
    await act(async () => {
      root.render(createElement(LastTurnLine, { account: base }));
    });
    expect(mountNode.textContent).toBe('✻上一轮 17s · ↓ 791 · 上下文 3% · 21:37 完成');
  });

  it('失败：写后端那句人话；取消：写已取消', async () => {
    await render(createElement(TurnFooter, { account: { ...base, outcome: 'failed', failureText: '余额不足', tokenUsage: null, contextCapacity: null } }));
    expect(mountNode.textContent).toBe('✕余额不足');
    await act(async () => {
      root.render(createElement(TurnFooter, { account: { ...base, outcome: 'cancelled', seconds: 5, tokenUsage: null, contextCapacity: null } }));
    });
    expect(mountNode.textContent).toBe('⊘已取消');
    await act(async () => {
      root.render(createElement(LastTurnLine, { account: { ...base, outcome: 'cancelled', seconds: 5, tokenUsage: null, contextCapacity: null } }));
    });
    expect(mountNode.textContent).toBe('⊘上一轮已取消 5s · 21:37 结束');
  });

  /**
   * 报告里记的「前端无重试入口」，在用户那边是成立的：入口在输入框工具栏角落，一个 14px 的
   * 无字图标，而失败这件事发生在对话流里——那一行以前只有字，什么都点不了。
   */
  it('失败：给了 onRetry 就在那一行旁边摆一个「重新回答」，点了就调它', async () => {
    const account = { ...base, outcome: 'failed' as const, failureText: '与模型服务的连接中断，自动重连几次都没成功。', tokenUsage: null, contextCapacity: null };
    await render(createElement(TurnFooter, { account }));
    // 不给回调就不画按钮：不是最后一轮、或者还有别的轮在跑时，重来的会是另一轮。
    expect(mountNode.querySelector('button')).toBeNull();

    let clicked = 0;
    await act(async () => {
      root.render(createElement(TurnFooter, { account, onRetry: () => { clicked += 1; } }));
    });
    const button = mountNode.querySelector('button');
    expect(button?.textContent).toBe('重新回答');
    await act(async () => {
      button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(clicked).toBe(1);
  });

  /**
   * 「再试也会被同一道审核拦下」那一类不给按钮——服务端说了算（`failureRetryable`）。
   * 给了的话用户会一遍遍按、一遍遍撞同一堵墙，那正是 `model_input_blocked` 当初要消灭的事。
   */
  it('服务端说这次重试没用：不画按钮，只留那句话', async () => {
    await render(
      createElement(TurnFooter, {
        account: {
          ...base,
          outcome: 'failed' as const,
          failureText: '这段描述没通过模型的安全审核，这个会话里再试也会被拦。',
          failureRetryable: false,
          tokenUsage: null,
          contextCapacity: null,
        },
        onRetry: () => {},
      }),
    );
    expect(mountNode.textContent).toContain('没通过模型的安全审核');
    expect(mountNode.querySelector('button')).toBeNull();
  });

  // IKEV0V：聊天里改卡没改成，那一轮照常完成、侧边栏还挂着上一版。不交代的话，
  // 用户会把旧卡当成这次改出来的。
  it('完成了但卡没写出来：写后端那句话；给了 onRetryCard 才有「再试一次」，点了就调它', async () => {
    const account = { ...base, cardFailureText: '这次没能写出生成卡，请重试。', tokenUsage: null, contextCapacity: null };
    await render(createElement(TurnFooter, { account }));
    expect(mountNode.textContent).toBe('!这次没能写出生成卡，请重试。');
    expect(mountNode.querySelector('button')).toBeNull();

    const onRetryCard = vi.fn();
    await act(async () => {
      root.render(createElement(TurnFooter, { account, onRetryCard }));
    });
    const button = mountNode.querySelector('button');
    expect(button?.textContent).toBe('再试一次');
    await act(async () => button!.click());
    expect(onRetryCard).toHaveBeenCalledTimes(1);
  });

  // 素材不可用、没定做图还是视频：得用户先做点什么，再发一遍一样的话没用，不给按钮。
  it('卡没写出来、但重发一遍也没用的：只写那句话，不给「再试一次」', async () => {
    const account = {
      ...base,
      cardFailureText: '这组卡里用到的素材现在不可用了（授权已撤销或重新识别过），请重新授权或上传后再改。',
      cardFailureRetryable: false,
      tokenUsage: null,
      contextCapacity: null,
    };
    await render(createElement(TurnFooter, { account, onRetryCard: vi.fn() }));
    expect(mountNode.textContent).toContain('请重新授权或上传后再改');
    expect(mountNode.querySelector('button')).toBeNull();
  });

  it('失败的轮不看 cardFailureText：整轮失败的说明优先', async () => {
    await render(
      createElement(TurnFooter, {
        account: { ...base, outcome: 'failed', failureText: '余额不足', cardFailureText: '这次没能写出生成卡，请重试。', tokenUsage: null, contextCapacity: null },
        onRetryCard: vi.fn(),
      }),
    );
    expect(mountNode.textContent).toBe('✕余额不足');
    expect(mountNode.querySelector('button')).toBeNull();
  });

  it('一个数都没有、也没时刻时 LastTurnLine 不画', async () => {
    await render(createElement(LastTurnLine, { account: { ...base, seconds: null, finishedAt: null, tokenUsage: null, contextCapacity: null } }));
    expect(mountNode.textContent).toBe('');
  });
});
