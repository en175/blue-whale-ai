// @vitest-environment jsdom
/** 追问按「排版一」画出来（IKFLB9 定稿）：题头、选项、推荐框各在各的位置，字一个不少。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/assets', () => ({ fetchAllAssets: vi.fn(async () => []) }));

const { ReplyText } = await import('./ReplyText');
const styles = (await import('./index.module.css')).default;

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
});

describe('ReplyText', () => {
  it('题头、选项、推荐各归各位，题间的 --- 不画', async () => {
    await render(
      createElement(ReplyText, {
        assets: [],
        text: '先对一下方向。\n\n---\n\n**❓ Q1 — 视角**：从什么角度看？\n\n- **A. 港口平视**：从海面看。\n- **B. 半空俯瞰**：从上面看。\n\n➡️ **推荐 B**：最好看。\n\n---\n\n都同意就回「都按推荐」。',
      }),
    );
    const q = mountNode.querySelector(`.${styles.question}`)!;
    expect(q).not.toBeNull();
    expect(q.querySelector(`.${styles.questionNo}`)?.textContent).toBe('Q1');
    expect(q.querySelector(`.${styles.questionTitle}`)?.textContent).toBe('视角');
    expect(q.querySelector(`.${styles.questionAsk}`)?.textContent).toBe('从什么角度看？');
    expect([...q.querySelectorAll(`.${styles.questionKey}`)].map((k) => k.textContent)).toEqual(['A', 'B']);
    expect([...q.querySelectorAll(`.${styles.questionLabel}`)].map((k) => k.textContent)).toEqual(['港口平视', '半空俯瞰']);
    expect(q.querySelector(`.${styles.questionRec}`)?.textContent).toBe('推荐 B：最好看。');
    expect(mountNode.querySelector('hr')).toBeNull();
    expect(mountNode.textContent).toContain('先对一下方向。');
    expect(mountNode.textContent).toContain('都同意就回「都按推荐」。');
  });

  it('服务端出的题按数据画：题号字母来自数据，推荐一行照服务端措辞（2026-09-15）', async () => {
    await render(
      createElement(ReplyText, {
        assets: [],
        text: '❓ **Q1 — 视角**：从哪看？',
        questions: [
          { no: 'Q1', title: '视角', ask: '从哪看？', options: [{ key: 'A', label: '平视', note: '从海面看。' }, { key: 'B', label: '俯瞰' }], recommended: ['B'], multiple: false, why: '最好看。' },
        ],
      }),
    );
    const q = mountNode.querySelector(`.${styles.question}`)!;
    expect(q.querySelector(`.${styles.questionNo}`)?.textContent).toBe('Q1');
    expect([...q.querySelectorAll(`.${styles.questionKey}`)].map((k) => k.textContent)).toEqual(['A', 'B']);
    expect(q.querySelector(`.${styles.questionDesc}`)?.textContent).toBe('：从海面看。');
    expect(q.querySelector(`.${styles.questionRec}`)?.textContent).toBe('推荐 B（俯瞰）：最好看。');
  });

  it('没有题就是普通 Markdown', async () => {
    await render(createElement(ReplyText, { assets: [], text: '卡写好了，**看一下**。' }));
    expect(mountNode.querySelector(`.${styles.question}`)).toBeNull();
    expect(mountNode.querySelector('strong')?.textContent).toBe('看一下');
  });
});
