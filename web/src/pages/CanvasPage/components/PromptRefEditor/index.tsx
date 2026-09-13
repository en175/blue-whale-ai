/* ============================================
 * PromptRefEditor：生图正文素材标签编辑器（IKFA1M）
 *
 * 底层 Lexical（PlainTextPlugin + AssetRefNode），与 ChipTextEditor 同族但语义不同：
 * 标签只有稳定身份（assetId），编号由 PromptRefContext 按当前有效输入实时派生；
 * 出口始终是结构化 PromptDoc（onChange），拍平与编译都在调用方/服务端。
 * @ 检测：光标前文本末尾命中「@query」时通过 onMentionChange 上报，
 * 菜单由调用方渲染；insertRefAtMention 把本次查询原位替换为素材标签。
 * ============================================ */
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
  $nodesOfType,
  $setSelection,
  CLEAR_HISTORY_COMMAND,
  COMMAND_PRIORITY_HIGH,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  type LexicalCommand,
  type LexicalEditor,
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
  /** 已引用项：把本次 @ 查询原位替换为指定素材的标签；无进行中的查询时不动作 */
  insertRefAtMention: (key: PromptRefKey) => void;
  /** 添加新参考入口：删除本次 @ 查询并记住插入点（新参考添加成功后由 insertRefAtPending 落标签） */
  consumeMentionForPendingInsert: () => void;
  /** 新参考添加成功后：在记住的插入点插入标签；插入点失效时退化为追加到末尾，不丢引用 */
  insertRefAtPending: (key: PromptRefKey) => void;
  /** 放弃本次 @ 查询（保留已输入的 @ 文本） */
  dismissMention: () => void;
  /** 替换失效提及（IKFA1N B5）：把指定节点换绑为其他已引用素材，仅该处提及变化 */
  replaceRefAt: (nodeKey: string, key: PromptRefKey) => void;
  /** 清空全部内容（发送后调用） */
  clear: () => void;
}

interface PromptRefEditorProps {
  /** 结构化初始内容（草稿恢复）；与 initialText 二选一，结构优先 */
  initialDoc?: PromptDoc | null;
  /** 纯文本初始内容（旧草稿/重新编辑带入） */
  initialText?: string;
  placeholder?: string;
  readOnly?: boolean;
  /** 标签有效性判定（reconcile 用）：返回 null 表示该身份当前失效。
   *  按寻址键分派（IKFA1P）：图片 = 身份在最终 input_asset_ids；视频 = 身份在参考集合
   *  且当前模式接受（IKFA1O）；文本 = 来源节点在当前文本附件集合（IKFA1P） */
  labelOf: (key: PromptRefKey) => string | null;
  /** labelOf 结果的稳定键（身份序列）：变化时触发 reconcile 重派生 */
  reconcileKey: string;
  /** 展示文案：身份 → 标签文案（图片N/视频N/首帧/文本N 等；与附件区/菜单/服务端编译同一映射） */
  labels: ReadonlyMap<string, string>;
  /** 素材元信息（缩略图/名称/媒体类型）；文本项 name=来源节点标题、mediaType='text' */
  refsMeta: ReadonlyMap<string, AssetRefMeta>;
  onChange: (doc: PromptDoc) => void;
  onMentionChange?: (state: MentionState) => void;
  /** 点击失效标签（IKFA1N）：交由调用方打开替换菜单，选中后经 replaceRefAt 换绑 */
  onInvalidTagClick?: (nodeKey: string) => void;
  /** @ 菜单键盘导航：菜单打开时返回 true 消费按键（ArrowUp/Down/Enter/Escape） */
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
    // 测试接缝：jsdom 无法驱动 contentEditable 输入，测试经根元素上的实例直接 editor.update
    const root = editor.getRootElement() as (HTMLElement & { __promptRefEditor?: LexicalEditor }) | null;
    if (root) root.__promptRefEditor = editor;
    return () => {
      editorRef.current = null;
      if (root) delete root.__promptRefEditor;
    };
  }, [editor, editorRef]);
  return null;
}

/** 只读开关（生成中参数冻结） */
function EditablePlugin({ readOnly }: { readOnly?: boolean }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);
  return null;
}

/** @ 查询检测：光标为折叠 Range 且落在文本节点时，取光标前文本做末尾匹配。
 *  命中 → 记录锚点（@ 所在节点 key 与偏移）并上报；失配 → 关闭。 */
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
    return editor.registerUpdateListener(({ editorState, tags }) => {
      // 编号重派生/初始化等非编辑更新不重新检测（避免覆盖刚插入标签后的状态）
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

/** 文案重派生与失效标记：有效标签集合变化时，把 reconcile 结果写回标签节点
 *  （IKFA1O 泛化 + IKFA1P 按寻址键分派媒体/文本） */
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

/** @ 菜单键盘导航（菜单打开时由调用方消费按键） */
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
        // 恢复「@query」的选择范围并原位替换为标签，保留前后文字与段落
        $restoreMentionSelection(anchor)?.insertNodes([
          $createAssetRefNode(key.id, label, undefined, key.kind === 'text_ref' ? 'text' : 'asset'),
        ]);
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
          // 删除后光标折叠在原 @ 位置，记住插入点等添加成功
          const collapsed = $getSelection();
          if ($isRangeSelection(collapsed) && collapsed.isCollapsed()) {
            pendingInsertRef.current = { key: collapsed.anchor.key, offset: collapsed.anchor.offset };
          }
        }, { discrete: true });
      }
      mentionAnchorRef.current = null;
      onMentionChange?.({ open: false, query: '' });
    },
    insertRefAtPending: (key: PromptRefKey) => {
      const editor = editorRef.current;
      const point = pendingInsertRef.current;
      pendingInsertRef.current = null;
      if (!editor) return;
      const label = labelOfCurrent(key);
      editor.update(() => {
        // 节点构造必须在 editor.update 内同步执行（Lexical 约束）
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
        if (!inserted) {
          // 插入点已失效（期间文本被改动）：退化为追加到末尾，不丢引用
          $getRoot().selectEnd();
          const sel = $getSelection();
          if ($isRangeSelection(sel)) sel.insertNodes([node]);
        }
      }, {
        // 插入后编辑器聚焦、光标落在插入内容之后（IKFCKK：@ 按钮插入不打断输入节奏）；
        // focus 须在本次 update 提交后调用（提交前调用会被 pending 队列吞掉，焦点不落 DOM）
        onUpdate: () => editor.focus(),
      });
    },
    dismissMention: () => {
      mentionAnchorRef.current = null;
      pendingInsertRef.current = null;
      onMentionChange?.({ open: false, query: '' });
    },
    replaceRefAt: (nodeKey: string, key: PromptRefKey) => {
      const editor = editorRef.current;
      if (!editor) return;
      const label = labelOfCurrent(key);
      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if (!$isAssetRefNode(node)) return;
        // 换绑身份与身份类型（IKFA1P：文本/媒体可互替，仅该处提及变化）
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
