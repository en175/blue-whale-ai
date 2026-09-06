/* ============================================
 * TextNode 文本节点：外置常驻标题 + 固定 360×270 正文容器（内部滚动）
 * 富文本编辑与格式工具栏沿用既有实现
 * ============================================ */
import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, useStore, type NodeProps } from '@xyflow/react';
import { Bold, Italic, List, ListOrdered, Minus, Heading1, Heading2, Heading3, FileText, AtSign, Palette } from 'lucide-react';
import { sanitizeHtml } from '@/utils/sanitize';
import { nodeTitleSizing } from '../nodeTitleSizing';
import styles from './index.module.css';

/** 文字节点最大字数（按纯文本计，含粘贴） */
const MAX_TEXT_LENGTH = 2000;

/** 连接点统一样式（锚定正文容器左右中点） */
const HANDLE_STYLE = { background: '#666', width: 10, height: 10, border: '2px solid #444' } as const;

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
  /** Toast 提示（超字数上限等场景，由父级注入） */
  onToast?: (type: 'success' | 'error' | 'warn', msg: string) => void;
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

  // 仅在首次挂载时设置初始 HTML（超上限时截断纯文本）
  useEffect(() => {
    if (!initializedRef.current && editorRef.current) {
      editorRef.current.innerHTML = sanitizeHtml(data.html || data.text || '');
      // 旧数据/共享资产导入可能超字数：按纯文本截断
      const text = editorRef.current.innerText ?? '';
      if (text.length > MAX_TEXT_LENGTH) {
        editorRef.current.innerText = text.slice(0, MAX_TEXT_LENGTH);
        data.onToast?.('warn', `文字节点最多 ${MAX_TEXT_LENGTH} 字，已截断 ${text.length - MAX_TEXT_LENGTH} 字`);
      }
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

  /** 粘贴清洗：将富文本转为纯文本；超上限时截断并提示 */
  /** 当前编辑器纯文本长度 */
  const getTextLength = useCallback(
    () => (editorRef.current?.innerText ?? '').length,
    [],
  );

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    // 粘贴截断：当前已有字数 + 粘贴内容不能超过上限
    const remaining = MAX_TEXT_LENGTH - getTextLength();
    if (remaining <= 0) {
      data.onToast?.('warn', `文字节点最多 ${MAX_TEXT_LENGTH} 字`);
      return;
    }
    if (text.length > remaining) {
      data.onToast?.('warn', `文字节点最多 ${MAX_TEXT_LENGTH} 字，已截断 ${text.length - remaining} 字`);
    }
    document.execCommand('insertText', false, text.slice(0, remaining));
    saveSelection();
    syncContent();
  }, [data, getTextLength, saveSelection, syncContent]);

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

      {/* 常驻标题行：左侧类型图标与现有名称，右侧留空 */}
      <div className={styles.titleRow} data-testid="text-title">
        <div className={styles.titleLeft}>
          <FileText className={styles.titleIcon} strokeWidth={2} color="#888" />
          <span className={styles.titleName}>文本节点</span>
        </div>
      </div>

      {/* 固定正文容器：360×270（含内边距），超出的正文在内部上下滚动 */}
      <div className={`${styles.contentCard} nowheel`} data-testid="text-content">
        {!data.isFirst && (
          <Handle type="target" position={Position.Left} className={styles.handle} style={HANDLE_STYLE} />
        )}

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
          onInput={() => {
            // 键入超限拦截：撤销本次输入并提示（IME/手打兜底，粘贴在 handlePaste 已截断）
            if (getTextLength() > MAX_TEXT_LENGTH) {
              document.execCommand('undo');
              data.onToast?.('warn', `文字节点最多 ${MAX_TEXT_LENGTH} 字`);
              return;
            }
            syncContent();
          }}
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

        <Handle type="source" position={Position.Right} className={styles.handle} style={HANDLE_STYLE} />
      </div>

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
          {/* 共享资产概念下线，入口已隐藏
          <button className={styles.contextItem} onClick={handleSaveToAssets}>
            <span>保存到共享资产</span>
          </button> */}
          <button className={styles.contextItem} onClick={handleDuplicate}>
            <span>复制</span>
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
