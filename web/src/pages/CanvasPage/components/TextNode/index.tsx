/* ============================================
 * TextNode 文本节点：外置常驻标题 + 固定 360×270 正文容器（内部滚动）
 * 富文本编辑与格式工具栏沿用既有实现
 * ============================================ */
import { useState, useRef, useCallback, useEffect } from 'react';
import { Handle, Position, useStore, type NodeProps } from '@xyflow/react';
import { Bold, Italic, List, ListOrdered, Minus, Heading1, Heading2, Heading3, FileText, AtSign, Palette, Plus } from 'lucide-react';
import { sanitizeHtml } from '@/utils/sanitize';
import { nodeTitleSizing } from '../nodeTitleSizing';
import CanvasContextMenu from '../CanvasContextMenu';
import styles from './index.module.css';
import { PROMPT_TEXT_LIMITS } from '../../../../../../packages/contracts/src/prompt-text-limits';

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
  title?: string;
  onTitleChange?: (id: string, title: string) => void;
  onDraftError?: (id: string, error: string) => void;
  onTextChange?: (id: string, text: string) => void;
  html?: string;
  text?: string;
  toolMode?: 'drag' | 'select';
  isFirst?: boolean;
  onDelete?: (id: string) => void;
  onChange?: (id: string, html: string) => void;
  onDuplicate?: (id: string) => void;
  onAddToChat?: (id: string) => void;
  onSaveToAssets?: (id: string) => void;
  onPaste?: (id: string) => void;
  /** Toast 提示（超字数上限等场景，由父级注入） */
  onToast?: (type: 'success' | 'error' | 'warn', msg: string) => void;
}

