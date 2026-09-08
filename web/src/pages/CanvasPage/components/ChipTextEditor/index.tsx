/* ============================================
 * ChipTextEditor：可多次插入引用胶囊的富文本输入框
 * 胶囊跟输入文字同一行、自动换行；胶囊是原子节点，退格整体删除；
 * 发送时把每个胶囊替换成完整 prompt，跟普通输入文字拼接成一段话。
 * 底层用 Lexical（PlainTextPlugin + 自定义 ChipNode DecoratorNode），
 * 原生 contentEditable 手搓在中文输入法组合事件上风险太高，交给成熟方案。
 * ============================================ */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $createParagraphNode,
  $createTextNode,
  $createRangeSelection,
  $getRoot,
  $getSelection,
  $getNodeByKey,
  $nodesOfType,
  $isRangeSelection,
  $setSelection,
  $isElementNode,
  COMMAND_PRIORITY_LOW,
  KEY_ENTER_COMMAND,
  SKIP_DOM_SELECTION_TAG,
  HISTORIC_TAG,
  HISTORY_PUSH_TAG,
  CLEAR_HISTORY_COMMAND,
  type RangeSelection,
  type NodeKey,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical';
import { ChipNode, $createChipNode } from './ChipNode';
import { type ComposedValue } from './composed';
import { readComposed } from './readComposed';
import styles from './index.module.css';

export interface ChipRef {
  /** 引用唯一标识（同一张卡多次引用允许重复插入，仅用于 React key 去重非必需） */
  id: string;
  /** 胶囊显示的短标签，如「镜头 4 · 英雄收尾」 */
  label: string;
  /** 发送时替换胶囊位置的完整内容 */
  prompt: string;
  /** 画布图片提及的原图地址。有值时渲染缩略图胶囊（小图）+ 悬浮大图，与对话历史一致。 */
  imageUrl?: string;
  /** 画布独立视频节点的原片地址。有值时渲染缩略图胶囊 + 悬浮静音预览。 */
  videoUrl?: string;
  /** 音频原片地址，悬浮后由用户主动播放。 */
  audioUrl?: string;
}

export interface ChipTextEditorHandle {
  /** 在末尾追加一个引用胶囊（不覆盖已有内容/已有胶囊，可多次调用叠加） */
  insertChip: (chip: ChipRef) => void;
  /** 用纯文本整体替换当前内容（旧版 @ 引用预填文案走这个，非生成卡场景） */
  setText: (text: string) => void;
  /** 清空全部内容（发送后调用） */
  clear: () => void;
  /** 捕获本次提交内容，成功后仅移除这些节点，保留等待期间的新输入。 */
  captureSubmission: () => () => void;
  focus: () => void;
}

interface ChipTextEditorProps {
  placeholder: string;
  /**
   * 每次内容变化，给出**结构化**的内容：纯文字与引用交替的片段序列。
   *
   * 刻意不再给拍扁的字符串（IKAFSX）：胶囊在编辑期是指针，解引用只发生在提交那一刻，
   * 由调用方自己在 send 时调 `resolveComposed`。字数统计、禁用态判断都从片段派生。
   */
  onChange: (value: ComposedValue) => void;
  /** 不提供时 Enter 仅换行，发送由外部按钮触发。 */
  onSend?: () => void;
  className?: string;
  /** 只读（IKDMQS）：生成中草稿参数冻结，编辑器不可输入、Enter 不发送 */
  readOnly?: boolean;
  pendingChip?: ChipRef | null;
  /** 异步准备成功后才确认；返回 null 保留候选与已有输入。 */
  onPreparePending?: () => Promise<ChipRef | null>;
  onConfirmPending?: () => void;
  onCancelPending?: () => void;
}

function onError(error: Error) {
  console.error('[ChipTextEditor]', error);
}

/** 把外部按钮触发的「插入胶囊」桥接进 Lexical editor 实例 */
function EditorRefBridge({ editorRef }: { editorRef: React.MutableRefObject<LexicalEditor | null> }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    editorRef.current = editor;
    return () => {
      editorRef.current = null;
    };
  }, [editor, editorRef]);
  return null;
}

