import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $createRangeSelection,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $nodesOfType,
  $setSelection,
  CLICK_COMMAND,
  CLEAR_HISTORY_COMMAND,
  COMMAND_PRIORITY_HIGH,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  type LexicalCommand,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
} from 'lexical';
import { reconcilePromptDocWith, type PromptDoc, type PromptRefKey } from '@/lib/prompt-doc';
import { $createAssetRefNode, $isAssetRefNode, AssetRefNode, PromptRefContext, type AssetRefMeta } from './AssetRefNode';
import { $applyReconciledRefs, $buildFromPromptDoc, $readPromptDoc, $restoreMentionSelection, matchMentionQuery } from './promptRefDoc';
import styles from './index.module.css';

export interface MentionState {
  open: boolean;
  query: string;
}

export interface PromptRefEditorHandle {
  insertRefAtMention: (key: PromptRefKey) => void;
  consumeMentionForPendingInsert: () => void;
  insertRefAtPending: (key: PromptRefKey, atCurrentSelection?: boolean) => void;
  dismissMention: (restoreFocus?: boolean) => void;
  replaceRefAt: (nodeKey: string, key: PromptRefKey) => void;
  clear: () => void;
}

interface PromptRefEditorProps {
  initialDoc?: PromptDoc | null;
  initialText?: string;
  placeholder?: string;
  readOnly?: boolean;
  labelOf: (key: PromptRefKey) => string | null;
  reconcileKey: string;
  labels: ReadonlyMap<string, string>;
  refsMeta: ReadonlyMap<string, AssetRefMeta>;
  onChange: (doc: PromptDoc) => void;
  onMentionChange?: (state: MentionState) => void;
  onInvalidTagClick?: (nodeKey: string) => void;
  onMentionKey?: (key: 'down' | 'up' | 'enter' | 'escape') => boolean;
  className?: string;
}

function onError(error: Error) {
  console.error('[PromptRefEditor]', error);
}

function EditorRefBridge({ editorRef }: { editorRef: React.MutableRefObject<LexicalEditor | null> }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    editorRef.current = editor;
    const root = editor.getRootElement() as (HTMLElement & { __promptRefEditor?: LexicalEditor }) | null;
    if (root) root.__promptRefEditor = editor;
    return () => {
      editorRef.current = null;
      if (root) delete root.__promptRefEditor;
    };
  }, [editor, editorRef]);
  return null;
}

function EditablePlugin({ readOnly }: { readOnly?: boolean }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);
  return null;
}

