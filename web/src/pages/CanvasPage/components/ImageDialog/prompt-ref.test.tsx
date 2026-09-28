// @vitest-environment jsdom
/* IKFA1M：ImageDialog 正文素材标签——@ 菜单/插入/编号一致性/失效阻止生成/删除提及 */
import { act, createElement } from 'react';
import { $createRangeSelection, $getRoot, $getSelection, $isRangeSelection, $isTextNode, $nodesOfType, $setSelection, KEY_ARROW_LEFT_COMMAND, KEY_ARROW_RIGHT_COMMAND, KEY_BACKSPACE_COMMAND, SKIP_DOM_SELECTION_TAG } from 'lexical';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ImageDialog, { type ImageTextAttachment } from './index';
import type { ImageMediaRef } from '../../mediaRefs';
import type { AtMentionItem } from '../../atMention';
import type { PromptDoc } from '@/lib/prompt-doc';
import { AssetRefNode } from '../PromptRefEditor/AssetRefNode';
import { collapseCaretAt, promptRefEditorInstance, promptRefCaretOffset, readPromptRefText, typePromptRefRaw, typePromptRefText } from '../../testing/promptRefEditor';

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
      features: { reference_image: true, image_reference_max: 9 },
      version: 1,
      digest: '',
    },
  ]),
);

vi.mock('@/api/generation', () => ({ fetchGenerationModels }));

const REF_A: ImageMediaRef = { nodeId: 'na', url: 'https://x/a.png', name: '角色图', assetId: '101' };
const REF_B: ImageMediaRef = { nodeId: 'nb', url: 'https://x/b.png', name: '衣服图', assetId: '102' };
const REF_C: ImageMediaRef = { nodeId: 'nc', url: 'https://x/c.png', name: '背景图', assetId: '103' };

const DOC_AB: PromptDoc = {
  version: 1,
  segments: [
    { kind: 'text', text: '让' },
    { kind: 'asset_ref', asset_id: '101', label: '图片1' },
    { kind: 'text', text: '穿上' },
    { kind: 'asset_ref', asset_id: '102', label: '图片2' },
    { kind: 'text', text: '，背景参考' },
    { kind: 'asset_ref', asset_id: '103', label: '图片3' },
  ],
};

let root: Root;
let container: HTMLDivElement;

async function renderDialog(props: {
  mentionItems?: AtMentionItem[];
  onMentionCanvas?: (item: AtMentionItem) => void;
  mediaRefs?: ImageMediaRef[];
  attachments?: ImageTextAttachment[];
  onRemoveAttachment?: ReturnType<typeof vi.fn>;
  initialDoc?: PromptDoc | null;
  initialText?: string;
  onSend?: ReturnType<typeof vi.fn>;
  onParamsChange?: ReturnType<typeof vi.fn>;
  onRemoveMediaRef?: ReturnType<typeof vi.fn>;
  draftStatus?: 'generating';
} = {}) {
  const onSend = props.onSend ?? vi.fn();
  const onParamsChange = props.onParamsChange ?? vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(ImageDialog, {
          onClose: vi.fn(),
          onSend,
          initialText: props.initialText,
          initialDoc: props.initialDoc ?? null,
          mediaRefs: props.mediaRefs,
          mentionItems: props.mentionItems,
          onMentionCanvas: props.onMentionCanvas,
          attachments: props.attachments,
          onRemoveAttachment: props.onRemoveAttachment,
          draftBinding: (props.mediaRefs || props.attachments)
            ? { onParamsChange, status: props.draftStatus }
            : undefined,
          onRemoveMediaRef: props.onRemoveMediaRef,
        } as Parameters<typeof ImageDialog>[0])
      ),
    );
  });
  await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
  return { onSend, onParamsChange };
}

async function rerender(mediaRefs: ImageMediaRef[], onParamsChange?: ReturnType<typeof vi.fn>) {
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(ImageDialog, {
          onClose: vi.fn(),
          onSend: vi.fn(),
          mediaRefs,
          draftBinding: { onParamsChange: onParamsChange ?? vi.fn() },
        } as Parameters<typeof ImageDialog>[0])
      ),
    );
  });
}

function sendButton(): HTMLButtonElement {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('title') === '发送',
  )!;
}

