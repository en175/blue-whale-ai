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
import { ThinkingBlock, ToolCallRow, TurnFooter } from './TurnTimeline';
import type { TimelineItem, TurnAccount } from '../../hooks/sessionTimeline';

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
    tokenUsage: { input_tokens: 12217, cached_input_tokens: 7799, output_tokens: 791, reasoning_tokens: 452 },
    contextCapacity: { used_input_tokens: 6536, configured_max_tokens: 200000, ratio: 0.033, compaction_state: 'none' },
    failureText: null,
    cardFailureText: null,
  };

  it('完成：只有符号和数字，不写「已完成」', async () => {
    await render(createElement(TurnFooter, { account: base }));
    expect(mountNode.textContent).toBe('✻17s · ↓ 791 · 上下文 3%');
  });

  it('失败：写后端那句人话；取消：写已取消', async () => {
    await render(createElement(TurnFooter, { account: { ...base, outcome: 'failed', failureText: '余额不足', tokenUsage: null, contextCapacity: null } }));
    expect(mountNode.textContent).toBe('✕余额不足17s');
    await act(async () => {
      root.render(createElement(TurnFooter, { account: { ...base, outcome: 'cancelled', seconds: 5, tokenUsage: null, contextCapacity: null } }));
    });
    expect(mountNode.textContent).toBe('⊘已取消5s');
  });

  // IKEV0V：聊天里改卡没改成，那一轮照常完成、侧边栏还挂着上一版。不交代的话，
  // 用户会把旧卡当成这次改出来的。
  it('完成了但卡没写出来：写后端那句话；给了 onRetryCard 才有「再试一次」，点了就调它', async () => {
    const account = { ...base, cardFailureText: '这次没能写出生成卡，请重试。', tokenUsage: null, contextCapacity: null };
    await render(createElement(TurnFooter, { account }));
    expect(mountNode.textContent).toBe('!这次没能写出生成卡，请重试。17s');
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

  it('失败的轮不看 cardFailureText：整轮失败的说明优先', async () => {
    await render(
      createElement(TurnFooter, {
        account: { ...base, outcome: 'failed', failureText: '余额不足', cardFailureText: '这次没能写出生成卡，请重试。', tokenUsage: null, contextCapacity: null },
        onRetryCard: vi.fn(),
      }),
    );
    expect(mountNode.textContent).toBe('✕余额不足17s');
    expect(mountNode.querySelector('button')).toBeNull();
  });

  it('一个数都没有、也没话可说时不画', async () => {
    await render(createElement(TurnFooter, { account: { ...base, seconds: null, tokenUsage: null, contextCapacity: null } }));
    expect(mountNode.textContent).toBe('');
  });
});