function MentionPlugin({
  onMentionChange,
  mentionAnchorRef,
}: {
  onMentionChange?: (state: MentionState) => void;
  mentionAnchorRef: React.MutableRefObject<{ key: NodeKey; offset: number; query: string } | null>;
}) {
  const [editor] = useLexicalComposerContext();
  const openRef = useRef(false);
  useEffect(() => {
    const notify = (state: MentionState) => {
      if (state.open === openRef.current && state.open && state.query === mentionAnchorRef.current?.query) return;
      openRef.current = state.open;
      onMentionChange?.(state);
    };
    return editor.registerUpdateListener(({ editorState, prevEditorState, tags }) => {
      if (tags.has('prompt-ref-reconcile')) return;
      editorState.read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed() || !editor.isEditable()) {
          if (openRef.current) { mentionAnchorRef.current = null; notify({ open: false, query: '' }); }
          return;
        }
        const anchor = selection.anchor;
        const node = anchor.getNode();
        if (anchor.type !== 'text' || !$getNodeByKey(node.getKey())) {
          if (openRef.current) { mentionAnchorRef.current = null; notify({ open: false, query: '' }); }
          return;
        }
        const before = node.getTextContent().slice(0, anchor.offset);
        const match = matchMentionQuery(before);
        if (match) {
          const offset = anchor.offset - match.query.length - 1;
          const current = mentionAnchorRef.current;
          const continuing = current?.key === node.getKey() && current.offset === offset;
          if (!continuing) {
            const text = node.getTextContent();
            const previous = prevEditorState.read(() => $getNodeByKey(node.getKey())?.getTextContent() ?? '');
            let start = 0;
            while (start < previous.length && start < text.length && previous[start] === text[start]) start++;
            let end = text.length;
            let previousEnd = previous.length;
            while (end > start && previousEnd > start && text[end - 1] === previous[previousEnd - 1]) {
              end--;
              previousEnd--;
            }
            if (offset < start || offset >= end) return;
          }
          mentionAnchorRef.current = { key: node.getKey(), offset, query: match.query };
          openRef.current = true;
          onMentionChange?.({ open: true, query: match.query });
        } else if (openRef.current) {
          mentionAnchorRef.current = null;
          notify({ open: false, query: '' });
        }
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, onMentionChange]);
  return null;
}

function ReconcilePlugin({ labelOf, reconcileKey }: { labelOf: (key: PromptRefKey) => string | null; reconcileKey: string }) {
  const [editor] = useLexicalComposerContext();
  const labelOfRef = useRef(labelOf);
  labelOfRef.current = labelOf;
  useEffect(() => {
    editor.update(() => {
      const { doc, changed } = reconcilePromptDocWith($readPromptDoc(), (key) => labelOfRef.current(key));
      if (changed) $applyReconciledRefs($nodesOfType(AssetRefNode), doc.segments);
    }, { tag: 'prompt-ref-reconcile' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, reconcileKey]);
  return null;
}

function MentionKeyPlugin({ onMentionKey }: { onMentionKey?: (key: 'down' | 'up' | 'enter' | 'escape') => boolean }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    if (!onMentionKey) return;
    const bind = <T,>(command: LexicalCommand<T>, key: 'down' | 'up' | 'enter' | 'escape') =>
      editor.registerCommand(command, (event: T) => {
        if (!onMentionKey(key)) return false;
        (event as KeyboardEvent | null)?.preventDefault();
        return true;
      }, COMMAND_PRIORITY_HIGH);
    const unbinds = [
      bind(KEY_ARROW_DOWN_COMMAND, 'down'),
      bind(KEY_ARROW_UP_COMMAND, 'up'),
      bind(KEY_ENTER_COMMAND, 'enter'),
      bind(KEY_ESCAPE_COMMAND, 'escape'),
    ];
    return () => unbinds.forEach((unbind) => unbind());
  }, [editor, onMentionKey]);
  return null;
}

function BackspaceRefPlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    return editor.registerCommand(
      KEY_BACKSPACE_COMMAND,
      (event) => {
        let deleted = false;
        editor.update(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;
          const anchor = selection.anchor;
          if (anchor.type === 'text' && anchor.offset > 0) return;
          const prev = anchor.getNode().getPreviousSibling();
          if ($isAssetRefNode(prev)) {
            prev.remove();
            deleted = true;
          }
        });
        if (!deleted) return false;
        event?.preventDefault();
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor]);
  return null;
}

function RefCursorNavPlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    const $collapseTo = (node: LexicalNode, offset: number, type: 'text' | 'node' | 'element') => {
      const sel = $createRangeSelection();
      sel.anchor.set(node.getKey(), offset, type as 'text' | 'element');
      sel.focus.set(node.getKey(), offset, type as 'text' | 'element');
      $setSelection(sel);
    };
    const $placeBefore = (ref: AssetRefNode) => {
      const prev = ref.getPreviousSibling();
      if (prev && $isTextNode(prev)) $collapseTo(prev, prev.getTextContentSize(), 'text');
      else if (prev) $collapseTo(prev, 0, 'node');
      else {
        const parent = ref.getParent();
        if (parent) $collapseTo(parent, 0, 'element');
      }
    };
    const $placeAfter = (ref: AssetRefNode) => {
      const next = ref.getNextSibling();
      if (next && $isTextNode(next)) $collapseTo(next, 0, 'text');
      else if (next) $collapseTo(next, 0, 'node');
      else {
        const parent = ref.getParent();
        if (parent) $collapseTo(parent, parent.getChildrenSize(), 'element');
      }
    };
    const $collapsedAnchorRef = (): AssetRefNode | null => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
      const node = selection.anchor.getNode();
      return $isAssetRefNode(node) ? node : null;
    };
    const $moveAcross = (event: KeyboardEvent, direction: 'before' | 'after'): boolean => {
      let handled = false;
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;
        const anchor = selection.anchor;
        const node = anchor.getNode();
        const onRef = $isAssetRefNode(node);
        const ref = onRef
          ? node
          : $isTextNode(node) &&
              (direction === 'after' ? anchor.offset >= node.getTextContentSize() : anchor.offset <= 0)
            ? ((direction === 'after' ? node.getNextSibling() : node.getPreviousSibling()) as AssetRefNode | null)
            : null;
        if (!$isAssetRefNode(ref)) return;
        if (direction === 'after') $placeAfter(ref);
        else $placeBefore(ref);
        handled = true;
      });
      if (!handled) return false;
      event?.preventDefault();
      return true;
    };
    const unbinds = [
      editor.registerCommand(KEY_ARROW_RIGHT_COMMAND, (event: KeyboardEvent) => $moveAcross(event, 'after'), COMMAND_PRIORITY_HIGH),
      editor.registerCommand(KEY_ARROW_LEFT_COMMAND, (event: KeyboardEvent) => $moveAcross(event, 'before'), COMMAND_PRIORITY_HIGH),
      editor.registerCommand(CLICK_COMMAND, (event: MouseEvent) => {
        const target = event.target as HTMLElement | null;
        if (!target || !target.closest('span[data-lexical-decorator]')) return false;
        let handled = false;
        editor.update(() => {
          const ref = $collapsedAnchorRef();
          if (!ref) return;
          const hostEl = editor.getElementByKey(ref.getKey());
          const rect = hostEl?.getBoundingClientRect();
          const before = !rect || event.clientX < rect.left + rect.width / 2;
          if (before) $placeBefore(ref);
          else $placeAfter(ref);
          handled = true;
        });
        return handled;
      }, COMMAND_PRIORITY_HIGH),
    ];
    return () => unbinds.forEach((unbind) => unbind());
  }, [editor]);
  return null;
}