function lastDocFromParams(onParamsChange: ReturnType<typeof vi.fn>): { prompt?: string; promptDoc?: { segments: unknown[]; flat: string } } {
  const calls = onParamsChange.mock.calls.filter((c) => c[0]?.promptDoc !== undefined);
  return calls[calls.length - 1]?.[0] ?? {};
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe('IKFA1M @ 菜单与插入（A1/A4）', () => {
  it('从 @ 添加新图片成功后，在原位置插入标签并保存身份（A3）', async () => {
    const item: AtMentionItem = { id: 'nb', assetId: '102', kind: 'image', name: '衣服图' };
    const onMentionCanvas = vi.fn();
    const { onParamsChange } = await renderDialog({ mediaRefs: [REF_A], mentionItems: [item], onMentionCanvas });
    await typePromptRefRaw(container, '让@衣服');
    await vi.waitFor(() => expect(container.querySelector('[data-testid="mention-menu"]')).toBeTruthy());
    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent === '衣服图')!.click();
    });
    expect(onMentionCanvas).toHaveBeenCalledWith(item);
    expect(readPromptRefText(container)).toBe('让');
    await rerender([REF_A, REF_B], onParamsChange);
    await vi.waitFor(() => expect(readPromptRefText(container)).toBe('让图片2'));
    expect(lastDocFromParams(onParamsChange).promptDoc?.segments).toEqual([
      { kind: 'text', text: '让' },
      { kind: 'asset_ref', asset_id: '102', label: '图片2' },
    ]);
  });

  it('句中输入 @：顶部列出已引用（名称+编号），选择后原位替换查询，前后文字不丢', async () => {
    const { onParamsChange } = await renderDialog({ mediaRefs: [REF_A, REF_B] });
    await typePromptRefRaw(container, '让');
    await typePromptRefRaw(container, '@');
    // 菜单出现：已引用两项，编号与附件区角标一致
    await vi.waitFor(() => expect(container.querySelector('[data-testid="mention-menu"]')).toBeTruthy());
    const items = [...container.querySelectorAll('[data-testid="mention-ref-item"]')];
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('角色图');
    expect(items[0].textContent).toContain('图片1');
    expect(items[1].textContent).toContain('衣服图');
    expect(items[1].textContent).toContain('图片2');
    // 附件区角标同编号
    const badges = [...container.querySelectorAll('[data-testid="dock-media-ref"]')].map((el) => el.textContent);
    // IKFCKK：编号圆钮只显示数字（底部「图片N」文字标签已移除），与菜单编号一致
    expect(badges[0]).toBe('1');
    expect(badges[1]).toBe('2');

    await typePromptRefRaw(container, '的衣服');
    // 查询过滤：名称命中
    await vi.waitFor(() => {
      expect([...container.querySelectorAll('[data-testid="mention-ref-item"]')]).toHaveLength(0);
    });

    // 清空重输：选择第二项（先提图片2）
    await typePromptRefText(container, '让的衣服');
    await typePromptRefRaw(container, '@衣服');
    await vi.waitFor(() => {
      const filtered = [...container.querySelectorAll('[data-testid="mention-ref-item"]')];
      expect(filtered).toHaveLength(1);
      expect(filtered[0].textContent).toContain('衣服图');
    });
    await act(async () => {
      (container.querySelector('[data-testid="mention-ref-item"]') as HTMLButtonElement).click();
    });
    // 标签插入在光标处：文本投影保留前后文字，查询消失
    await vi.waitFor(() => expect(readPromptRefText(container)).toBe('让的衣服图片2'));
    // 草稿同步结构：asset_ref 绑定 102，flat 与镜像一致
    const patch = lastDocFromParams(onParamsChange);
    expect(patch.prompt).toBe('让的衣服图片2');
    expect(patch.promptDoc?.flat).toBe('让的衣服图片2');
    expect(patch.promptDoc?.segments).toEqual([
      { kind: 'text', text: '让的衣服' },
      { kind: 'asset_ref', asset_id: '102', label: '图片2' },
    ]);
  });

  it('同一素材可在正文多次提及（A4），各次提及指向同一输入', async () => {
    await renderDialog({ mediaRefs: [REF_A] });
    await typePromptRefRaw(container, '让');
    await typePromptRefRaw(container, '@');
    await vi.waitFor(() => expect(container.querySelector('[data-testid="mention-ref-item"]')).toBeTruthy());
    await act(async () => {
      (container.querySelector('[data-testid="mention-ref-item"]') as HTMLButtonElement).click();
    });
    await typePromptRefRaw(container, '微笑，再让');
    await typePromptRefRaw(container, '@');
    await vi.waitFor(() => expect(container.querySelector('[data-testid="mention-ref-item"]')).toBeTruthy());
    await act(async () => {
      (container.querySelector('[data-testid="mention-ref-item"]') as HTMLButtonElement).click();
    });
    await typePromptRefRaw(container, '招手');
    expect(readPromptRefText(container)).toBe('让图片1微笑，再让图片1招手');
    // 参考集合仍只有一份输入
    expect([...container.querySelectorAll('[data-testid="dock-media-ref"]')]).toHaveLength(1);
  });

  it('发送：携带结构化正文（先提图片2 也绑定 102），拍平镜像进 text 位', async () => {
    const { onSend } = await renderDialog({ mediaRefs: [REF_A, REF_B] });
    await typePromptRefRaw(container, '让');
    await typePromptRefRaw(container, '@衣服');
    await vi.waitFor(() => expect(container.querySelector('[data-testid="mention-ref-item"]')).toBeTruthy());
    await act(async () => {
      (container.querySelector('[data-testid="mention-ref-item"]') as HTMLButtonElement).click();
    });
    await typePromptRefRaw(container, '微笑');
    expect(sendButton().disabled).toBe(false);
    await act(async () => {
      sendButton().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    const call = onSend.mock.calls[0];
    expect(call[0]).toBe('让图片2微笑');
    expect(call[5]).toEqual({
      version: 1,
      segments: [
        { kind: 'text', text: '让' },
        { kind: 'asset_ref', asset_id: '102', label: '图片2' },
        { kind: 'text', text: '微笑' },
      ],
    });
  });
});

