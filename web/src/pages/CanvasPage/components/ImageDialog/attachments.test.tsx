// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ImageDialog, { type ImageTextAttachment } from './index';
import styles from './index.module.css';

/* IKDLQF：ImageDialog 文本附件只读展示（标题 + 正文预览，长文折叠），
   以及契约限长规则在面板侧的落点——附件正文有效时允许空提示词提交。 */

const fetchGenerationModels = vi.hoisted(() =>
  vi.fn(async () => [
    {
      model_id: 'm-test',
      provider_id: 'prov',
      model_label: '测试生图模型',
      icon: null,
      supported_sizes: [{ id: '2k', label: '2K' }],
      supported_aspect_ratios: ['1:1'],
      supported_formats: [],
      supported_durations: null,
      default_size: '2k',
      default_format: null,
      default_aspect_ratio: '1:1',
      default_duration: null,
      features: {},
      version: 1,
      digest: '',
    },
  ]),
);

vi.mock('@/api/generation', () => ({ fetchGenerationModels }));

let root: Root;
let container: HTMLDivElement;

async function renderDialog(props: { attachments?: ImageTextAttachment[]; onSend?: ReturnType<typeof vi.fn>; onReorderAttachments?: ReturnType<typeof vi.fn> } = {}) {
  const onSend = props.onSend ?? vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(ImageDialog, {
        onClose: vi.fn(),
        onSend,
        attachments: props.attachments,
        onReorderAttachments: props.onReorderAttachments,
      }),
    );
  });
  // 等模型能力加载完成（发送门依赖 currentGen）
  await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
  return { onSend };
}

function sendButton(): HTMLButtonElement {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('title') === '发送',
  )!;
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
});

describe('ImageDialog 文本附件', () => {
  it('展示附件来源标题与正文预览', async () => {
    await renderDialog({
      attachments: [
        { nodeId: 't1', title: '故事文案', text: '一只蓝鲸在海里' },
        { nodeId: 't2', title: '配色参考', text: '深蓝与银白' },
      ],
    });

    const region = container.querySelector(`.${styles.attachments}`);
    expect(region).not.toBeNull();
    expect(region!.textContent).toContain('故事文案');
    expect(region!.textContent).toContain('一只蓝鲸在海里');
    expect(region!.textContent).toContain('配色参考');
    expect(region!.textContent).toContain('深蓝与银白');
  });

  it('长文默认折叠，点击展开后可见全文', async () => {
    const longText = `开头。${'中段很长。'.repeat(40)}结尾。`;
    await renderDialog({ attachments: [{ nodeId: 't1', title: '长文', text: longText }] });

    const collapsed = () => container.querySelector(`.${styles.attachmentTextCollapsed}`);
    const toggle = () =>
      [...container.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
        ['展开', '收起'].includes(b.textContent ?? ''),
      )!;

    expect(collapsed()).not.toBeNull();
    expect(toggle().textContent).toBe('展开');

    await act(async () => {
      toggle().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(collapsed()).toBeNull();
    expect(toggle().textContent).toBe('收起');
    expect(container.textContent).toContain('结尾。');
  });

  it('无附件时不渲染附件区', async () => {
    await renderDialog();
    expect(container.querySelector(`.${styles.attachments}`)).toBeNull();
  });

  it('附件正文有效时允许空提示词提交', async () => {
    const { onSend } = await renderDialog({
      attachments: [{ nodeId: 't1', title: '故事文案', text: '一只蓝鲸在海里' }],
    });

    expect(sendButton().disabled).toBe(false);
    await act(async () => {
      sendButton().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onSend).toHaveBeenCalledWith('', 'm-test', '2k', '1:1', [], null);
  });

  it('附件正文仅含空白时沿用提示词必填（发送禁用）', async () => {
    await renderDialog({
      attachments: [{ nodeId: 't1', title: '空白附件', text: '   ' }],
    });
    expect(sendButton().disabled).toBe(true);
  });

  it('无附件且提示词为空时保持提示词必填（发送禁用）', async () => {
    await renderDialog();
    expect(sendButton().disabled).toBe(true);
  });
});

/* IKDLQH：多附件排序——上移/下移控件按 props 顺序渲染，点击经 onReorderAttachments 交出新序列 */
describe('ImageDialog 文本附件排序（IKDLQH）', () => {
  const three = [
    { nodeId: 't1', title: '甲', text: '正文甲' },
    { nodeId: 't2', title: '乙', text: '正文乙' },
    { nodeId: 't3', title: '丙', text: '正文丙' },
  ];

  /** 附件项按 DOM 顺序取标题 */
  const renderedTitles = () =>
    [...container.querySelectorAll(`.${styles.attachmentItem}`)].map(
      (el) => el.querySelector(`.${styles.attachmentTitle}`)!.textContent,
    );
  /** 第 index 个附件项的上移/下移按钮 */
  const moveButton = (index: number, direction: '上移' | '下移') =>
    [
      ...container
        .querySelectorAll(`.${styles.attachmentItem}`)
        [index]!.querySelectorAll<HTMLButtonElement>('button'),
    ].find((b) => b.getAttribute('title') === direction)!;

  it('多附件按 props 顺序渲染并展示排序控件，首项禁用上移、末项禁用下移', async () => {
    await renderDialog({ attachments: three, onReorderAttachments: vi.fn() });

    expect(renderedTitles()).toEqual(['甲', '乙', '丙']);
    expect(moveButton(0, '上移').disabled).toBe(true);
    expect(moveButton(0, '下移').disabled).toBe(false);
    expect(moveButton(1, '上移').disabled).toBe(false);
    expect(moveButton(1, '下移').disabled).toBe(false);
    expect(moveButton(2, '上移').disabled).toBe(false);
    expect(moveButton(2, '下移').disabled).toBe(true);
  });

  it('点击首项下移：与下一项交换，回调交出新 nodeId 序列', async () => {
    const onReorderAttachments = vi.fn();
    await renderDialog({ attachments: three, onReorderAttachments });

    await act(async () => {
      moveButton(0, '下移').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onReorderAttachments).toHaveBeenCalledWith(['t2', 't1', 't3']);
  });

  it('点击末项上移：与上一项交换，回调交出新 nodeId 序列', async () => {
    const onReorderAttachments = vi.fn();
    await renderDialog({ attachments: three, onReorderAttachments });

    await act(async () => {
      moveButton(2, '上移').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onReorderAttachments).toHaveBeenCalledWith(['t1', 't3', 't2']);
  });

  it('单附件或无回调时不渲染排序控件', async () => {
    await renderDialog({
      attachments: [{ nodeId: 't1', title: '甲', text: '正文甲' }],
      onReorderAttachments: vi.fn(),
    });
    expect(
      [...container.querySelectorAll('button')].some((b) =>
        ['上移', '下移'].includes(b.getAttribute('title') ?? ''),
      ),
    ).toBe(false);

    await act(async () => root.unmount());
    container.remove();
    await renderDialog({ attachments: three });
    expect(
      [...container.querySelectorAll('button')].some((b) =>
        ['上移', '下移'].includes(b.getAttribute('title') ?? ''),
      ),
    ).toBe(false);
  });
});
