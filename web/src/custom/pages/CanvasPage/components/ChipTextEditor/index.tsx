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
  TextNode,
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
  id: string;
  label: string;
  prompt: string;
  imageUrl?: string;
  videoUrl?: string;
  audioUrl?: string;
}

export interface ChipTextEditorHandle {
  insertChip: (chip: ChipRef) => void;
  setText: (text: string) => void;
  clear: () => void;
  stripTrailingAtQuery: () => void;
  captureSubmission: () => () => void;
  focus: () => void;
}

interface ChipTextEditorProps {
  placeholder: string;
  onChange: (value: ComposedValue) => void;
  onSend?: () => void;
  className?: string;
  readOnly?: boolean;
  pendingChip?: ChipRef | null;
  onPreparePending?: () => Promise<ChipRef | null>;
  onConfirmPending?: () => void;
  onCancelPending?: () => void;
}

function onError(error: Error) {
  console.error('[ChipTextEditor]', error);
}

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

function EnterKeyPlugin({ onSend, readOnly }: { onSend?: () => void; readOnly?: boolean }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    return editor.registerCommand<KeyboardEvent | null>(
      KEY_ENTER_COMMAND,
      (event) => {
        if (!onSend || event?.shiftKey) return false;
        if (readOnly) return true;
        event?.preventDefault();
        onSend();
        return true;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor, onSend, readOnly]);
  return null;
}

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
    stripTrailingAtQuery: () => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.update(() => {
        const nodes = $nodesOfType(TextNode);
        for (let i = nodes.length - 1; i >= 0; i -= 1) {
          const node = nodes[i];
          const text = node.getTextContent();
          const next = text.replace(/@([^\s@]*)$/, '');
          if (next !== text) {
            node.setTextContent(next);
            node.selectEnd();
            return;
          }
          if (text.trim().length > 0) return;
        }
      });
      editor.focus();
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
