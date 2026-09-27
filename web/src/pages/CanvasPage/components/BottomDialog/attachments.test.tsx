// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BottomDialog from './index';
import type { ImageTextAttachment } from '../ImageDialog';
import type { VideoMediaRef, VideoMediaRefs } from '../../videoMediaRefs';

/* IKDLQG：附件正文有效时允许空提示词提交（契约限长规则在面板侧的落点）。
   IKFCKQ：文本附件以 FileText 缩略图进参考栏统一序列——独立「文本附件（N）」区块、
   折叠正文与上移/下移排序随自绘实现下线（拖拽换位随 T5 切片另落）。 */

const { fetchGenerationModels, editorPendingCalls } = vi.hoisted(() => ({
  fetchGenerationModels: vi.fn(),
  /** IKFCKQ：缩略图 @ 按钮走 insertRefAtPending（记忆光标路径），桩记录调用供断言 */
  editorPendingCalls: [] as Array<{ kind: string; id: string }>,
}));

vi.mock('@/api/generation', () => ({ fetchGenerationModels }));

fetchGenerationModels.mockImplementation(async () => [
  {
    model_id: 'm-video',
    provider_id: 'prov',
    model_label: '测试视频模型',
    icon: null,
    supported_sizes: [{ id: '720p', label: '720P', api_value: '720p' }],
    supported_aspect_ratios: ['16:9'],
    supported_formats: [],
    supported_durations: { min: 5, max: 10, step: 1 },
    default_size: '720p',
    default_format: null,
    default_aspect_ratio: '16:9',
    default_duration: 5,
    features: {},
    version: 1,
    digest: '',
  },
]);

/** PromptRefEditor 打桩（IKFA1O 编辑器替换）：textarea 输入透传结构化 onChange */
vi.mock('../PromptRefEditor', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  return {
    default: forwardRef(function StubPromptRefEditor(
      { onChange }: { onChange?: (doc: { version: number; segments: Array<{ kind: 'text'; text: string }> }) => void },
      ref: React.Ref<unknown>,
    ) {
      useImperativeHandle(ref, () => ({
        insertRefAtMention: () => {},
        consumeMentionForPendingInsert: () => {},
        insertRefAtPending: (key: { kind: string; id: string }) => { editorPendingCalls.push(key); },
        dismissMention: () => {},
        replaceRefAt: () => {},
        clear: () => {},
      }));
      return createElement('textarea', {
        'data-testid': 'chip-editor',
        onChange: (e: Event) => {
          const value = (e.target as HTMLTextAreaElement).value;
          onChange?.({ version: 1, segments: value ? [{ kind: 'text', text: value }] : [] });
        },
      });
    }),
  };
});

let root: Root;
let container: HTMLDivElement;

const IMG_REF: VideoMediaRef = {
  nodeId: 'node-m1', url: 'https://x/m1', name: '素材m1', assetId: 'a-m1', mediaType: 'image',
};

interface RenderProps {
  attachments?: ImageTextAttachment[];
  mediaRefs?: VideoMediaRefs;
  onSend?: ReturnType<typeof vi.fn>;
  onRemoveAttachment?: ReturnType<typeof vi.fn>;
  syncingPlan?: boolean;
  status?: 'draft' | 'generating';
}

async function renderDialog(props: RenderProps = {}) {
  const onSend = props.onSend ?? vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(BottomDialog, {
          onClose: vi.fn(),
          onSend,
          attachments: props.attachments,
          onRemoveAttachment: props.onRemoveAttachment,
          syncingPlan: props.syncingPlan,
          videoMediaRefs: props.mediaRefs ?? { reference: [] },
          videoDraftBinding: { status: props.status, onParamsChange: vi.fn() },
        })
      ),
    );
  });
  // 等模型能力加载完成（发送门依赖 currentModel）
  await vi.waitFor(() => expect(container.textContent).toContain('测试视频模型'));
  return { onSend };
}

function sendButton(): HTMLButtonElement {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('title') === '发送',
  )!;
}

function textThumbs(): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[data-testid="dock-text-ref"]')];
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  editorPendingCalls.length = 0;
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
});

