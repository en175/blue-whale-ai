/* ============================================
 * TextNode 文本节点：外置常驻标题 + 固定 360×270 正文容器（内部滚动）
 * IKFM3L 统一正文契约 v1：普通新增、Agent 应用与历史卡共用 Markdown 编辑
 * 与格式工具栏；正文以受限 Markdown 源（data.text）为唯一权威，html 仅存量兼容。
 * ============================================ */
import { useState, useRef, useCallback, useEffect } from 'react';
import { Handle, Position, useStore, type NodeProps } from '@xyflow/react';
import { Bold, Italic, List, ListOrdered, Minus, Heading1, Heading2, Heading3, FileText, AtSign, Plus } from 'lucide-react';
import { sanitizeHtml } from '@/utils/sanitize';
import { nodeTitleSizing } from '../nodeTitleSizing';
import { commitCardName } from '../cardName';
import CanvasContextMenu from '../CanvasContextMenu';
import styles from './index.module.css';
import { PROMPT_TEXT_LIMITS } from '../../../../../../packages/contracts/src/prompt-text-limits';
import { promptMentionSchema, validPromptMentions, type PromptMention, type PromptMaterial } from '../../../../../../packages/contracts/src/prompt-preview';
import { markdownToSanitizedHtml } from '../../../../../../packages/contracts/src/text-node-markdown';
import { renderPromptMentions, readPromptMentions } from './promptMentions';
import { applyMarkdownInputRule } from './markdownInputRules';

/** 文字节点最大字数（按纯文本计，含粘贴） */
const MAX_TEXT_LENGTH = PROMPT_TEXT_LIMITS.text;

/** 连接点统一样式：透明背景（加号图标由 children 渲染） */
const HANDLE_STYLE = { background: 'transparent', border: 'none', width: 24, height: 24 } as const;

/** 加号连接点图标 */
function HandlePlus() {
  return (
    <span className="nodrag nopan" style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 24,
      height: 24,
      borderRadius: '50%',
      background: '#2a2a2a',
      border: '1px solid #555',
      color: '#ccc',
      boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
    }}>
      <Plus size={14} strokeWidth={2.5} />
    </span>
  );
}

interface TextNodeData {
  promptSource?: unknown;
  promptMentions?: PromptMention[];
  promptMaterials?: Array<PromptMaterial & { url: string }>;
  onPromptChange?: (id: string, text: string, mentions: PromptMention[], materials?: Array<PromptMaterial & { url: string }>) => void;
  title?: string;
  onTitleChange?: (id: string, title: string) => void;
  onDraftError?: (id: string, error: string) => void;
  onTextChange?: (id: string, text: string) => void;
  /** 存量兼容：升级前的 HTML 正文，统一后不再写入（契约 §1） */
  html?: string;
  text?: string;
  toolMode?: 'drag' | 'select';
  isFirst?: boolean;
  onDelete?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onAddToChat?: (id: string) => void;
  onSaveToAssets?: (id: string) => void;
  onPaste?: (id: string) => void;
  /** Toast 提示（超字数上限等场景，由父级注入） */
  onToast?: (type: 'success' | 'error' | 'warn', msg: string) => void;
  /** 文本生成节点：身份保持，可被连入，也可自己编写 */
  textGen?: boolean;
  /** 点击「自己编写内容」：进入框内编辑，不打开跟随输入框 */
  onWriteSelf?: (id: string) => void;
}