const PromptRefEditor = forwardRef<PromptRefEditorHandle, PromptRefEditorProps>(function PromptRefEditor(
  { initialDoc, initialText, placeholder, readOnly, labelOf, reconcileKey, labels, refsMeta, onChange, onMentionChange, onInvalidTagClick, onMentionKey, className },
  ref,
) {
  const editorRef = useRef<LexicalEditor | null>(null);
  const mentionAnchorRef = useRef<{ key: NodeKey; offset: number; query: string } | null>(null);
  const pendingInsertRef = useRef<{ key: NodeKey; offset: number } | null>(null);
  const labelsRef = useRef(labels);
  labelsRef.current = labels;
  const labelOfCurrent = (key: PromptRefKey): string | undefined => labelsRef.current.get(key.id);

  useImperativeHandle(ref, () => ({
    insertRefAtMention: (key: PromptRefKey) => {
      const editor = editorRef.current;
      const anchor = mentionAnchorRef.current;
      if (!editor || !anchor) return;
      const label = labelOfCurrent(key);
      editor.update(() => {
        if (!$getNodeByKey(anchor.key)) return;
        $restoreMentionSelection(anchor)?.insertNodes([
          $createAssetRefNode(key.id, label, undefined, key.kind === 'text_ref' ? 'text' : 'asset'),
        ]);
      }, {
        onUpdate: () => editor.focus(),
      });
      mentionAnchorRef.current = null;
      onMentionChange?.({ open: false, query: '' });
    },
    consumeMentionForPendingInsert: () => {
      const editor = editorRef.current;
      const anchor = mentionAnchorRef.current;
      pendingInsertRef.current = null;
      if (!editor) return;
      if (anchor) {
        editor.update(() => {
          if (!$getNodeByKey(anchor.key)) return;
          const sel = $restoreMentionSelection(anchor);
          if (!sel) return;
          sel.removeText();
          const collapsed = $getSelection();
          if ($isRangeSelection(collapsed) && collapsed.isCollapsed()) {
            pendingInsertRef.current = { key: collapsed.anchor.key, offset: collapsed.anchor.offset };
          }
        }, { discrete: true });
      }
      mentionAnchorRef.current = null;
      onMentionChange?.({ open: false, query: '' });
    },
    insertRefAtPending: (key: PromptRefKey, atCurrentSelection = false) => {
      const editor = editorRef.current;
      const point = pendingInsertRef.current;
      pendingInsertRef.current = null;
      if (!editor) return;
      const label = labelOfCurrent(key);
      editor.update(() => {
        const node = $createAssetRefNode(key.id, label, undefined, key.kind === 'text_ref' ? 'text' : 'asset');
        let inserted = false;
        if (point && $getNodeByKey(point.key)) {
          try {
            const selection = $createRangeSelection();
            selection.anchor.set(point.key, point.offset, 'text');
            selection.focus.set(point.key, point.offset, 'text');
            $setSelection(selection);
            const sel = $getSelection();
            if ($isRangeSelection(sel)) {
              sel.insertNodes([node]);
              inserted = true;
            }
          } catch {
            inserted = false;
          }
        }
        if (!inserted && !point && atCurrentSelection) {
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            selection.insertNodes([node]);
            inserted = true;
          }
        }
        if (!inserted) {
          $getRoot().selectEnd();
          const sel = $getSelection();
          if ($isRangeSelection(sel)) sel.insertNodes([node]);
        }
      }, {
        onUpdate: () => editor.focus(),
      });
    },
    dismissMention: (restoreFocus = false) => {
      const editor = editorRef.current;
      mentionAnchorRef.current = null;
      pendingInsertRef.current = null;
      if (restoreFocus && editor) {
        editor.focus();
      }
      onMentionChange?.({ open: false, query: '' });
    },
    replaceRefAt: (nodeKey: string, key: PromptRefKey) => {
      const editor = editorRef.current;
      if (!editor) return;
      const label = labelOfCurrent(key);
      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if (!$isAssetRefNode(node)) return;
        node.setAssetId(key.id);
        node.setRefKind(key.kind === 'text_ref' ? 'text' : 'asset');
        if (label !== undefined) node.setLabel(label);
        node.setInvalidLabel(undefined);
      });
    },
    clear: () => {
      const editor = editorRef.current;
      if (!editor) return;
      mentionAnchorRef.current = null;
      pendingInsertRef.current = null;
      editor.update(() => {
        $buildFromPromptDoc(null, '');
      }, { onUpdate: () => editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined) });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [onMentionChange]);

  const contextValue = useMemo(
    () => ({ labels, meta: refsMeta, readOnly: readOnly === true, onInvalidTagClick }),
    [labels, refsMeta, readOnly, onInvalidTagClick],
  );

  const initialConfig = {
    namespace: 'prompt-ref-editor',
    nodes: [AssetRefNode],
    onError,
    theme: {},
    editorState: () => $buildFromPromptDoc(initialDoc ?? null, initialText ?? ''),
  };

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <EditorRefBridge editorRef={editorRef} />
      <EditablePlugin readOnly={readOnly} />
      <MentionPlugin onMentionChange={onMentionChange} mentionAnchorRef={mentionAnchorRef} />
      <MentionKeyPlugin onMentionKey={onMentionKey} />
      <BackspaceRefPlugin />
      <RefCursorNavPlugin />
      <ReconcilePlugin labelOf={labelOf} reconcileKey={reconcileKey} />
      <HistoryPlugin />
      <OnChangePlugin
        onChange={(editorState) => {
          editorState.read(() => {
            onChange($readPromptDoc());
          });
        }}
      />
      <PromptRefContext.Provider value={contextValue}>
        <div className={styles.editorWrapper}>
          <PlainTextPlugin
            contentEditable={
              <ContentEditable
                className={`${styles.editable} ${className ?? ''}`}
                aria-placeholder={placeholder ?? ''}
                placeholder={<span className={styles.placeholder}>{placeholder}</span>}
              />
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
        </div>
      </PromptRefContext.Provider>
    </LexicalComposer>
  );
});

export default PromptRefEditor;
