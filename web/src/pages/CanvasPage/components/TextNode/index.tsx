/* ============================================
 * TextNode 文本节点：外置常驻标题 + 固定 360×270 正文容器（内部滚动）
 * IKFM3L 统一正文契约 v1：普通新增、Agent 应用与历史卡共用 Markdown 编辑
 * 与格式工具栏；正文以受限 Markdown 源（data.text）为唯一权威，html 仅存量兼容。
 * IKFM3Q 正文媒体索引契约 v1：正文 @ 索引画布图片/音频/视频，标签编号与
 * 有效/失效状态由（节点, 带 textIndex 标记的关系线）派生，不持久化。
 * ============================================ */
import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, useStore, useReactFlow, type NodeProps } from '@xyflow/react';
import { Bold, Italic, List, ListOrdered, Minus, Heading1, Heading2, Heading3, FileText, AtSign, Plus, Crosshair, RefreshCw, Trash2, AudioLines } from 'lucide-react';
import { sanitizeHtml } from '@/utils/sanitize';
import { nodeTitleSizing } from '../nodeTitleSizing';
import { commitCardName } from '../cardName';
import CanvasContextMenu from '../CanvasContextMenu';
import AtMentionMenu from '../AtMentionMenu';
import type { AtMentionItem } from '../../atMention';
import styles from './index.module.css';
import { PROMPT_TEXT_LIMITS } from '@lib/contracts/prompt-text-limits';
import { promptMentionSchema, validPromptMentions, type PromptMention, type PromptMaterial } from '@lib/contracts/prompt-preview';
import { markdownToSanitizedHtml } from '@lib/contracts/text-node-markdown';
import { type MediaMention, type MediaRef } from '@lib/contracts/text-node-media';
import { renderPromptMentions, readPromptMentions, applyMediaMentionState, createMediaMentionChip } from './promptMentions';
import { applyMarkdownInputRule } from './markdownInputRules';

/** 文字节点最大字数（按纯文本计，含粘贴） */
const MAX_TEXT_LENGTH = PROMPT_TEXT_LIMITS.text;

/** 悬停预览估算高度：与 .chipPreview 的缩略图 max-height 200 + 名称行/内边距联动，CSS 改尺寸须同步 */
const CHIP_PREVIEW_EST_HEIGHT = 250;

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

/** media 编辑后的光标锚点（IKFXDB，契约 §5）：全量重放销毁旧 DOM，
 *  恢复按（身份 nodeId + 同身份第几张 + 标签前/后）在新 DOM 定位 chip。 */
interface MediaEditAnchor {
  nodeId: string;
  /** 同身份第几张（1-based，按文档序） */
  occurrence: number;
  placement: 'before' | 'after';
}

/** 编辑器内某身份的全部 chip（按文档序） */
function chipsOfIdentity(editor: HTMLElement, nodeId: string): HTMLElement[] {
  return [...editor.querySelectorAll<HTMLElement>(`[data-media-node="${CSS.escape(nodeId)}"]`)];
}

/** chip 在编辑器里的锚点（同身份序号按文档序计） */
function chipAnchorOf(editor: HTMLElement, chip: HTMLElement, placement: MediaEditAnchor['placement']): MediaEditAnchor {
  const nodeId = chip.dataset.mediaNode ?? '';
  const occurrence = chipsOfIdentity(editor, nodeId).indexOf(chip) + 1;
  return { nodeId, occurrence, placement };
}

interface TextNodeData {
  promptSource?: unknown;
  promptMentions?: PromptMention[];
  promptMaterials?: Array<PromptMaterial & { url: string }>;
  onPromptChange?: (id: string, text: string, mentions: PromptMention[], materials?: Array<PromptMaterial & { url: string }>) => void;
  /** IKFM3Q 正文媒体索引：标签区间与身份展示快照（契约 §1）；有效性/编号派生不存储 */
  mediaMentions?: MediaMention[];
  mediaRefs?: MediaRef[];
  /** 索引变更回调：delta.added 仅来自显式插入/重绑定（建线），delta.removed 为消失的身份（删线）；
   *  序列化 diff 不自动补线（契约 §4 事件驱动） */
  onMediaIndexChange?: (id: string, mediaMentions: MediaMention[], mediaRefs: MediaRef[], delta: { added: string[]; removed: string[] }) => void;
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