export default function TextNode({ id, data, selected }: NodeProps & { data: TextNodeData; selected?: boolean }) {
  const plainText = typeof data.text === 'string';
  const [contentError, setContentError] = useState('');
  const [titleError, setTitleError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(data.title ?? '文本节点');
  const [isFocused, setIsFocused] = useState(false);
  /** 双击进入编辑；单击/拖动为移动节点 */
  const [editing, setEditing] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [currentColor, setCurrentColor] = useState('#ffffff');
  const editorRef = useRef<HTMLDivElement>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const initializedRef = useRef(false);

  const zoom = useStore((state) => state.transform[2]);

  /** 预设颜色 */
  const COLORS = ['#ffffff', '#e8e8e8', '#ff4d4f', '#ff7a45', '#ffa940', '#ffec3d', '#73d13d', '#36cfc9', '#40a9ff', '#597ef7', '#9254de', '#ff85c0'];

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
      if (plainText) editorRef.current.textContent = data.text ?? '';
      else editorRef.current.innerHTML = sanitizeHtml(data.html || '');
      initializedRef.current = true;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (plainText && !editing && !contentError && editorRef.current) {
      editorRef.current.textContent = data.text ?? '';
    }
  }, [plainText, editing, contentError, data.text]);

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

  // 点击其他区域关闭颜色选择器
  useEffect(() => {
    if (!showColorPicker) return;
    const close = () => setShowColorPicker(false);
    const timer = setTimeout(() => document.addEventListener('click', close), 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', close);
    };
  }, [showColorPicker]);

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

  /** 同步内容到父组件（净化后保存，防止 XSS 持久化） */
  const syncContent = useCallback(() => {
    const text = editorRef.current?.innerText ?? '';
    if (text.length > MAX_TEXT_LENGTH) {
      const error = `正文最多 ${MAX_TEXT_LENGTH} 字，当前草稿已保留，请缩短后保存`;
      setContentError(error);
      data.onDraftError?.(id, error);
      return;
    }
    setContentError('');
    data.onDraftError?.(id, titleError);
    if (plainText) data.onTextChange?.(id, text);
    else data.onChange?.(id, sanitizeHtml(editorRef.current?.innerHTML || ''));
  }, [data, id, plainText, titleError]);

  /** 执行格式化命令 */
  const execCmd = useCallback((cmd: string, value?: string) => {
    editorRef.current?.focus();
    restoreSelection();
    document.execCommand(cmd, false, value);
    saveSelection();
    syncContent();
  }, [restoreSelection, saveSelection, syncContent]);

  /** 设置文字颜色（手动包裹 span，替代 execCommand foreColor 的不稳定行为） */
  const setColor = useCallback((color: string) => {
    setCurrentColor(color);
    setShowColorPicker(false);

    // 聚焦编辑器并恢复选区
    editorRef.current?.focus();
    restoreSelection();

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      console.warn('[TextNode] setColor: no selection');
      return;
    }
    const range = sel.getRangeAt(0);
    if (!editorRef.current?.contains(range.commonAncestorContainer)) {
      console.warn('[TextNode] setColor: selection outside editor');
      return;
    }

    // 确保选区非空
    if (range.collapsed) {
      console.warn('[TextNode] setColor: collapsed selection');
      return;
    }

    console.log('[TextNode] setColor: applying', color, 'to', range.toString());

    // 创建带颜色的 span 包裹选中内容
    const span = document.createElement('span');
    span.style.color = color;

    try {
      span.appendChild(range.extractContents());
      range.insertNode(span);
      // 重新选中包裹后的内容
      const newRange = document.createRange();
      newRange.selectNodeContents(span);
      sel.removeAllRanges();
      sel.addRange(newRange);
      console.log('[TextNode] setColor: success');
    } catch (err) {
      console.warn('[TextNode] setColor: DOM approach failed, fallback', err);
      // 备选方案：尝试 execCommand
      document.execCommand('styleWithCSS', false, 'true');
      document.execCommand('foreColor', false, color);
    }

    saveSelection();
    syncContent();
  }, [restoreSelection, saveSelection, syncContent]);

  /** 切换颜色选择器 */
  const toggleColorPicker = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    saveSelection();
    setShowColorPicker(prev => !prev);
  }, [saveSelection]);

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

  /** Paste the entire actual text; over-limit drafts remain visible and are not persisted. */
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
    saveSelection();
    syncContent();
  }, [saveSelection, syncContent]);

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
      {isFocused && !plainText ? (
        <div
          className={`${styles.toolbar} nodrag nopan`}
          onMouseDown={(e) => e.preventDefault()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {/* 文字颜色选择（放在第一位） */}
          <div className={styles.colorWrap}>
            <button className={`${styles.toolBtn} ${styles.colorBtn}`} onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }} onClick={toggleColorPicker} title="文字颜色">
              <Palette size={12} strokeWidth={2} />
              <span className={styles.colorIndicator} style={{ backgroundColor: currentColor }} />
            </button>
            {showColorPicker && (
              <div className={styles.colorPicker} onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}>
                <div className={styles.colorGrid}>
                  {COLORS.map(color => (
                    <button
                      key={color}
                      className={`${styles.colorSwatch} ${color === currentColor ? styles.colorSwatchActive : ''}`}
                      style={{ backgroundColor: color }}
                      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                      onClick={() => setColor(color)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className={styles.divider} />

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
            onBlur={() => {
              if (titleDraft.length > PROMPT_TEXT_LIMITS.title) {
                const error = `标题最多 ${PROMPT_TEXT_LIMITS.title} 字，草稿已保留`;
                setTitleError(error); data.onDraftError?.(id, error); return;
              }
              data.onTitleChange?.(id, titleDraft); setTitleEditing(false); setTitleError(''); data.onDraftError?.(id, contentError);
            }} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Enter') event.currentTarget.blur(); }} />
            : <span className={styles.titleName} onDoubleClick={event => { event.stopPropagation(); if (data.onTitleChange) { setTitleDraft(data.title ?? '文本节点'); setTitleEditing(true); } }}>
              {data.title || '文本节点'}
            </span>}
        </div>
      {plainText && <button className={`${styles.toolBtn} nodrag nopan`} onClick={() => setExpanded(value => !value)}>
        {expanded ? '收起全文' : '展开全文'}
      </button>}
      </div>

      {(contentError || titleError) && <div role="alert" className="nodrag nopan">{contentError || titleError}</div>}
      {/* 固定正文容器：360×270（含内边距），超出的正文在内部上下滚动 */}
      <div className={`${styles.contentCard} nowheel`} data-testid="text-content" style={expanded ? { height: 540, maxHeight: '70vh' } : undefined}>
        {!data.isFirst && (
          <Handle type="target" position={Position.Left} className={styles.handle} style={{ ...HANDLE_STYLE, left: '-16px' }}>
          <HandlePlus />
        </Handle>
        )}

        <div
          ref={editorRef}
          className={`${styles.editor} ${editing ? 'nodrag nopan' : ''}`}
          contentEditable={editing ? (plainText ? 'plaintext-only' : true) : false}
          suppressContentEditableWarning
          style={{ pointerEvents: isSelect ? 'auto' : 'none' }}
          onFocus={() => setIsFocused(true)}
          onBlur={(e) => {
            // 如果焦点转移到工具栏/颜色面板，保持编辑状态
            const related = e.relatedTarget as HTMLElement | null;
            if (related && related.closest(`.${styles.toolbar}`)) return;
            setIsFocused(false);
            setEditing(false);
          }}
          onInput={syncContent}
          onDoubleClick={(e) => {
            if (!isSelect) return;
            // 双击激活输入，并阻止画布双击居中缩放
            e.stopPropagation();
            setEditing(true);
          }}
          onMouseUp={handleEditorMouseUp}
          onKeyUp={handleEditorKeyUp}
          onPaste={handlePaste}
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