/** Enter 发送 / Shift+Enter 换行：跟原生 textarea 的既有约定保持一致 */
function EnterKeyPlugin({ onSend, readOnly }: { onSend?: () => void; readOnly?: boolean }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    return editor.registerCommand<KeyboardEvent | null>(
      KEY_ENTER_COMMAND,
      (event) => {
        if (!onSend || event?.shiftKey) return false;
        if (readOnly) return true; // 只读：吞掉 Enter 但不发送
        event?.preventDefault();
        onSend();
        return true;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor, onSend, readOnly]);
  return null;
}

/** 只读开关（IKDMQS）：editor.setEditable 控制内容编辑能力 */
function EditablePlugin({ readOnly }: { readOnly?: boolean }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);
  return null;
}

const ChipTextEditor = forwardRef<ChipTextEditorHandle, ChipTextEditorProps>(function ChipTextEditor(
  { placeholder, onChange, onSend, className, readOnly, pendingChip, onPreparePending, onConfirmPending, onCancelPending },
  ref,
) {
  const editorRef = useRef<LexicalEditor | null>(null);
  const savedSelection = useRef<RangeSelection | null>(null);
  const pendingKey = useRef<NodeKey | null>(null);
  const preparingKey = useRef<NodeKey | null>(null);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    return editor.registerUpdateListener(({ editorState }) => {
      const { stale, missing } = editorState.read(() => ({
        stale: $nodesOfType(ChipNode).filter((node) => node.isPending() && node.getKey() !== pendingKey.current).map((node) => node.getKey()),
        missing: pendingKey.current !== null && !$getNodeByKey(pendingKey.current),
      }));
      // Undo/Redo 只恢复编辑内容，不能复活已经确认或取消的候选。
      if (stale.length) editor.update(() => {
        for (const key of stale) $getNodeByKey(key)?.remove();
      }, { tag: HISTORIC_TAG });
      if (missing) { pendingKey.current = null; onCancelPending?.(); }
    });
  }, [onCancelPending]);

  useEffect(() => {
    const rememberCaret = (event: PointerEvent) => {
      const editor = editorRef.current;
      const root = editor?.getRootElement();
      const selection = window.getSelection();
      if (!editor || !root || root.contains(event.target as Node) || !selection?.rangeCount || !root.contains(selection.anchorNode)) return;
      // 在浏览器改变焦点前读实际 DOM 光标，避免 selectionchange 尚未提交时保存旧位置。
      editor.read(() => {
        const saved = $createRangeSelection();
        saved.applyDOMRange(selection.getRangeAt(0));
        savedSelection.current = saved;
      });
    };
    document.addEventListener('pointerdown', rememberCaret, true);
    return () => document.removeEventListener('pointerdown', rememberCaret, true);
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.update(() => {
      const previous = pendingKey.current ? $getNodeByKey(pendingKey.current) : null;
      if (!pendingChip) {
        if (previous instanceof ChipNode && previous.isPending()) previous.remove();
        pendingKey.current = null;
        return;
      }
      const chip = $createChipNode(pendingChip.id, pendingChip.label, pendingChip.prompt, pendingChip.imageUrl, pendingChip.videoUrl, true, pendingChip.audioUrl);
      if (previous instanceof ChipNode && previous.isPending()) {
        previous.replace(chip);
      } else {
        const selection = savedSelection.current?.clone();
        if (selection && $getNodeByKey(selection.focus.key)?.isAttached()) {
          // 引用插入光标处，不覆盖用户离开前选中的文字。
          selection.anchor.set(selection.focus.key, selection.focus.offset, selection.focus.type);
          $setSelection(selection);
        } else {
          $getRoot().selectEnd();
        }
        const insertion = $getSelection();
        if ($isRangeSelection(insertion)) insertion.insertNodes([chip]);
      }
      pendingKey.current = chip.getKey();
    }, { tag: [SKIP_DOM_SELECTION_TAG, HISTORIC_TAG] });
  }, [pendingChip]);

  const confirmPending = async (event: React.MouseEvent<HTMLDivElement>) => {
    if (!pendingChip || readOnly) return;
    const target = event.target as HTMLElement;
    // 胶囊、移除按钮、悬浮预览不是输入编辑位置。
    if (target.closest('[contenteditable="false"],button')) return;
    const key = pendingKey.current;
    if (!key || preparingKey.current === key) return;
    let prepared = pendingChip;
    if (onPreparePending) {
      preparingKey.current = key;
      try {
        const result = await onPreparePending();
        if (!result || pendingKey.current !== key) return;
        prepared = result;
      } finally {
        if (preparingKey.current === key) preparingKey.current = null;
      }
    }
    let confirmed = false;
    editorRef.current?.update(() => {
      if (pendingKey.current !== key) return;
      const node = $getNodeByKey(key);
      if (!(node instanceof ChipNode) || !node.isPending()) return;
      node.confirm(prepared);
      pendingKey.current = null;
      confirmed = true;
    }, { tag: HISTORY_PUSH_TAG, onUpdate: () => { if (confirmed) onConfirmPending?.(); } });
  };

  useImperativeHandle(ref, () => ({
    insertChip: (chip) => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.update(() => {
        const root = $getRoot();
        const first = root.getFirstChild();
        const paragraph = first && $isElementNode(first) ? first : $createParagraphNode();
        if (paragraph !== first) root.append(paragraph);
        const chipNode = $createChipNode(chip.id, chip.label, chip.prompt, chip.imageUrl, chip.videoUrl, false, chip.audioUrl);
        const spaceNode = $createTextNode(' ');
        paragraph.append(chipNode, spaceNode);
        spaceNode.selectEnd();
      });
      editor.focus();
    },
    setText: (text) => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.update(() => {
        const root = $getRoot();
        root.clear();
        const paragraph = $createParagraphNode();
        if (text) paragraph.append($createTextNode(text));
        root.append(paragraph);
        paragraph.selectEnd();
      });
      editor.focus();
    },
    clear: () => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.update(() => {
        const root = $getRoot();
        root.clear();
        root.append($createParagraphNode());
      }, { onUpdate: () => editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined) });
    },
    captureSubmission: () => {
      const editor = editorRef.current;
      if (!editor) return () => {};
      const keys = editor.read(() => {
        const result: NodeKey[] = [];
        const visit = (node: LexicalNode) => {
          if ($isElementNode(node)) node.getChildren().forEach(visit);
          else result.push(node.getKey());
        };
        visit($getRoot());
        return result;
      });
      return () => editor.update(() => {
        for (const key of keys) $getNodeByKey(key)?.remove();
        const root = $getRoot();
        for (const child of root.getChildren()) {
          if ($isElementNode(child) && child.isEmpty()) child.remove();
        }
        if (root.isEmpty()) root.append($createParagraphNode());
      }, { tag: SKIP_DOM_SELECTION_TAG, onUpdate: () => editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined) });
    },
    focus: () => editorRef.current?.focus(),
  }), []);

  const initialConfig = {
    namespace: 'agent-chip-editor',
    nodes: [ChipNode],
    onError,
    theme: {},
  };

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <EditorRefBridge editorRef={editorRef} />
      <EditablePlugin readOnly={readOnly} />
      <EnterKeyPlugin onSend={onSend} readOnly={readOnly} />
      <HistoryPlugin />
      <OnChangePlugin
        onChange={(editorState) => {
          editorState.read(() => {
            onChange(readComposed());
          });
        }}
      />
      <div className={styles.editorWrapper}>
        <PlainTextPlugin
          contentEditable={<ContentEditable onClick={confirmPending} className={`${styles.editable} ${className ?? ''}`} aria-placeholder={placeholder} placeholder={<span className={styles.placeholder}>{placeholder}</span>} />}
          ErrorBoundary={LexicalErrorBoundary}
        />
      </div>
    </LexicalComposer>
  );
});

export default ChipTextEditor;
