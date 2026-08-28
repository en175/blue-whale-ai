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
  $getRoot,
  $isElementNode,
  COMMAND_PRIORITY_LOW,
  KEY_ENTER_COMMAND,
  type LexicalEditor,
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
}

export interface ChipTextEditorHandle {
  /** 在末尾追加一个引用胶囊（不覆盖已有内容/已有胶囊，可多次调用叠加） */
  insertChip: (chip: ChipRef) => void;
  /** 用纯文本整体替换当前内容（旧版 @ 引用预填文案走这个，非生成卡场景） */
  setText: (text: string) => void;
  /** 清空全部内容（发送后调用） */
  clear: () => void;
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
  onSend: () => void;
  className?: string;
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
function EnterKeyPlugin({ onSend }: { onSend: () => void }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    return editor.registerCommand<KeyboardEvent | null>(
      KEY_ENTER_COMMAND,
      (event) => {
        if (event?.shiftKey) return false;
        event?.preventDefault();
        onSend();
        return true;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor, onSend]);
  return null;
}

const ChipTextEditor = forwardRef<ChipTextEditorHandle, ChipTextEditorProps>(function ChipTextEditor(
  { placeholder, onChange, onSend, className },
  ref,
) {
  const editorRef = useRef<LexicalEditor | null>(null);

  useImperativeHandle(ref, () => ({
    insertChip: (chip) => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.update(() => {
        const root = $getRoot();
        const first = root.getFirstChild();
        const paragraph = first && $isElementNode(first) ? first : $createParagraphNode();
        if (paragraph !== first) root.append(paragraph);
        const chipNode = $createChipNode(chip.id, chip.label, chip.prompt, chip.imageUrl);
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
      });
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
      <EnterKeyPlugin onSend={onSend} />
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
          contentEditable={<ContentEditable className={`${styles.editable} ${className ?? ''}`} aria-placeholder={placeholder} placeholder={<span className={styles.placeholder}>{placeholder}</span>} />}
          ErrorBoundary={LexicalErrorBoundary}
        />
      </div>
    </LexicalComposer>
  );
});

export default ChipTextEditor;