  /* IKFM3Q 正文媒体索引（契约 §3/§5）：有效性由（来源节点存在 + textIndex 关系线存在）派生 */
  const canvasEdges = useStore(state => state.edges);
  const rf = useReactFlow();
  const mediaValidity = useCallback((nodeId: string) => {
    if (!canvasNodes.some(node => node.id === nodeId)) return false;
    return canvasEdges.some(edge => edge.source === nodeId && edge.target === id
      && (edge.data as Record<string, unknown> | undefined)?.textIndex === true);
  }, [canvasNodes, canvasEdges, id]);

  /** @ 菜单可选素材：画布图片/音频/视频媒体节点（不含文本——不支持文本互引） */
  const mediaMentionItems: AtMentionItem[] = canvasNodes.filter(node => node.type === 'mediaNode' && node.data.assetId && !node.data.assetMissing && node.data.genStatus !== 'generating'
    && ['image', 'video', 'audio'].includes(String(node.data.mediaType)) && typeof node.data.src === 'string')
    .map(node => ({
      id: node.id,
      kind: String(node.data.mediaType) as AtMentionItem['kind'],
      name: String(node.data.fileName || node.data.assetId),
      thumbUrl: String(node.data.src),
      assetId: String(node.data.assetId),
    }));

  /** @ 菜单：insert=光标处插入新标签；rebind=重绑定失效身份（契约 §3 修复路径）；
   *  rebindChip=触发重绑定的那张 chip（选中后光标落它替换后的新标签后，契约 §5） */
  const [mentionMenu, setMentionMenu] = useState<{ mode: 'insert' | 'rebind'; rebindNodeId?: string; rebindChip?: HTMLElement; x: number; y: number } | null>(null);
  const mentionAnchorRef = useRef<HTMLSpanElement>(null);
  /** 标签操作弹层：点击 media 标签弹出（定位/替换来源/删除标签） */
  const [chipMenu, setChipMenu] = useState<{ chip: HTMLElement; x: number; y: number } | null>(null);
  /** 悬停预览：有效标签的素材预览（约 150ms 延迟，契约 §5）；below=标签贴近屏幕顶部时翻到下方 */
  const [chipPreview, setChipPreview] = useState<{ chip: HTMLElement; x: number; y: number; below: boolean } | null>(null);
  const previewTimerRef = useRef<number | null>(null);
  /** 最近一次已同步的 media 索引（序列化 diff 的基线）：diff 只删线不补线（契约 §4） */
  const mediaIndexRef = useRef<{ mediaMentions: MediaMention[]; mediaRefs: MediaRef[] }>({ mediaMentions: data.mediaMentions ?? [], mediaRefs: data.mediaRefs ?? [] });
  useEffect(() => { mediaIndexRef.current = { mediaMentions: data.mediaMentions ?? [], mediaRefs: data.mediaRefs ?? [] }; }, [data.mediaMentions, data.mediaRefs]);

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
      if (typeof data.text === 'string') renderPromptMentions(editorRef.current, data.text, data.promptMentions ?? [], data.promptMaterials ?? [], data.mediaMentions ?? [], data.mediaRefs ?? [], mediaValidity);
      else editorRef.current.innerHTML = sanitizeHtml(data.html || '');
      initializedRef.current = true;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 非编辑态：权威正文变化时按 Markdown 渲染重放（编辑中的 DOM 是权威，不覆盖）；
  // mediaValidity 随节点/连线变化，失效态与编号随派生翻转（契约 §3）
  useEffect(() => {
    if (!editing && !contentError && editorRef.current && typeof data.text === 'string') {
      renderPromptMentions(editorRef.current, data.text, data.promptMentions ?? [], data.promptMaterials ?? [], data.mediaMentions ?? [], data.mediaRefs ?? [], mediaValidity);
    }
  }, [editing, contentError, data.text, data.promptMentions, data.promptMaterials, data.mediaMentions, data.mediaRefs, mediaValidity]);