describe('IKFA1M 失效与删除（B1 基础/阻止生成）', () => {
  it('移除中间参考：剩余有效标签重编号，被移除标签显示失效且不转向（B1）', async () => {
    await renderDialog({ mediaRefs: [REF_A, REF_B, REF_C], initialDoc: DOC_AB });
    expect([...container.querySelectorAll('[data-testid="asset-ref-valid"]')]).toHaveLength(3);
    // 移除 B（父级断开连线 → mediaRefs 少一项）
    await rerender([REF_A, REF_C]);
    await vi.waitFor(() => {
      expect(container.textContent).toContain('已失效：原图片2');
    });
    const valids = [...container.querySelectorAll('[data-testid="asset-ref-valid"]')].map((el) => el.textContent);
    // A 仍图片1，C 重编号为图片2（身份不变）；失效标签单独展示
    expect(valids.join('|')).toContain('图片1');
    expect(valids.filter((t) => t?.includes('图片2'))).toHaveLength(1);
    expect([...container.querySelectorAll('[data-testid="asset-ref-invalid"]')]).toHaveLength(1);
    // 失效标签阻止生成并指出原因
    expect(sendButton().disabled).toBe(true);
    expect(container.textContent).toContain('正文有已失效的素材标签，请点击标签替换或删除后再发送');
  });

  it('删除失效提及后可以继续生成；删除正文提及不删除附件（B2）', async () => {
    await renderDialog({ mediaRefs: [REF_A, REF_C], initialDoc: DOC_AB });
    // 打开时 reconcile：B 已失效
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="asset-ref-invalid"]')).toBeTruthy();
    });
    expect(sendButton().disabled).toBe(true);
    // 删除该失效提及（标签不带叉叉，删除走退格键；jsdom 无法驱动按键，经编辑器实例等价删除）
    const editor = promptRefEditorInstance(container);
    await act(async () => {
      editor.update(() => {
        $nodesOfType(AssetRefNode).find((n) => n.getInvalidLabel() !== undefined)?.remove();
      });
    });
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="asset-ref-invalid"]')).toBeNull();
    });
    // 附件区不受影响（仍两项），发送恢复可用
    expect([...container.querySelectorAll('[data-testid="dock-media-ref"]')]).toHaveLength(2);
    await vi.waitFor(() => expect(sendButton().disabled).toBe(false));
  });

  it('标签无叉叉：回退键删除标签后的提及', async () => {
    await renderDialog({
      mediaRefs: [REF_A],
      initialDoc: {
        version: 1,
        segments: [
          { kind: 'text', text: '前' },
          { kind: 'asset_ref', asset_id: '101', label: '图片1' },
          { kind: 'text', text: '后' },
        ],
      },
    });
    expect(container.querySelector('[data-testid="asset-ref-valid"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="asset-ref-valid"] button')).toBeNull();
    const editor = promptRefEditorInstance(container);
    // 光标精确折叠在标签之后的文本起点，等价「标签后按一次退格键」
    await act(async () => {
      editor.update(() => {
        const after = $nodesOfType(AssetRefNode)[0]!.getNextSibling();
        const sel = $createRangeSelection();
        sel.anchor.set(after!.getKey(), 0, 'text');
        sel.focus.set(after!.getKey(), 0, 'text');
        $setSelection(sel);
      });
    });
    await act(async () => {
      editor.dispatchCommand(KEY_BACKSPACE_COMMAND, new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    });
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="asset-ref-valid"]')).toBeNull();
    });
    expect(readPromptRefText(container)).toBe('前后');
  });

  const DOC_REF_BETWEEN: PromptDoc = {
    version: 1,
    segments: [
      { kind: 'text', text: '前' },
      { kind: 'asset_ref', asset_id: '101', label: '图片1' },
      { kind: 'text', text: '后' },
    ],
  };

  function anchorOf(editor: ReturnType<typeof promptRefEditorInstance>) {
    return editor.read(() => {
      const s = $getSelection();
      if (!$isRangeSelection(s)) return null;
      return { type: s.anchor.type, offset: s.anchor.offset };
    });
  }

  async function collapseTo(editor: ReturnType<typeof promptRefEditorInstance>, side: 'before' | 'ref' | 'after', offset: number, type: 'text' | 'node') {
    await act(async () => {
      editor.update(() => {
        const ref = $nodesOfType(AssetRefNode)[0]!;
        const target = side === 'before' ? ref.getPreviousSibling() : side === 'after' ? ref.getNextSibling() : ref;
        const sel = $createRangeSelection();
        sel.anchor.set(target!.getKey(), offset, type as 'text' | 'element');
        sel.focus.set(target!.getKey(), offset, type as 'text' | 'element');
        $setSelection(sel);
      }, { tag: SKIP_DOM_SELECTION_TAG });
    });
  }

  async function pressArrow(editor: ReturnType<typeof promptRefEditorInstance>, key: 'ArrowLeft' | 'ArrowRight') {
    const command = key === 'ArrowLeft' ? KEY_ARROW_LEFT_COMMAND : KEY_ARROW_RIGHT_COMMAND;
    await act(async () => {
      editor.dispatchCommand(command, new KeyboardEvent('keydown', { key, bubbles: true }));
    });
  }

  it('Right 在标签前文本末尾：一步跨到标签后文本开头', async () => {
    await renderDialog({ mediaRefs: [REF_A], initialDoc: DOC_REF_BETWEEN });
    const editor = promptRefEditorInstance(container);
    await collapseTo(editor, 'before', 1, 'text');
    await pressArrow(editor, 'ArrowRight');
    await vi.waitFor(() => expect(anchorOf(editor)).toEqual({ type: 'text', offset: 0 }));
  });

  it('Left 在标签后文本开头：一步跨回标签前文本末尾', async () => {
    await renderDialog({ mediaRefs: [REF_A], initialDoc: DOC_REF_BETWEEN });
    const editor = promptRefEditorInstance(container);
    await collapseTo(editor, 'after', 0, 'text');
    await pressArrow(editor, 'ArrowLeft');
    await vi.waitFor(() => expect(anchorOf(editor)).toEqual({ type: 'text', offset: 1 }));
  });

  // 「光标停在标签边界点（node 点）→ 左右键立即跳出」两分支与上面共用同一落点逻辑，
  // jsdom 无法构造 node 点选区（selection 被清空），该场景由浏览器人工验证覆盖。

  it('删除一次提及只删该处（附件与其他提及保留）', async () => {
    const dup: PromptDoc = {
      version: 1,
      segments: [
        { kind: 'asset_ref', asset_id: '101', label: '图片1' },
        { kind: 'text', text: '和' },
        { kind: 'asset_ref', asset_id: '101', label: '图片1' },
      ],
    };
    await renderDialog({ mediaRefs: [REF_A], initialDoc: dup });
    expect([...container.querySelectorAll('[data-testid="asset-ref-valid"]')]).toHaveLength(2);
    // 删除第一个提及（原经标签叉叉，现统一走退格键；同上经编辑器实例等价删除）
    const editor = promptRefEditorInstance(container);
    await act(async () => {
      editor.update(() => {
        $nodesOfType(AssetRefNode)[0]!.remove();
      });
    });
    await vi.waitFor(() => {
      expect([...container.querySelectorAll('[data-testid="asset-ref-valid"]')]).toHaveLength(1);
    });
    expect([...container.querySelectorAll('[data-testid="dock-media-ref"]')]).toHaveLength(1);
  });
});

