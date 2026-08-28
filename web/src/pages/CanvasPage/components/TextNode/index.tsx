/* ============================================
 * TextNode 文本节点：富文本编辑与格式工具栏
 * ============================================ */
import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Bold, Italic, List, ListOrdered, Minus, Heading1, Heading2, Heading3, FileText, AtSign, Palette } from 'lucide-react';
import { sanitizeHtml } from '@/utils/sanitize';
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

export default function TextNode({ id, data, selected }: NodeProps & { data: TextNodeData; selected?: boolean }) {
  const [isFocused, setIsFocused] = useState(false);
  /** 双击进入编辑；单击/拖动为移动节点 */
  const [editing, setEditing] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [currentColor, setCurrentColor] = useState('#ffffff');
  const editorRef = useRef<HTMLDivElement>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const initializedRef = useRef(false);

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

  // 仅在首次挂载时设置初始 HTML
  useEffect(() => {
    if (!initializedRef.current && editorRef.current) {
      editorRef.current.innerHTML = sanitizeHtml(data.html || data.text || '');
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
    const html = sanitizeHtml(editorRef.current?.innerHTML || '');
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

  /** 粘贴清洗：将富文本转为纯文本 */
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
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
        </div>
      )}

      {/* 悬停/选中时顶部操作条：添加到对话（与商品节点一致） */}
      <div className={`${styles.topBar} ${selected ? styles.topBarVisible : ''}`}>
        <span className={styles.topLabel}>
          <FileText size={14} strokeWidth={2} />
          <span>文本</span>
        </span>
        <button className={`${styles.addToChatBtn} nodrag`} onClick={() => data.onAddToChat?.(id)}>
          <AtSign size={14} strokeWidth={2} />
          <span>添加到对话</span>
        </button>
      </div>

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