  // 编辑中连线/来源变化：就地翻转 chip 失效态与编号（不重建 DOM，保住光标）
  useEffect(() => {
    if (editing && editorRef.current) applyMediaMentionState(editorRef.current, mediaValidity);
  }, [editing, mediaValidity]);

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

  /** 同步 media 索引到父组件：序列化 diff 只删线不补线；建线 delta 仅来自显式插入/重绑定（契约 §4） */
  const notifyMediaIndex = useCallback((next: { mediaMentions: MediaMention[]; mediaRefs: MediaRef[] }, delta: { added: string[]; removed: string[] }) => {
    const prevIds = new Set(mediaIndexRef.current.mediaMentions.map(mention => mention.nodeId));
    const nextIds = new Set(next.mediaMentions.map(mention => mention.nodeId));
    const removed = [...new Set([...delta.removed, ...[...prevIds].filter(nodeId => !nextIds.has(nodeId))])];
    const added = delta.added.filter(nodeId => nextIds.has(nodeId) && !prevIds.has(nodeId));
    const changed = JSON.stringify(mediaIndexRef.current.mediaMentions) !== JSON.stringify(next.mediaMentions)
      || JSON.stringify(mediaIndexRef.current.mediaRefs) !== JSON.stringify(next.mediaRefs);
    mediaIndexRef.current = { mediaMentions: next.mediaMentions, mediaRefs: next.mediaRefs };
    if (!changed && added.length === 0 && removed.length === 0) return;
    data.onMediaIndexChange?.(id, next.mediaMentions, next.mediaRefs, { added, removed });
  }, [data, id]);

  /** 同步内容到父组件：编辑器 DOM 序列化为 Markdown 源（契约 §1 权威正文） */
  const syncContent = useCallback(() => {
    if (!editorRef.current) return;
    const content = readPromptMentions(editorRef.current, mediaValidity);
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
    notifyMediaIndex(content, { added: [], removed: [] });
  }, [data, id, hasPromptBindings, mediaValidity, notifyMediaIndex]);