describe('IKFA1N 失效恢复与替换（B3/B4/B5/C4）', () => {
  const REF_D_SAME_NAME: ImageMediaRef = { nodeId: 'nd', url: 'https://x/d.png', name: '衣服图', assetId: '104' };

  it('身份重新加回有效集合：失效标签自动恢复并显示当次编号（B4/C4）', async () => {
    const { onParamsChange } = await renderDialog({ mediaRefs: [REF_A, REF_C], initialDoc: DOC_AB });
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="asset-ref-invalid"]')).toBeTruthy();
    });
    expect(sendButton().disabled).toBe(true);
    // 重新加入 102（末位 → 图片3）：失效标签恢复为有效，附件区与正文同步
    await rerender([REF_A, REF_C, REF_B], onParamsChange);
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="asset-ref-invalid"]')).toBeNull();
    });
    const valids = [...container.querySelectorAll('[data-testid="asset-ref-valid"]')].map((el) => el.textContent);
    expect(valids.join('|')).toBe('图片1|图片3|图片2');
    expect(readPromptRefText(container)).toBe('让图片1穿上图片3，背景参考图片2');
    expect(sendButton().disabled).toBe(false);
    // 草稿同步恢复后的结构（身份不变、失效标记清除、当次编号）
    const patch = lastDocFromParams(onParamsChange);
    expect(patch.promptDoc?.segments).toEqual([
      { kind: 'text', text: '让' },
      { kind: 'asset_ref', asset_id: '101', label: '图片1' },
      { kind: 'text', text: '穿上' },
      { kind: 'asset_ref', asset_id: '102', label: '图片3' },
      { kind: 'text', text: '，背景参考' },
      { kind: 'asset_ref', asset_id: '103', label: '图片2' },
    ]);
  });

  it('加回同名不同身份素材：原失效标签不恢复（B3）', async () => {
    await renderDialog({ mediaRefs: [REF_A, REF_C], initialDoc: DOC_AB });
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="asset-ref-invalid"]')).toBeTruthy();
    });
    // 104 与 102 同名「衣服图」：名称不参与判定，102 失效标签原样保留
    await rerender([REF_A, REF_C, REF_D_SAME_NAME]);
    await act(async () => {});
    expect(container.querySelector('[data-testid="asset-ref-invalid"]')!.textContent).toContain('已失效：原图片2');
    expect(sendButton().disabled).toBe(true);
  });

  it('点击失效标签选择其他已引用项：仅该位置换绑，不批量改其他提及、不重复添加输入（B5）', async () => {
    const { onParamsChange } = await renderDialog({ mediaRefs: [REF_A, REF_C], initialDoc: DOC_AB });
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="asset-ref-invalid"]')).toBeTruthy();
    });
    // 点击失效标签主体 → 替换菜单列出当前已引用项（A=图片1、C=图片2）
    const invalidChip = container.querySelector('[data-testid="asset-ref-invalid"]')!;
    await act(async () => {
      invalidChip.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    const menu = container.querySelector('[data-testid="replace-ref-menu"]');
    expect(menu).toBeTruthy();
    const items = [...container.querySelectorAll('[data-testid="replace-ref-item"]')];
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('角色图');
    expect(items[1].textContent).toContain('背景图');
    // 选择 C（背景图=图片2）：仅该次提及换绑为 103，菜单关闭
    await act(async () => {
      (items[1] as HTMLButtonElement).click();
    });
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="replace-ref-menu"]')).toBeNull();
    });
    expect(container.querySelector('[data-testid="asset-ref-invalid"]')).toBeNull();
    // 参考输入不重复添加（仍两项），其余提及身份不变
    expect([...container.querySelectorAll('[data-testid="dock-media-ref"]')]).toHaveLength(2);
    expect(readPromptRefText(container)).toBe('让图片1穿上图片2，背景参考图片2');
    await vi.waitFor(() => expect(sendButton().disabled).toBe(false));
    const patch = lastDocFromParams(onParamsChange);
    expect(patch.promptDoc?.segments).toEqual([
      { kind: 'text', text: '让' },
      { kind: 'asset_ref', asset_id: '101', label: '图片1' },
      { kind: 'text', text: '穿上' },
      { kind: 'asset_ref', asset_id: '103', label: '图片2' },
      { kind: 'text', text: '，背景参考' },
      { kind: 'asset_ref', asset_id: '103', label: '图片2' },
    ]);
  });

  it('只替换一处：另一处失效提及仍阻止生成（B5）', async () => {
    const twoInvalid: PromptDoc = {
      version: 1,
      segments: [
        { kind: 'asset_ref', asset_id: '102', label: '图片2', invalid_label: '图片2' },
        { kind: 'text', text: '和' },
        { kind: 'asset_ref', asset_id: '102', label: '图片2', invalid_label: '图片2' },
      ],
    };
    await renderDialog({ mediaRefs: [REF_A, REF_C], initialDoc: twoInvalid });
    await vi.waitFor(() => {
      expect([...container.querySelectorAll('[data-testid="asset-ref-invalid"]')]).toHaveLength(2);
    });
    const first = container.querySelector('[data-testid="asset-ref-invalid"]')!;
    await act(async () => {
      first.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await act(async () => {
      (container.querySelector('[data-testid="replace-ref-item"]') as HTMLButtonElement).click();
    });
    await vi.waitFor(() => {
      expect([...container.querySelectorAll('[data-testid="asset-ref-invalid"]')]).toHaveLength(1);
    });
    expect(sendButton().disabled).toBe(true);
    expect(readPromptRefText(container)).toBe('图片1和已失效：原图片2');
  });
});

