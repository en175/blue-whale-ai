/* ============================================
 * TextNode 文本节点：富文本编辑与格式工具栏
 * ============================================ */
import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Bold, Italic, List, ListOrdered, Minus, Heading1, Heading2, Heading3, FileText } from 'lucide-react';
import styles from './index.module.css';

interface TextNodeData {
  html?: string;
  text?: string;
  toolMode?: 'drag' | 'select';
  isFirst?: boolean;
  onDelete?: (id: string) => void;
  onChange?: (id: string, html: string) => void;
  onDuplicate?: (id: string) => void;
  onAddToChat?: (id: string) => void;
  onSaveToAssets?: (id: string) => void;
}

export default function TextNode({ id, data }: NodeProps & { data: TextNodeData }) {
  const [isFocused, setIsFocused] = useState(false);
  /** 双击进入编辑；单击/拖动为移动节点 */
  const [editing, setEditing] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const initializedRef = useRef(false);

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

  // 仅在首次挂载时设置初始 HTML
  useEffect(() => {
    if (!initializedRef.current && editorRef.current) {
      editorRef.current.innerHTML = data.html || data.text || '';
      initializedRef.current = true;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  /** 同步内容到父组件 */
  const syncContent = useCallback(() => {
    const html = editorRef.current?.innerHTML || '';
    data.onChange?.(id, html);
  }, [data, id]);

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
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, [data.toolMode]);

  const handleDelete = useCallback(() => {
    setContextMenu(null);
    data.onDelete?.(id);
  }, [data, id]);

  /** 拷贝内容到剪贴板 */
  const handleCopy = useCallback(async () => {
    setContextMenu(null);
    const text = editorRef.current?.innerText ?? '';
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 忽略剪贴板异常
    }
  }, []);

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

  /** 保存到共享资产 */
  const handleSaveToAssets = useCallback(() => {
    setContextMenu(null);
    data.onSaveToAssets?.(id);
  }, [data, id]);

  /** 编辑器内鼠标抬起时保存选区 */
  const handleEditorMouseUp = useCallback(() => {
    saveSelection();
  }, [saveSelection]);

  /** 编辑器键盘操作后保存选区并同步 */
  const handleEditorKeyUp = useCallback(() => {
    saveSelection();
    syncContent();
  }, [saveSelection, syncContent]);

  return (
    <div
      className={`${styles.wrapper} ${isFocused && isSelect ? `${styles.focused} nodrag` : ''}`}
      onContextMenu={handleContextMenu}
    >
      {!data.isFirst && (
        <Handle type="target" position={Position.Left} style={{ background: '#666', width: 10, height: 10, border: '2px solid #444' }} />
      )}

      {isFocused && (
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
        </div>
      )}

      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.labelGroup}>
            <FileText size={13} strokeWidth={2} color="#888" />
            <span className={styles.label}>文本节点</span>
          </div>
        </div>

        <div
          ref={editorRef}
          className={`${styles.editor} ${editing ? 'nodrag nopan' : ''}`}
          contentEditable={editing}
          suppressContentEditableWarning
          style={{ pointerEvents: isSelect ? 'auto' : 'none' }}
          onFocus={() => setIsFocused(true)}
          onBlur={() => { setIsFocused(false); setEditing(false); }}
          onInput={syncContent}
          onDoubleClick={(e) => {
            if (!isSelect) return;
            // 双击激活输入，并阻止画布双击居中缩放
            e.stopPropagation();
            setEditing(true);
          }}
          onMouseUp={handleEditorMouseUp}
          onKeyUp={handleEditorKeyUp}
          data-placeholder="输入内容..."
        />
      </div>

      <Handle type="source" position={Position.Right} style={{ background: '#666', width: 10, height: 10, border: '2px solid #444' }} />

      {/* 右键菜单（portal 到 body，避免节点 transform 影响 fixed 定位） */}
      {contextMenu &&
        createPortal(
          <div
            className={styles.contextMenu}
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onMouseDown={(e) => e.stopPropagation()}
          >
          <button className={styles.contextItem} onClick={handleAddToChat}>
            <span>添加到聊天</span>
          </button>
          <button className={styles.contextItem} onClick={handleSaveToAssets}>
            <span>保存到共享资产</span>
          </button>
          <button className={styles.contextItem} onClick={handleCopy}>
            <span>拷贝</span>
            <span className={styles.contextShortcut}>⌘C</span>
          </button>
          <button className={styles.contextItem} onClick={handleDuplicate}>
            <span>复制</span>
            <span className={styles.contextShortcut}>⌘D</span>
          </button>
          <button className={`${styles.contextItem} ${styles.contextDanger}`} onClick={handleDelete}>
            <span>删除</span>
          </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