  /** 重放后按锚点恢复光标（IKFXDB，契约 §5）：定位同身份第 occurrence 张 chip 落
   *  锚点位置；无可锚 chip（唯一标签被删后正文无标签）落编辑器末尾。 */
  const restoreMediaAnchor = useCallback((anchor?: MediaEditAnchor) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const range = document.createRange();
    let placed = false;
    if (anchor) {
      const chip = chipsOfIdentity(editor, anchor.nodeId)[anchor.occurrence - 1];
      if (chip) {
        if (anchor.placement === 'after') range.setStartAfter(chip);
        else range.setStartBefore(chip);
        placed = true;
      }
    }
    if (!placed) { range.selectNodeContents(editor); range.collapse(false); }
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    savedRangeRef.current = range.cloneRange();
  }, []);

  /** media 标签 DOM 变更（插入/重绑定/删除）→ 序列化 → 全量重放 → 同步父级与关系线。
   *  重放销毁旧 DOM、旧选区随之失效：anchor 记录变更前锚点，重放后按它在新 DOM 恢复光标（契约 §5）。 */
  const commitMediaEdit = useCallback((delta: { added: string[]; removed: string[] }, anchor?: MediaEditAnchor) => {
    const editor = editorRef.current;
    if (!editor) return;
    // 新插入/重绑定身份的连线在本轮 delta 才建立：序列化与重放按「已建立」派生，避免把新标签写成已失效
    const validity = (nodeId: string) => delta.added.includes(nodeId) || mediaValidity(nodeId);
    const content = readPromptMentions(editor, validity);
    renderPromptMentions(editor, content.text, content.mentions, draftMaterialsRef.current ?? [], content.mediaMentions, content.mediaRefs, validity);
    restoreMediaAnchor(anchor);
    setChipMenu(null);
    if (content.text.length > MAX_TEXT_LENGTH) {
      // 草稿超限仅就地提示：正文与索引都不同步（与 editMaterial 口径一致）
      const error = `正文最多 ${MAX_TEXT_LENGTH} 字，当前草稿已保留，请缩短后保存`;
      setContentError(error);
      data.onDraftError?.(id, error);
      return;
    }
    setContentError('');
    data.onDraftError?.(id, '');
    if (hasPromptBindings) data.onPromptChange?.(id, content.text, content.mentions, draftMaterialsRef.current);
    else data.onTextChange?.(id, content.text);
    notifyMediaIndex(content, delta);
  }, [data, id, hasPromptBindings, mediaValidity, notifyMediaIndex, restoreMediaAnchor]);

  /** 逐键输入 @ 打开素材菜单（契约 §5：正文任意位置触发——@ 前是汉字/标点/字母/
   *  数字均弹出，与底部面板编辑器同一口径；粘贴不触发，IKFUTI） */
  const openMentionMenuAtCaret = useCallback(() => {
    const editor = editorRef.current;
    const sel = window.getSelection();
    if (!editor || !sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!range.collapsed || !editor.contains(range.startContainer)) return;
    const container = range.startContainer;
    if (container.nodeType === Node.TEXT_NODE) {
      const text = container.textContent ?? '';
      // 光标紧跟刚输入的 '@' 即触发，不看 '@' 的前一个字符
      if (text[range.startOffset - 1] !== '@') return;
    } else if (range.startOffset > 0) {
      const prev = container.childNodes[range.startOffset - 1];
      if (prev && prev.nodeName !== 'BR') return;
    }
    saveSelection();
    const rect = range.getBoundingClientRect();
    setMentionMenu({ mode: 'insert', x: rect.left, y: rect.bottom });
  }, [saveSelection]);

  /** @ 菜单选中：插入新标签（吞掉触发的 '@'），或对失效身份整体重绑定（契约 §3） */
  const handleMediaSelect = useCallback((item: AtMentionItem) => {
    const editor = editorRef.current;
    if (!editor || !item.assetId || (item.kind !== 'image' && item.kind !== 'video' && item.kind !== 'audio')) return;
    const identity = { nodeId: item.id, assetId: item.assetId, mediaType: item.kind, name: item.name, url: item.thumbUrl ?? '' };
    const menu = mentionMenu;
    setMentionMenu(null);
    editor.focus();
    if (menu?.mode === 'rebind' && menu.rebindNodeId) {
      const oldNodeId = menu.rebindNodeId;
      if (oldNodeId === identity.nodeId) { setChipMenu(null); return; }
      // 重绑定以身份为单位：该身份全部失效标签一并指向新来源（契约 §3）
      let clickedNext: HTMLElement | null = null;
      for (const chip of editor.querySelectorAll<HTMLElement>(`[data-media-node="${CSS.escape(oldNodeId)}"]`)) {
        const next = createMediaMentionChip(identity, identity.name, false);
        chip.replaceWith(next);
        if (chip === menu.rebindChip) clickedNext = next;
      }
      const alreadyKnown = mediaIndexRef.current.mediaMentions.some(mention => mention.nodeId === identity.nodeId);
      // 光标落触发重绑定的那张替换后的新标签后（契约 §5 替换落点）
      commitMediaEdit({ added: alreadyKnown ? [] : [identity.nodeId], removed: [oldNodeId] },
        clickedNext ? chipAnchorOf(editor, clickedNext, 'after') : undefined);
      return;
    }
    restoreSelection();
    const base = savedRangeRef.current?.cloneRange();
    const range = base && editor.contains(base.startContainer)
      ? base
      : (() => { const r = document.createRange(); r.selectNodeContents(editor); r.collapse(false); return r; })();
    // 吞掉触发菜单的 '@'
    if (range.startContainer.nodeType === Node.TEXT_NODE && range.startOffset > 0
      && (range.startContainer.textContent ?? '')[range.startOffset - 1] === '@') {
      range.setStart(range.startContainer, range.startOffset - 1);
      range.deleteContents();
    }
    const known = mediaIndexRef.current.mediaMentions.some(mention => mention.nodeId === identity.nodeId);
    // 临时以素材名占位：最终编号由 commitMediaEdit 全量重放按序派生（契约 §2）
    const chip = createMediaMentionChip(identity, identity.name, false);
    range.insertNode(chip);
    range.setStartAfter(chip);
    range.collapse(true);
    savedRangeRef.current = range;
    // 光标落新标签后（契约 §5 插入落点）：锚点按插入后同身份序号计
    commitMediaEdit({ added: known ? [] : [identity.nodeId], removed: [] }, chipAnchorOf(editor, chip, 'after'));
  }, [mentionMenu, restoreSelection, commitMediaEdit]);

  /** 点击有效标签（非编辑态）定位来源节点：平移居中 + 短暂高亮（契约 §5） */
  const locateSource = useCallback((nodeId: string) => {
    const target = canvasNodes.find(node => node.id === nodeId);
    if (!target) return;
    const width = target.measured?.width ?? 360;
    const height = target.measured?.height ?? 270;
    void rf.setCenter(target.position.x + width / 2, target.position.y + height / 2, { zoom, duration: 300 });
    const el = document.querySelector(`.react-flow__node[data-id="${CSS.escape(nodeId)}"]`);
    if (el) {
      el.classList.add(styles.locateFlash);
      window.setTimeout(() => el.classList.remove(styles.locateFlash), 1200);
    }
  }, [canvasNodes, rf, zoom]);

  /** 点击 media 标签弹出操作层 */
  const openChipMenu = useCallback((chip: HTMLElement) => {
    const rect = chip.getBoundingClientRect();
    setChipMenu({ chip, x: rect.left, y: rect.bottom + 6 });
  }, []);

  /** 悬停 media 标签：有效标签 150ms 后出素材预览；失效标签不预览（契约 §5）。
   *  预览默认在标签上方，标签贴近屏幕顶部放不下时翻到下方（IKFR6A）。 */
  const handleEditorMouseOver = useCallback((event: React.MouseEvent) => {
    const chip = (event.target as HTMLElement).closest?.('[data-media-node]') as HTMLElement | null;
    if (previewTimerRef.current) { window.clearTimeout(previewTimerRef.current); previewTimerRef.current = null; }
    if (!chip || chip.dataset.mediaInvalid === '1') { setChipPreview(null); return; }
    previewTimerRef.current = window.setTimeout(() => {
      const rect = chip.getBoundingClientRect();
      const below = rect.top < CHIP_PREVIEW_EST_HEIGHT + 8;
      setChipPreview({ chip, x: rect.left, y: below ? rect.bottom + 8 : rect.top, below });
    }, 150);
  }, []);

  const handleEditorMouseOut = useCallback((event: React.MouseEvent) => {
    const chip = (event.target as HTMLElement).closest?.('[data-media-node]') as HTMLElement | null;
    if (!chip || chip.contains(event.relatedTarget as Node)) return;
    if (previewTimerRef.current) { window.clearTimeout(previewTimerRef.current); previewTimerRef.current = null; }
    setChipPreview(null);
  }, []);

  // 点击其他区域关闭标签操作层（菜单内部点击除外）
  useEffect(() => {
    if (!chipMenu) return;
    const close = (event: Event) => {
      if ((event.target as HTMLElement | null)?.closest?.(`.${styles.chipMenu}`)) return;
      setChipMenu(null);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [chipMenu]);

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
    const content = readPromptMentions(fragment, mediaValidity);
    e.preventDefault();
    e.clipboardData.setData('text/plain', content.text);
    e.clipboardData.setData('application/x-blue-whale-prompt', JSON.stringify({ nodeId: id, ...content }));
    if (cut) { document.execCommand('delete'); syncContent(); }
  }, [hasPromptBindings, id, syncContent, mediaValidity]);

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

  /** 输入后应用 Markdown 语法规则（契约 §2 输入路径），逐键输入 @ 时打开素材菜单，再同步内容 */
  const handleEditorInput = useCallback((e: React.FormEvent<HTMLDivElement>) => {
    const native = e.nativeEvent as InputEvent;
    if (native.inputType === 'insertText' && editorRef.current && native.data) {
      applyMarkdownInputRule(editorRef.current, native.data);
      if (native.data === '@') openMentionMenuAtCaret();
    }
    syncContent();
  }, [syncContent, openMentionMenuAtCaret]);

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
      {/* 固定正文容器：360×270（含内边距）。仅编辑态拦截滚轮做正文滚动，非编辑态交给画布平移（IKFMQO TC_CX_001/015） */}
      <div className={`${styles.contentCard}${editing ? ' nowheel' : ''}`} data-testid="text-content" style={expanded ? { height: 540, maxHeight: '70vh' } : undefined}>
        {/* IKFM3Q 契约 §4：每张文本卡都可能承接媒体索引关系线，target 连接点常驻
           （isFirst 首卡与其余卡一致；连接点默认透明，悬停/连接中才可见，无视觉成本；
           媒体→文本卡手工拖线仍被 connectPair 拒绝，既有规则面不变） */}
        <Handle type="target" position={Position.Left} className={styles.handle} style={{ ...HANDLE_STYLE, left: '-16px' }}>
          <HandlePlus />
        </Handle>

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
          style={{
            pointerEvents: isSelect && (!isTextGen || writingSelf) ? 'auto' : 'none',
            overflowY: editing ? 'auto' : 'hidden',
          }}
          onFocus={() => setIsFocused(true)}
          onBlur={(e) => {
            // 如果焦点转移到工具栏/操作条/@菜单/标签操作层/素材预览，保持编辑状态
            const related = e.relatedTarget as HTMLElement | null;
            if (related && related.closest(`.${styles.toolbar}, .${styles.nodeBar}, .${styles.chipMenu}, .${styles.chipPreview}, [data-testid="mention-menu"]`)) return;
            setIsFocused(false);
            setEditing(false);
            setWritingSelf(false);
          }}
          onInput={handleEditorInput}
          onClick={event => {
            const mediaChip = (event.target as HTMLElement).closest<HTMLElement>('[data-media-node]');
            if (mediaChip) {
              const nodeId = mediaChip.dataset.mediaNode ?? '';
              const invalid = mediaChip.dataset.mediaInvalid === '1';
              setSelectedMention(null);
              // 非编辑态点击有效标签直接定位来源；其余（编辑态/失效）弹出操作层（契约 §5）
              if (!editing && !invalid) { locateSource(nodeId); return; }
              openChipMenu(mediaChip);
              return;
            }
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
          onMouseOver={handleEditorMouseOver}
          onMouseOut={handleEditorMouseOut}
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

      {/* IKFM3Q：@ 素材菜单（光标处插入 / 失效身份重绑定；不含文本互引）。
          IKFR6A：锚点 portal 到 body——渲染在画布变换层内时 fixed 被劫持、锚点飞移 */}
      {mentionMenu && createPortal(
        <span ref={mentionAnchorRef} style={{ position: 'fixed', left: mentionMenu.x, top: mentionMenu.y, width: 0, height: 0 }} />,
        document.body,
      )}
      {mentionMenu && (
        <AtMentionMenu
          anchorRef={mentionAnchorRef}
          items={mediaMentionItems}
          editorQuery=""
          disabledKinds={['text']}
          onSelect={handleMediaSelect}
          onClose={() => { setMentionMenu(null); editorRef.current?.focus(); restoreSelection(); }}
        />
      )}

      {/* media 标签操作层：定位来源 / 替换来源（失效=重新绑定）/ 删除标签（契约 §3/§5）；IKFR6A portal 到 body 钉在屏幕上 */}
      {chipMenu && createPortal(
        <div className={`${styles.chipMenu} nodrag nopan`} style={{ left: chipMenu.x, top: chipMenu.y }} data-testid="media-chip-menu">
          {chipMenu.chip.dataset.mediaInvalid !== '1' && (
            <button type="button" className={styles.chipMenuBtn} onClick={() => { locateSource(chipMenu.chip.dataset.mediaNode ?? ''); setChipMenu(null); }}>
              <Crosshair size={13} strokeWidth={2} /><span>定位来源</span>
            </button>
          )}
          <button type="button" className={styles.chipMenuBtn} onClick={() => {
            const nodeId = chipMenu.chip.dataset.mediaNode ?? '';
            const rect = chipMenu.chip.getBoundingClientRect();
            // 重绑定菜单打开前同样记录光标：取消关闭后恢复到打开时位置（契约 §5）
            saveSelection();
            setChipMenu(null);
            setMentionMenu({ mode: 'rebind', rebindNodeId: nodeId, rebindChip: chipMenu.chip, x: rect.left, y: rect.bottom });
          }}>
            <RefreshCw size={13} strokeWidth={2} /><span>{chipMenu.chip.dataset.mediaInvalid === '1' ? '重新绑定' : '替换来源'}</span>
          </button>
          <button type="button" className={`${styles.chipMenuBtn} ${styles.chipMenuDanger}`} onClick={() => {
            const chip = chipMenu.chip;
            const editor = editorRef.current;
            setChipMenu(null);
            // 光标落被删标签原位置（契约 §5 删除落点）：优先锚前一张标签后，其次后一张标签前；
            // 序号按删除后的 DOM 计（先移除再取），同身份后一张重放后才能对上
            const index = editor ? [...editor.querySelectorAll<HTMLElement>('[data-media-node]')].indexOf(chip) : -1;
            chip.remove();
            let anchor: MediaEditAnchor | undefined;
            if (editor) {
              const rest = [...editor.querySelectorAll<HTMLElement>('[data-media-node]')];
              const prev = index > 0 ? rest[index - 1] : undefined;
              const next = index === 0 ? rest[0] : undefined;
              if (prev) anchor = chipAnchorOf(editor, prev, 'after');
              else if (next) anchor = chipAnchorOf(editor, next, 'before');
            }
            commitMediaEdit({ added: [], removed: [] }, anchor);
          }}>
            <Trash2 size={13} strokeWidth={2} /><span>删除标签</span>
          </button>
        </div>,
        document.body,
      )}

      {/* media 标签悬停预览（契约 §5：图片/视频缩略预览，音频出类型标识与名称）；
          IKFR6A portal 到 body 钉在屏幕上，默认标签上方、顶部放不下翻到下方 */}
      {chipPreview && createPortal(
        <div className={`${styles.chipPreview} ${chipPreview.below ? styles.chipPreviewBelow : ''} nodrag nopan`} style={{ left: chipPreview.x, top: chipPreview.y }} data-testid="media-chip-preview">
          {chipPreview.chip.dataset.mediaType === 'image' && <img src={chipPreview.chip.dataset.mediaUrl} alt="" />}
          {chipPreview.chip.dataset.mediaType === 'video' && <video src={chipPreview.chip.dataset.mediaUrl} muted autoPlay loop playsInline />}
          {chipPreview.chip.dataset.mediaType === 'audio' && <div className={styles.chipPreviewAudio}><AudioLines size={28} strokeWidth={1.5} /><span>音频</span></div>}
          <div className={styles.chipPreviewName}>{chipPreview.chip.dataset.mediaName}</div>
        </div>,
        document.body,
      )}

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