it('结构化编辑器保留画布文本引用入口，选择后消费查询且不伪造图片标签', async () => {
  const onMentionCanvas = vi.fn();
  const item: AtMentionItem = { id: 'text-1', kind: 'text', name: '水彩方案' };
  await renderDialog({ mediaRefs: [REF_A], mentionItems: [item], onMentionCanvas });
  await typePromptRefRaw(container, '让@水彩');
  await vi.waitFor(() => expect(document.body.textContent).toContain('水彩方案'));
  await act(async () => {
    [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.includes('水彩方案'))!.click();
  });
  expect(onMentionCanvas).toHaveBeenCalledWith(item);
  expect(readPromptRefText(container)).toBe('让');
});

it('菜单内搜索同时显示已引用和画布同一素材，选择画布项直接插入且不重复添加引用', async () => {
  const onMentionCanvas = vi.fn();
  const item: AtMentionItem = { id: 'na', assetId: '101', kind: 'image', name: '角色图' };
  await renderDialog({ mediaRefs: [REF_A], mentionItems: [item], onMentionCanvas });
  await typePromptRefRaw(container, '让@');
  const input = container.querySelector('input[placeholder="搜索"]') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '角色');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const menu = container.querySelector('[data-testid="mention-menu"]')!;
  const matches = [...menu.querySelectorAll<HTMLButtonElement>('button')].filter(b => b.textContent?.includes('角色图'));
  expect(matches).toHaveLength(2);
  await act(async () => matches[1].click());
  await vi.waitFor(() => expect(readPromptRefText(container)).toBe('让图片1'));
  expect(onMentionCanvas).not.toHaveBeenCalled();
  expect(container.querySelectorAll('[data-testid="dock-media-ref"]')).toHaveLength(1);
});