describe('BottomDialog 文本附件提交契约（IKDLQG）', () => {
  it('附件正文有效时允许空提示词提交', async () => {
    const { onSend } = await renderDialog({
      attachments: [{ nodeId: 't1', title: '故事文案', text: '一只蓝鲸在海里' }],
    });

    expect(sendButton().disabled).toBe(false);
    await act(async () => {
      sendButton().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onSend).toHaveBeenCalledWith('', {
      modelId: 'm-video',
      aspectRatio: '16:9',
      resolution: '720p',
      duration: 5,
      // IKFC1T：无媒体输入的附件驱动提交即文生视频模式（新建默认 prompt）
      mode: 'prompt',
      // IKG0LP：是否带音频（缺省 true）
      generateAudio: true,
    }, null);
  });

  it('附件正文仅含空白时沿用提示词必填（发送禁用）', async () => {
    await renderDialog({
      attachments: [{ nodeId: 't1', title: '空白附件', text: '   ' }],
    });
    expect(sendButton().disabled).toBe(true);
  });

  it('无附件且提示词为空时保持提示词必填（发送禁用）', async () => {
    await renderDialog({ mediaRefs: { reference: [] } });
    expect(sendButton().disabled).toBe(true);
    expect(container.querySelector('[data-testid="dock-text-ref"]')).toBeNull();
  });
});

/* IKFCKQ：文本附件进参考栏——FileText 图标缩略图与媒体同序列、文本N 独立编号、
   @ 与手动 @ 选择同一插入机制（text_ref 身份）。
   IKFCXC：× 统一走 onRemoveAttachment 断边链路（方案与普通附件同口径，方案附件素材同步期间禁移除）。 */
describe('IKFCKQ 文本附件进参考栏', () => {
  it('附件以图标缩略图进参考栏统一序列，编号独立于媒体（文本N 圆钮仅数字）', async () => {
    await renderDialog({
      mediaRefs: { reference: [IMG_REF] },
      attachments: [
        { nodeId: 't1', title: '故事文案', text: '一只蓝鲸在海里' },
        { nodeId: 't2', title: '配色参考', text: '深蓝与银白' },
      ],
    });

    const row = [...container.querySelectorAll('[data-testid="dock-video-ref"], [data-testid="dock-text-ref"]')];
    expect(row.map((el) => el.getAttribute('data-testid'))).toEqual(['dock-video-ref', 'dock-text-ref', 'dock-text-ref']);
    const badges = textThumbs().map((t) => t.querySelector('[data-testid="ref-thumb-badge"]')?.textContent);
    expect(badges).toEqual(['1', '2']);
    // 独立「文本附件（N）」区块不再出现
    expect(container.textContent).not.toContain('文本附件（');
  });

  it('方案与普通附件 × 都走 onRemoveAttachment 断边链路（IKFCXC：面板移除与画布断线同结果）', async () => {
    const onRemoveAttachment = vi.fn();
    await renderDialog({
      onRemoveAttachment,
      attachments: [
        { nodeId: 't1', title: '方案卡', text: '方案正文', isPromptPlan: true },
        { nodeId: 't2', title: '普通文本卡', text: '普通正文' },
      ],
    });
    const removeBtns = textThumbs().map((t) => t.querySelector<HTMLButtonElement>('button[title="移除"]'));
    expect(removeBtns[0]).toBeTruthy();
    expect(removeBtns[1], '普通文本附件同样提供面板移除').toBeTruthy();
    await act(async () => { removeBtns[0]!.click(); });
    await act(async () => { removeBtns[1]!.click(); });
    expect(onRemoveAttachment).toHaveBeenCalledWith('t1');
    expect(onRemoveAttachment).toHaveBeenCalledWith('t2');
  });

  it('素材同步期间方案附件禁移除，普通附件不受限（与 ImageDialog 同口径）', async () => {
    const onRemoveAttachment = vi.fn();
    await renderDialog({
      syncingPlan: true,
      onRemoveAttachment,
      attachments: [
        { nodeId: 't1', title: '方案卡', text: '方案正文', isPromptPlan: true },
        { nodeId: 't2', title: '普通文本卡', text: '普通正文' },
      ],
    });
    const removeBtns = textThumbs().map((t) => t.querySelector<HTMLButtonElement>('button[title="移除"]'));
    expect(removeBtns[0]).toBeNull();
    expect(removeBtns[1], '普通附件在素材同步期间仍可断边').toBeTruthy();
    await act(async () => { removeBtns[1]!.click(); });
    expect(onRemoveAttachment).toHaveBeenCalledWith('t2');
  });

  it('生成中只读：文本缩略图可见但无 × 与 @ 入口', async () => {
    await renderDialog({
      status: 'generating',
      onRemoveAttachment: vi.fn(),
      attachments: [{ nodeId: 't1', title: '方案卡', text: '方案正文', isPromptPlan: true }],
    });
    expect(container.querySelector('[data-testid="dock-text-ref"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="dock-text-ref"] button[title="移除"]')).toBeNull();
    expect(container.querySelector('[data-testid="dock-text-ref"] button[title="插入引用（优先插入上次 @ 的位置，否则追加到正文末尾）"]')).toBeNull();
  });

  it('缩略图 @ 按钮走 insertRefAtPending 记忆光标路径（text_ref 身份）', async () => {
    await renderDialog({
      attachments: [{ nodeId: 't1', title: '故事文案', text: '一只蓝鲸在海里' }],
    });
    const atBtn = container.querySelector<HTMLButtonElement>('[data-testid="dock-text-ref"] button[title="插入引用（优先插入上次 @ 的位置，否则追加到正文末尾）"]')!;
    await act(async () => { atBtn.click(); });
    expect(editorPendingCalls).toEqual([{ kind: 'text_ref', id: 't1' }]);
  });

  it('首尾帧模式同样展示文本附件缩略图（附件与模式无关）', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: new QueryClient() },
          createElement(BottomDialog, {
            onClose: vi.fn(),
            onSend: vi.fn(),
            attachments: [{ nodeId: 't1', title: '故事文案', text: '一只蓝鲸在海里' }],
            videoMediaRefs: { reference: [], first: IMG_REF },
            enabledModes: ['keyframe'],
            videoDraftBinding: { onParamsChange: vi.fn() },
          })
        ),
      );
    });
    await vi.waitFor(() => expect(container.textContent).toContain('测试视频模型'));
    expect(container.querySelector('[data-testid="dock-text-ref"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="dock-video-ref"] [data-testid="ref-thumb-badge"]')?.textContent).toBe('首帧');
  });
});