export default function TextNode({ id, data, selected }: NodeProps & { data: TextNodeData; selected?: boolean }) {
  const hasPromptBindings = Boolean(data.promptSource) || data.promptMentions !== undefined;
  const [contentError, setContentError] = useState('');
  const [titleError, setTitleError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(data.title ?? '文本节点');
  const [isFocused, setIsFocused] = useState(false);
  /** 双击进入编辑；单击/拖动为移动节点。文本生成节点仅「自己编写」进入编辑 */
  const [editing, setEditing] = useState(false);
  const [writingSelf, setWritingSelf] = useState(false);
  const isTextGen = data.textGen === true;
  const hasTextGenBody = Boolean(
    (typeof data.text === 'string' && data.text.trim())
    || (typeof data.html === 'string' && data.html.replace(/<[^>]+>/g, '').trim()),
  );
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const initializedRef = useRef(false);
  const draftMaterialsRef = useRef(data.promptMaterials);
  useEffect(() => { draftMaterialsRef.current = data.promptMaterials; }, [data.promptMaterials]);

  const [selectedMention, setSelectedMention] = useState<number | null>(null);
  const canvasNodes = useStore(state => state.nodes);
  const materialChoices = [...new Map(canvasNodes.filter(node => node.type === 'mediaNode' && node.data.assetId && !node.data.assetMissing && node.data.genStatus !== 'generating'
    && ['image', 'video', 'audio'].includes(String(node.data.mediaType))).map(node => [String(node.data.assetId), {
      assetId: String(node.data.assetId), mediaType: node.data.mediaType as PromptMaterial['mediaType'], url: String(node.data.src ?? ''), name: String(node.data.fileName || node.data.assetId),
    }])).values()];

  const zoom = useStore((state) => state.transform[2]);

  const isSelect = data.toolMode === 'select';

  // 切换到拖动模式时退出编辑状态
  useEffect(() => {
    if (!isSelect) {
      setIsFocused(false);
      setEditing(false);
      editorRef.current?.blur();
    }
  }, [isSelect]);

  // 进入编辑后聚焦编辑器
  useEffect(() => {
    if (editing) editorRef.current?.focus();
  }, [editing]);

  // Keep the complete source, including legacy over-limit content. Never truncate on load.
  useEffect(() => {
    if (!initializedRef.current && editorRef.current) {
      if (typeof data.text === 'string') renderPromptMentions(editorRef.current, data.text, data.promptMentions ?? [], data.promptMaterials ?? []);
      else editorRef.current.innerHTML = sanitizeHtml(data.html || '');
      initializedRef.current = true;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 非编辑态：权威正文变化时按 Markdown 渲染重放（编辑中的 DOM 是权威，不覆盖）
  useEffect(() => {
    if (!editing && !contentError && editorRef.current && typeof data.text === 'string') {
      renderPromptMentions(editorRef.current, data.text, data.promptMentions ?? [], data.promptMaterials ?? []);
    }
  }, [editing, contentError, data.text, data.promptMentions, data.promptMaterials]);

  // 点击其他区域关闭右键菜单（捕获阶段监听，确保右键其他节点时先关闭本菜单）
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener('click', close);
    document.addEventListener('contextmenu', close, true);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('contextmenu', close, true);
    };
  }, [contextMenu]);

  /** 保存当前选区 */
  const saveSelection = useCallback(() => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      if (editorRef.current?.contains(range.commonAncestorContainer)) {
        savedRangeRef.current = range.cloneRange();
      }
    }
  }, []);

  /** 恢复选区 */
  const restoreSelection = useCallback(() => {
    const sel = window.getSelection();
    if (sel && savedRangeRef.current) {
      sel.removeAllRanges();
      sel.addRange(savedRangeRef.current);
    }
  }, []);

  /** 提交标题（IKFA8X）：去空格/空回退/超长拒绝/未变更跳过，细则见 cardName；
   *  名称错误仅就地提示，不进 onDraftError——未写入节点数据的名称草稿不阻断画布保存 */
  const commitTitle = useCallback(() => {
    const current = data.title ?? (isTextGen ? '文本生成' : '文本节点');
    const result = commitCardName(titleDraft, current);
    if (result.kind === 'invalid') {
      setTitleError(result.message);
      return;
    }
    setTitleError('');
    setTitleEditing(false);
    if (result.kind === 'save') data.onTitleChange?.(id, result.value);
  }, [data, id, titleDraft, isTextGen]);

  /** Esc 取消：恢复编辑前名称；输入框随即卸载，不会再有失焦提交 */
  const cancelTitle = useCallback(() => {
    setTitleDraft(data.title ?? (isTextGen ? '文本生成' : '文本节点'));
    setTitleError('');
    setTitleEditing(false);
  }, [data.title, isTextGen]);

  /** 同步内容到父组件：编辑器 DOM 序列化为 Markdown 源（契约 §1 权威正文） */
  const syncContent = useCallback(() => {
    if (!editorRef.current) return;
    const content = readPromptMentions(editorRef.current);
    if (content.text.length > MAX_TEXT_LENGTH) {
      const error = `正文最多 ${MAX_TEXT_LENGTH} 字，当前草稿已保留，请缩短后保存`;
      setContentError(error);
      data.onDraftError?.(id, error);
      return;
    }
    setContentError('');
    data.onDraftError?.(id, '');
    if (hasPromptBindings) data.onPromptChange?.(id, content.text, content.mentions, draftMaterialsRef.current);
    else data.onTextChange?.(id, content.text);
  }, [data, id, hasPromptBindings]);

  const editMaterial = (assetId: string, replaceIndex: number | null) => {
    const editor = editorRef.current;
    const material = materialChoices.find(item => item.assetId === assetId);
    if (!editor || (assetId && !material)) return;
    const materials = [...(draftMaterialsRef.current ?? [])];
    if (material && !materials.some(item => item.assetId === material.assetId)) materials.push({ assetId: material.assetId, mediaType: material.mediaType, url: material.url });
    if (replaceIndex !== null) {
      for (const chip of editor.querySelectorAll<HTMLElement>('[data-prompt-index]')) {
        if (Number(chip.dataset.promptIndex) !== replaceIndex) continue;
        if (!material) chip.remove();
        else chip.dataset.promptAsset = material.assetId;
      }
    } else if (material) {
      editor.focus();
      const range = savedRangeRef.current?.cloneRange() ?? document.createRange();
      if (!editor.contains(range.commonAncestorContainer)) { range.selectNodeContents(editor); range.collapse(false); }
      const current = readPromptMentions(editor);
      const index = Math.max(0, ...current.mentions.map(m => m.index)) + 1;
      const label = `素材#${index}`;
      const fragment = document.createElement('div');
      renderPromptMentions(fragment, label, [{ start: 0, end: label.length, assetId, index }], materials);
      range.deleteContents();
      const chip = fragment.querySelector<HTMLElement>('[data-prompt-asset]')!;
      range.insertNode(chip);
      range.setStartAfter(chip); range.collapse(true);
      savedRangeRef.current = range;
    }
    draftMaterialsRef.current = materials;
    const prompt = readPromptMentions(editor);
    renderPromptMentions(editor, prompt.text, prompt.mentions, materials);
    savedRangeRef.current = null;
    setSelectedMention(null);
    if (prompt.text.length > MAX_TEXT_LENGTH) {
      const error = `正文最多 ${MAX_TEXT_LENGTH} 字，当前草稿已保留，请缩短后保存`;
      setContentError(error); data.onDraftError?.(id, error); return;
    }
    setContentError(''); data.onDraftError?.(id, '');
    data.onPromptChange?.(id, prompt.text, prompt.mentions, materials);
  };

  /** 执行格式化命令 */
  const execCmd = useCallback((cmd: string, value?: string) => {
    editorRef.current?.focus();
    restoreSelection();
    document.execCommand(cmd, false, value);
    saveSelection();
    syncContent();
  }, [restoreSelection, saveSelection, syncContent]);

  /** 设置标题 */
  const setHeading = useCallback((level: string) => {
    editorRef.current?.focus();
    restoreSelection();
    document.execCommand('formatBlock', false, level);
    saveSelection();
    syncContent();
  }, [restoreSelection, saveSelection, syncContent]);

  /** 右键菜单 */
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (data.toolMode !== 'select') return;
    if (editing) return;
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, [data.toolMode, editing]);

  const handleDelete = useCallback(() => {
    setContextMenu(null);
    data.onDelete?.(id);
  }, [data, id]);

  /** 在旁边复制一个相同节点 */
  const handleDuplicate = useCallback(() => {
    setContextMenu(null);
    data.onDuplicate?.(id);
  }, [data, id]);

  /** 添加内容到 Agent 聊天 */
  const handleAddToChat = useCallback(() => {
    setContextMenu(null);
    data.onAddToChat?.(id);
  }, [data, id]);

  /** 保存到共享资产（共享资产概念下线，入口已隐藏） */
  // const handleSaveToAssets = useCallback(() => {
  //   setContextMenu(null);
  //   data.onSaveToAssets?.(id);
  // }, [data, id]);

  /** 编辑器内鼠标抬起时保存选区 */
  const handleEditorMouseUp = useCallback(() => {
    saveSelection();
  }, [saveSelection]);

  const handleCopy = useCallback((e: React.ClipboardEvent, cut = false) => {
    if (!hasPromptBindings || !editorRef.current) return;
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!editorRef.current.contains(range.commonAncestorContainer)) return;
    const fragment = document.createElement('div');
    fragment.append(range.cloneContents());
    const content = readPromptMentions(fragment);
    e.preventDefault();
    e.clipboardData.setData('text/plain', content.text);
    e.clipboardData.setData('application/x-blue-whale-prompt', JSON.stringify({ nodeId: id, ...content }));
    if (cut) { document.execCommand('delete'); syncContent(); }
  }, [hasPromptBindings, id, syncContent]);

  /** Paste Markdown or internal chip content; over-limit drafts remain visible and are not persisted. */
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    let inserted = false;
    if (hasPromptBindings) {
      try {
        const content = JSON.parse(e.clipboardData.getData('application/x-blue-whale-prompt'));
        const mentions = promptMentionSchema.array().safeParse(content.mentions);
        if (content.nodeId === id && typeof content.text === 'string' && mentions.success
          && validPromptMentions(content.text, mentions.data)
          && mentions.data.every(mention => data.promptMaterials?.some(item => item.assetId === mention.assetId))) {
          const fragment = document.createElement('div');
          renderPromptMentions(fragment, content.text, mentions.data, data.promptMaterials ?? []);
          document.execCommand('insertHTML', false, fragment.innerHTML);
          inserted = true;
        }
      } catch { /* External clipboard content is pasted as Markdown. */ }
    }
    if (!inserted) document.execCommand('insertHTML', false, markdownToSanitizedHtml(e.clipboardData.getData('text/plain')));
    saveSelection();
    syncContent();
  }, [saveSelection, syncContent, hasPromptBindings, id, data.promptMaterials]);

  /** 输入后应用 Markdown 语法规则（契约 §2 输入路径），再同步内容 */
  const handleEditorInput = useCallback((e: React.FormEvent<HTMLDivElement>) => {
    const native = e.nativeEvent as InputEvent;
    if (native.inputType === 'insertText' && editorRef.current && native.data) {
      applyMarkdownInputRule(editorRef.current, native.data);
    }
    syncContent();
  }, [syncContent]);

  /** 编辑器键盘操作后保存选区并同步 */
  const handleEditorKeyUp = useCallback(() => {
    saveSelection();
    syncContent();
  }, [saveSelection, syncContent]);

  return (
    <div
      className={`${styles.wrapper} ${selected ? styles.selected : ''} ${isFocused && isSelect ? `${styles.focused} nodrag` : ''}`}
      onContextMenu={handleContextMenu}
      style={nodeTitleSizing(zoom)}
    >
      {/* 同一层操作位置：编辑时是格式工具栏，其余是节点操作条，两者不叠成多行 */}
      {isFocused ? (
        <div
          className={`${styles.toolbar} nodrag nopan`}
          onMouseDown={(e) => e.preventDefault()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button className={styles.toolBtn} onClick={() => setHeading('h1')} title="标题1">
            <Heading1 size={14} strokeWidth={2} />
          </button>
          <button className={styles.toolBtn} onClick={() => setHeading('h2')} title="标题2">
            <Heading2 size={14} strokeWidth={2} />
          </button>
          <button className={styles.toolBtn} onClick={() => setHeading('h3')} title="标题3">
            <Heading3 size={14} strokeWidth={2} />
          </button>

          <div className={styles.divider} />

          <button className={styles.toolBtn} onClick={() => execCmd('bold')} title="加粗">
            <Bold size={14} strokeWidth={2.5} />
          </button>
          <button className={styles.toolBtn} onClick={() => execCmd('italic')} title="斜体">
            <Italic size={14} strokeWidth={2.5} />
          </button>

          <div className={styles.divider} />

          <button className={styles.toolBtn} onClick={() => execCmd('insertOrderedList')} title="有序列表">
            <ListOrdered size={14} strokeWidth={2} />
          </button>
          <button className={styles.toolBtn} onClick={() => execCmd('insertUnorderedList')} title="无序列表">
            <List size={14} strokeWidth={2} />
          </button>

          <div className={styles.divider} />

          <button className={styles.toolBtn} onClick={() => execCmd('insertHorizontalRule')} title="分割线">
            <Minus size={14} strokeWidth={2} />
          </button>

          {/* 编辑时节点操作并入同一层操作位置，保持「添加到对话」可达且不叠成多行 */}
          <div className={styles.divider} />
          <button className={styles.toolBtn} onClick={() => data.onAddToChat?.(id)} title="添加到对话">
            <AtSign size={14} strokeWidth={2} />
            <span>添加到对话</span>
          </button>
        </div>
      ) : (
        <div className={`${styles.nodeBar} ${selected ? styles.nodeBarVisible : ''} nodrag nopan`}>
          {hasPromptBindings && <>
            <select aria-label={selectedMention === null ? '新增素材标签' : `替换素材 #${selectedMention}`}
              className={styles.materialSelect} value="" onPointerDown={event => event.stopPropagation()}
              onMouseDown={() => saveSelection()}
              onChange={event => editMaterial(event.target.value, selectedMention)}>
              <option value="">{selectedMention === null ? '新增素材标签' : `替换素材 #${selectedMention}`}</option>
              {materialChoices.map(material => <option key={material.assetId} value={material.assetId}>{material.name}</option>)}
            </select>
            {selectedMention !== null && <button className={styles.toolBtn} onMouseDown={event => event.preventDefault()} onClick={() => editMaterial('', selectedMention)}>删除标签 #{selectedMention}</button>}
          </>}
          <button className={styles.addToChatBtn} onClick={() => data.onAddToChat?.(id)}>
            <AtSign size={14} strokeWidth={2} />
            <span>添加到对话</span>
          </button>
        </div>
      )}

      {/* 常驻标题行：名称编辑与正文展开 */}
      <div className={styles.titleRow} data-testid="text-title">
        <div className={styles.titleLeft}>
          <FileText className={styles.titleIcon} strokeWidth={2} color="#888" />
          {titleEditing ? <input className="nodrag nopan" aria-label="文本节点标题" value={titleDraft} autoFocus
            onChange={event => setTitleDraft(event.target.value)}
            onBlur={commitTitle}
            onKeyDown={event => {
              // 名称输入期间隔离画布快捷键；输入法组合中的回车只确认候选词，不提交名称
              event.stopPropagation();
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault();
                commitTitle();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                cancelTitle();
              }
            }} />
            : <span className={styles.titleName} onDoubleClick={event => { event.stopPropagation(); if (data.onTitleChange) { setTitleDraft(data.title ?? (isTextGen ? '文本生成' : '文本节点')); setTitleError(''); setTitleEditing(true); } }}>
              {data.title || (isTextGen ? '文本生成' : '文本节点')}
            </span>}
        </div>
      <button className={`${styles.toolBtn} nodrag nopan`} onClick={() => setExpanded(value => !value)}>
        {expanded ? '收起全文' : '展开全文'}
      </button>
      </div>

      {(contentError || titleError) && <div role="alert" className="nodrag nopan">{contentError || titleError}</div>}
      {/* 固定正文容器：360×270（含内边距），超出的正文在内部上下滚动 */}
      <div className={`${styles.contentCard} nowheel`} data-testid="text-content" style={expanded ? { height: 540, maxHeight: '70vh' } : undefined}>
        {!data.isFirst && (
          <Handle type="target" position={Position.Left} className={styles.handle} style={{ ...HANDLE_STYLE, left: '-16px' }}>
          <HandlePlus />
        </Handle>
        )}

        {isTextGen && !writingSelf && (
          <button
            type="button"
            className={`${styles.writeSelfBtn} ${hasTextGenBody ? styles.writeSelfBtnCorner : ''} nodrag nopan`}
            onClick={(e) => {
              e.stopPropagation();
              setWritingSelf(true);
              setEditing(true);
              data.onWriteSelf?.(id);
            }}
          >
            自己编写内容
          </button>
        )}
        <div
          ref={editorRef}
          className={`${styles.editor} ${editing ? 'nodrag nopan' : ''}`}
          contentEditable={editing ? true : false}
          suppressContentEditableWarning
          style={{ pointerEvents: isSelect && (!isTextGen || writingSelf) ? 'auto' : 'none' }}
          onFocus={() => setIsFocused(true)}
          onBlur={(e) => {
            // 如果焦点转移到工具栏/操作条，保持编辑状态
            const related = e.relatedTarget as HTMLElement | null;
            if (related && related.closest(`.${styles.toolbar}, .${styles.nodeBar}`)) return;
            setIsFocused(false);
            setEditing(false);
            setWritingSelf(false);
          }}
          onInput={handleEditorInput}
          onClick={event => {
            if (!hasPromptBindings) return;
            const chip = (event.target as HTMLElement).closest<HTMLElement>('[data-prompt-index]');
            setSelectedMention(chip ? Number(chip.dataset.promptIndex) : null);
          }}
          onDoubleClick={(e) => {
            if (!isSelect) return;
            e.stopPropagation();
            if (isTextGen && !writingSelf) return;
            setEditing(true);
          }}
          onMouseUp={handleEditorMouseUp}
          onKeyUp={handleEditorKeyUp}
          onPaste={handlePaste}
          onCopy={e => handleCopy(e)}
          onCut={e => handleCopy(e, true)}
          data-placeholder="输入内容..."
        />

        <Handle type="source" position={Position.Right} className={styles.handle} style={{ ...HANDLE_STYLE, right: '-16px' }}>
        <HandlePlus />
      </Handle>
      </div>

      {contextMenu && (
        <CanvasContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={[
            { key: 'chat', label: '添加到聊天' },
            { key: 'duplicate', label: '创建副本' },
            { key: 'paste', label: '粘贴' },
            { key: 'delete', label: '删除', danger: true },
          ]}
          onClose={() => setContextMenu(null)}
          onSelect={(key) => {
            setContextMenu(null);
            if (key === 'chat') handleAddToChat();
            else if (key === 'duplicate') handleDuplicate();
            else if (key === 'paste') data.onPaste?.(id);
            else if (key === 'delete') handleDelete();
          }}
        />
      )}
    </div>
  );
}