it.each(['正文', 'Esc', '外部'])('取消 @（%s）后恢复正文编辑，旧触发符不重开，删除重输才唤起', async (method) => {
  await renderDialog({ mediaRefs: [REF_A] });
  await typePromptRefRaw(container, '让@');
  const host = container.querySelector('[contenteditable]') as HTMLElement;
  expect(document.activeElement).toBe(container.querySelector('input[placeholder="搜索"]'));
  await act(async () => {
    if (method === 'Esc') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    else (method === '正文' ? host : document.body).dispatchEvent(new Event('pointerdown', { bubbles: true }));
  });
  const editor = promptRefEditorInstance(container);
  const edit = async (change: () => void) => {
    await act(async () => editor.update(change, { tag: SKIP_DOM_SELECTION_TAG }));
  };
  await edit(() => { $getRoot().selectStart(); });
  await edit(() => { $getRoot().selectEnd(); });
  expect(container.querySelector('[data-testid="mention-menu"]')).toBeNull();
  await act(async () => host.focus());
  expect(document.activeElement).toBe(host);
  await typePromptRefRaw(container, '继续');
  expect(readPromptRefText(container)).toBe('让@继续');
  expect(container.querySelector('[data-testid="mention-menu"]')).toBeNull();
  // 改动 @ 之前的正文也不能让原来的触发符复活。
  await edit(() => {
    const node = $getRoot().getFirstDescendant();
    if ($isTextNode(node)) { node.spliceText(0, 0, '先'); node.selectEnd(); }
  });
  expect(container.querySelector('[data-testid="mention-menu"]')).toBeNull();
  await edit(() => {
    const node = $getRoot().getFirstDescendant();
    if ($isTextNode(node)) { node.spliceText(2, 3, ''); node.selectEnd(); }
  });
  expect(readPromptRefText(container)).toBe('先让');
  await typePromptRefRaw(container, '@');
  expect(container.querySelector('[data-testid="mention-menu"]')).toBeTruthy();
  expect(document.activeElement).toBe(container.querySelector('input[placeholder="搜索"]'));
});

it('真实菜单键盘确认把已引用素材插入正文', async () => {
  await renderDialog({ mediaRefs: [REF_A] });
  await typePromptRefRaw(container, '让@');
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })));
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
  await vi.waitFor(() => expect(readPromptRefText(container)).toBe('让图片1'));
  expect(container.querySelector('[data-testid="mention-menu"]')).toBeNull();
});

/* IKIQ88：缩略图 @ 按钮启用「当前选区」回落——光标置于文本中间时 chip 原位插入；
   无光标记录（未聚焦过输入框）仍追加末尾，插入后编辑器聚焦、光标落在 chip 之后 */
describe('IKIQ88 缩略图 @ 光标处插入', () => {
  it('光标置于文本中间：点击缩略图 @ 按钮，chip 插入光标处而非末尾', async () => {
    const { onParamsChange } = await renderDialog({ mediaRefs: [REF_A, REF_B] });
    await typePromptRefText(container, '让衣服');
    await collapseCaretAt(promptRefEditorInstance(container), 1);
    const atBtn = container.querySelector<HTMLButtonElement>('[data-testid="dock-media-ref"] button[title="插入引用"]')!;
    await act(async () => {
      atBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(readPromptRefText(container)).toBe('让图片1衣服');
    // 光标落在 chip 之后：继续输入接在标签后
    await typePromptRefRaw(container, '！');
    expect(readPromptRefText(container)).toBe('让图片1衣服！');
    // 与手动 @ 菜单选择同一种 chip：asset_ref 绑定 101、文案 图片1
    const patch = lastDocFromParams(onParamsChange);
    expect(patch.promptDoc?.segments).toEqual([
      { kind: 'text', text: '让' },
      { kind: 'asset_ref', asset_id: '101', label: '图片1' },
      { kind: 'text', text: '衣服！' },
    ]);
  });

  it('未聚焦过输入框：chip 追加末尾，插入后编辑器聚焦、光标落在 chip 之后', async () => {
    await renderDialog({ mediaRefs: [REF_A] });
    (document.activeElement as HTMLElement | null)?.blur?.();
    const atBtn = container.querySelector<HTMLButtonElement>('[data-testid="dock-media-ref"] button[title="插入引用"]')!;
    await act(async () => {
      atBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(readPromptRefText(container)).toBe('图片1');
    // 插入后编辑器聚焦
    await vi.waitFor(() => {
      expect(document.activeElement?.hasAttribute('contenteditable')).toBe(true);
    });
    // 光标落在 chip 之后：继续输入接在标签后
    await typePromptRefRaw(container, '尾巴');
    expect(readPromptRefText(container)).toBe('图片1尾巴');
  });
});

/* IKFCKN：文本附件进参考栏——@ 与手动 @ 选择产出同一种 文本N 标签 chip、× 断开连线、只读态不渲染 */
describe('IKFCKN 文本附件进参考栏', () => {
  const ATT_A: ImageTextAttachment = { nodeId: 'text-a', title: '风格要求', text: '赛博朋克，霓虹灯' };
  const ATT_B: ImageTextAttachment = { nodeId: 'text-b', title: '姿势说明', text: '站立微笑' };

  it('点击文本缩略图 @ 按钮与手动 @ 选择产出同一种标签：无记忆光标追加末尾、绑定 text_ref', async () => {
    const { onParamsChange } = await renderDialog({ mediaRefs: [REF_A], attachments: [ATT_A, ATT_B] });
    await typePromptRefRaw(container, '让');
    const atBtns = [...container.querySelectorAll<HTMLButtonElement>('[data-testid="dock-text-ref"] button[title="插入引用"]')];
    expect(atBtns).toHaveLength(2);
    await act(async () => {
      atBtns[1].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    // 无记忆光标追加末尾：产出「文本2」标签（第二项附件）
    expect(readPromptRefText(container)).toBe('让文本2');
    // 与手动 @ 选择同一种 chip：text_ref 绑定来源节点 id
    const patch = onParamsChange.mock.calls.filter((c) => c[0]?.promptDoc !== undefined).pop()?.[0];
    expect(patch.promptDoc.segments).toEqual([
      { kind: 'text', text: '让' },
      { kind: 'text_ref', node_id: 'text-b', label: '文本2' },
    ]);
  });

  it('点击文本缩略图 × ：仅断开当前连线（onRemoveAttachment 携带来源节点 id），无确认弹窗', async () => {
    const onRemoveAttachment = vi.fn();
    await renderDialog({ attachments: [ATT_A, ATT_B], onRemoveAttachment });
    const removeBtns = [...container.querySelectorAll<HTMLButtonElement>('[data-testid="dock-text-ref"] button[title="移除"]')];
    expect(removeBtns).toHaveLength(2);
    await act(async () => {
      removeBtns[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onRemoveAttachment).toHaveBeenCalledTimes(1);
    expect(onRemoveAttachment).toHaveBeenCalledWith('text-a');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('草稿绑定（连线）模式下文本缩略图与媒体缩略图同排渲染、编号独立派生', async () => {
    await renderDialog({ mediaRefs: [REF_A, REF_B], attachments: [ATT_A] });
    const row = [...container.querySelectorAll('[data-testid="dock-media-ref"], [data-testid="dock-text-ref"]')];
    expect(row.map((el) => el.getAttribute('data-testid'))).toEqual(['dock-media-ref', 'dock-media-ref', 'dock-text-ref']);
    // 媒体编号（1/2）与文本编号（1）独立派生
    expect(row[0].querySelector('[data-testid="ref-thumb-badge"]')?.textContent).toBe('1');
    expect(row[1].querySelector('[data-testid="ref-thumb-badge"]')?.textContent).toBe('2');
    expect(row[2].querySelector('[data-testid="ref-thumb-badge"]')?.textContent).toBe('1');
  });

  it('生成中只读：文本缩略图保留，× 与 @ 均不渲染', async () => {
    await renderDialog({ attachments: [ATT_A], draftStatus: 'generating' });
    expect(container.querySelector('[data-testid="dock-text-ref"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="dock-text-ref"] button[title="移除"]')).toBeNull();
    expect(container.querySelector('[data-testid="dock-text-ref"] button[title="插入引用"]')).toBeNull();
  });
});

/* IKFCKK：附件条共享缩略图集成——× 走既有断开连线链路、@ 与手动 @ 选择产出同一素材标签 */
describe('IKFCKK 附件条三态集成', () => {
  it('点击 × 立即删除：仅断开当前引用（onRemoveMediaRef 携带来源节点），无确认弹窗', async () => {
    const onRemoveMediaRef = vi.fn();
    await renderDialog({ mediaRefs: [REF_A, REF_B], onRemoveMediaRef });
    const removeBtns = [...container.querySelectorAll<HTMLButtonElement>('[data-testid="dock-media-ref"] button[title="移除"]')];
    expect(removeBtns).toHaveLength(2);
    await act(async () => {
      removeBtns[1].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onRemoveMediaRef).toHaveBeenCalledTimes(1);
    expect(onRemoveMediaRef).toHaveBeenCalledWith('nb');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('点击 @ 按钮与手动 @ 选择产出同一种素材标签：无记忆光标追加末尾、光标落在标签后', async () => {
    const { onParamsChange } = await renderDialog({ mediaRefs: [REF_A, REF_B] });
    await typePromptRefRaw(container, '让');
    const atBtn = container.querySelector<HTMLButtonElement>('[data-testid="dock-media-ref"] button[title="插入引用"]')!;
    await act(async () => {
      atBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(readPromptRefText(container)).toBe('让图片1');
    // 插入后光标落在标签之后：继续输入接在其后
    await typePromptRefRaw(container, '微笑');
    expect(readPromptRefText(container)).toBe('让图片1微笑');
    // 与手动 @ 选择同一种 chip：草稿同步的结构化正文一致（asset_ref 绑定 101）
    const patch = onParamsChange.mock.calls.filter((c) => c[0]?.promptDoc !== undefined).pop()?.[0];
    expect(patch.promptDoc.segments).toEqual([
      { kind: 'text', text: '让' },
      { kind: 'asset_ref', asset_id: '101', label: '图片1' },
      { kind: 'text', text: '微笑' },
    ]);
  });

  it('生成中只读：缩略图保留，× 与 @ 均不渲染', async () => {
    await renderDialog({ mediaRefs: [REF_A], draftStatus: 'generating' });
    expect(container.querySelector('[data-testid="dock-media-ref"] img')).toBeTruthy();
    expect(container.querySelector('[data-testid="dock-media-ref"] button[title="移除"]')).toBeNull();
    expect(container.querySelector('[data-testid="dock-media-ref"] button[title="插入引用"]')).toBeNull();
  });

  it('IKFXOR Esc 取消 @ 菜单：菜单关闭、焦点回编辑器、光标落 @ 后可继续打字', async () => {
    await renderDialog({ mediaRefs: [REF_A] });
    await typePromptRefRaw(container, '让@猫');
    await vi.waitFor(() => expect(container.querySelector('[data-testid="mention-menu"]')).toBeTruthy());
    const editor = promptRefEditorInstance(container);
    const focusSpy = vi.spyOn(editor, 'focus');
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    await vi.waitFor(() => expect(container.querySelector('[data-testid="mention-menu"]')).toBeNull());
    expect(focusSpy).toHaveBeenCalledTimes(1);
    // 光标落在「@猫」之后（@ 保留）：Lexical 选区恢复随 focus 提交异步写回
    await vi.waitFor(() => expect(promptRefCaretOffset(container)).toBe(3));
    await act(async () => {
      editor.update(() => {
        const sel = $getSelection();
        if ($isRangeSelection(sel)) sel.insertRawText('!');
      });
    });
    expect(readPromptRefText(container)).toBe('让@猫!');
  });

  it('IKFXOR 点菜单外关闭：维持现状不抢编辑器焦点', async () => {
    await renderDialog({ mediaRefs: [REF_A] });
    await typePromptRefRaw(container, '让@猫');
    await vi.waitFor(() => expect(container.querySelector('[data-testid="mention-menu"]')).toBeTruthy());
    const editor = promptRefEditorInstance(container);
    const focusSpy = vi.spyOn(editor, 'focus');
    await act(async () => document.body.dispatchEvent(new Event('pointerdown')));
    await vi.waitFor(() => expect(container.querySelector('[data-testid="mention-menu"]')).toBeNull());
    expect(focusSpy).not.toHaveBeenCalled();
    // @ 查询保留为普通文本
    expect(readPromptRefText(container)).toBe('让@猫');
  });
});
