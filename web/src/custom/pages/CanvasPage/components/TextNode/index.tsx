import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, useStore, useReactFlow, type NodeProps } from '@xyflow/react';
import { Bold, Italic, List, ListOrdered, Minus, Heading1, Heading2, Heading3, FileText, AtSign, Plus, Crosshair, RefreshCw, Trash2, AudioLines } from 'lucide-react';
import { sanitizeHtml } from '@/custom/utils/sanitize';
import { remoteImageCrossOrigin, resolveMediaSrc } from '@/shared/utils/remoteImageCors';
import { nodeTitleSizing } from '../nodeTitleSizing';
import { commitCardName } from '../cardName';
import CanvasContextMenu from '../CanvasContextMenu';
import AtMentionMenu from '../AtMentionMenu';
import type { AtMentionItem } from '../../atMention';
import styles from './index.module.css';
import chipStyles from '../mediaChip.module.css';
import { PROMPT_TEXT_LIMITS } from '@lib/contracts/prompt-text-limits';
import { promptMentionSchema, validPromptMentions, type PromptMention, type PromptMaterial } from '@lib/contracts/prompt-preview';
import { markdownToSanitizedHtml } from '@lib/contracts/text-node-markdown';
import FollowToolbarLayer from './FollowToolbarLayer';
import { type MediaMention, type MediaRef } from '@lib/contracts/text-node-media';
import { renderPromptMentions, readPromptMentions, applyMediaMentionState, createMediaMentionChip } from './promptMentions';
import { applyMarkdownInputRule } from './markdownInputRules';
import { useSoloNodeSelected } from '../../useSoloNodeSelected';

const MAX_TEXT_LENGTH = PROMPT_TEXT_LIMITS.text;

const NODE_BAR_LIFT = 42;

const HOVER_BRIDGE_CLEAR_MS = 120;

const TEXT_BODY_DOUBLE_PRESS_MS = 350;
const lastTextBodyPressAt = new Map<string, number>();

const HANDLE_STYLE = { background: 'transparent', border: 'none', width: 24, height: 24 } as const;

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

type ChipAnchor =
  | { kind: 'media' | 'prompt'; key: string; occurrence: number; placement: 'before' | 'after' }
  | { kind: 'caret'; offset: number };

function chipsOfKey(editor: HTMLElement, kind: Exclude<ChipAnchor, { kind: 'caret' }>['kind'], key: string): HTMLElement[] {
  const selector = kind === 'media' ? `[data-media-node="${CSS.escape(key)}"]` : `[data-prompt-index="${CSS.escape(key)}"]`;
  return [...editor.querySelectorAll<HTMLElement>(selector)];
}

function chipAnchorOf(editor: HTMLElement, chip: HTMLElement, placement: 'before' | 'after'): ChipAnchor {
  if (chip.dataset.mediaNode) {
    return { kind: 'media', key: chip.dataset.mediaNode, occurrence: chipsOfKey(editor, 'media', chip.dataset.mediaNode).indexOf(chip) + 1, placement };
  }
  const key = chip.dataset.promptIndex ?? '';
  return { kind: 'prompt', key, occurrence: chipsOfKey(editor, 'prompt', key).indexOf(chip) + 1, placement };
}

function resolveLiveMentionChip(editor: HTMLElement, chip: HTMLElement, occurrence = 1): HTMLElement | null {
  if (chip.isConnected && editor.contains(chip)) return chip;
  const kind = chip.dataset.mediaNode ? 'media' : 'prompt';
  const key = chip.dataset.mediaNode || chip.dataset.promptIndex || '';
  if (!key) return null;
  const chips = chipsOfKey(editor, kind, key);
  return chips[occurrence - 1] ?? chips[0] ?? null;
}

const MENTION_CHIP_SELECTOR = '[data-media-node], [data-prompt-index]';

function chipSourceNodeId(chip: HTMLElement): string {
  return chip.dataset.mediaNode || chip.dataset.promptMirrorNode || '';
}

function chipPreviewFields(chip: HTMLElement): { mediaType: string; url: string; name: string } {
  const media = chip.querySelector<HTMLImageElement | HTMLVideoElement>('img, video');
  const mediaType = chip.dataset.mediaType || chip.dataset.promptMirrorType
    || (media instanceof HTMLVideoElement ? 'video' : media instanceof HTMLImageElement ? 'image' : 'audio');
  const url = chip.dataset.mediaUrl || chip.dataset.promptMirrorUrl || media?.getAttribute('src') || '';
  const name = chip.dataset.mediaName || chip.dataset.promptMirrorName || chip.dataset.promptLabel || '';
  return { mediaType, url, name };
}

function domTextOffsetOfChipStart(editor: HTMLElement, chip: HTMLElement): number {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let offset = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (chip.contains(node)) return offset;
    offset += node.textContent?.length ?? 0;
  }
  return offset;
}

function placeCaretAtTextOffset(editor: HTMLElement, offset: number): boolean {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (remaining <= length) {
      const range = document.createRange();
      range.setStart(node, remaining);
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return true;
    }
    remaining -= length;
  }
  return false;
}

interface TextNodeData {
  promptSource?: unknown;
  promptMentions?: PromptMention[];
  promptMaterials?: Array<PromptMaterial & { url: string }>;
  onPromptChange?: (id: string, text: string, mentions: PromptMention[], materials?: Array<PromptMaterial & { url: string }>) => void;
  mediaMentions?: MediaMention[];
  mediaRefs?: MediaRef[];
  onMediaIndexChange?: (id: string, mediaMentions: MediaMention[], mediaRefs: MediaRef[], delta: { added: string[]; removed: string[] }) => void;
  title?: string;
  onTitleChange?: (id: string, title: string) => void;
  onDraftError?: (id: string, error: string) => void;
  onTextChange?: (id: string, text: string) => void;
  html?: string;
  text?: string;
  toolMode?: 'drag' | 'select';
  isFirst?: boolean;
  onDelete?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onAddToChat?: (id: string) => void;
  onSaveToAssets?: (id: string) => void;
  onPaste?: (id: string) => void;
  onToast?: (type: 'success' | 'error' | 'warn', msg: string) => void;
  textGen?: boolean;
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
  const [editing, setEditing] = useState(false);
  const [writingSelf, setWritingSelf] = useState(false);
  const [hovered, setHovered] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const hoverClearTimerRef = useRef<number | null>(null);
  const clearHoverBridge = useCallback(() => {
    if (hoverClearTimerRef.current != null) {
      window.clearTimeout(hoverClearTimerRef.current);
      hoverClearTimerRef.current = null;
    }
  }, []);
  const hideHoverToolbar = useCallback(() => {
    clearHoverBridge();
    setHovered(false);
  }, [clearHoverBridge]);
  const scheduleHoverClear = useCallback((restart = true) => {
    if (!restart && hoverClearTimerRef.current != null) return;
    clearHoverBridge();
    hoverClearTimerRef.current = window.setTimeout(() => {
      hoverClearTimerRef.current = null;
      setHovered(false);
    }, HOVER_BRIDGE_CLEAR_MS);
  }, [clearHoverBridge]);
  const pointerOverHoverZone = useCallback((clientX: number, clientY: number) => {
    const el = document.elementFromPoint(clientX, clientY);
    if (!el) return false;
    return Boolean(wrapperRef.current?.contains(el) || layerRef.current?.contains(el));
  }, []);
  const handleHoverZoneEnter = useCallback(() => {
    clearHoverBridge();
    setHovered(true);
  }, [clearHoverBridge]);
  const handleHoverZoneLeave = useCallback(() => {
    scheduleHoverClear(true);
  }, [scheduleHoverClear]);
  useEffect(() => clearHoverBridge, [clearHoverBridge]);
  useEffect(() => {
    if (!hovered) return;
    const onPointerMove = (event: PointerEvent) => {
      if (pointerOverHoverZone(event.clientX, event.clientY)) {
        clearHoverBridge();
        return;
      }
      scheduleHoverClear(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (pointerOverHoverZone(event.clientX, event.clientY)) return;
      hideHoverToolbar();
    };
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [hovered, pointerOverHoverZone, clearHoverBridge, scheduleHoverClear, hideHoverToolbar]);
  const isTextGen = data.textGen === true;
  const hasTextGenBody = Boolean(
    (typeof data.text === 'string' && data.text.trim())
    || (typeof data.html === 'string' && data.html.replace(/<[^>]+>/g, '').trim()),
  );
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const savedAnchorRef = useRef<ChipAnchor | null>(null);
  const initializedRef = useRef(false);
  const draftMaterialsRef = useRef(data.promptMaterials);
  useEffect(() => { draftMaterialsRef.current = data.promptMaterials; }, [data.promptMaterials]);

  const showSoloToolbar = useSoloNodeSelected(selected);
  const canvasNodes = useStore(state => state.nodes);

  const canvasEdges = useStore(state => state.edges);
  const rf = useReactFlow();
  const mediaValidity = useCallback((nodeId: string) => {
    if (!canvasNodes.some(node => node.id === nodeId)) return false;
    return canvasEdges.some(edge => edge.source === nodeId && edge.target === id
      && (edge.data as Record<string, unknown> | undefined)?.textIndex === true);
  }, [canvasNodes, canvasEdges, id]);

  const mediaMentionItems: AtMentionItem[] = canvasNodes.filter(node => node.type === 'mediaNode' && node.data.assetId && !node.data.assetMissing && node.data.genStatus !== 'generating'
    && ['image', 'video', 'audio'].includes(String(node.data.mediaType)) && typeof node.data.src === 'string')
    .map(node => ({
      id: node.id,
      kind: String(node.data.mediaType) as AtMentionItem['kind'],
      name: String(node.data.fileName || node.data.assetId),
      thumbUrl: String(node.data.src),
      assetId: String(node.data.assetId),
    }));

  const [mentionMenu, setMentionMenu] = useState<{ mode: 'insert' | 'rebind'; rebindNodeId?: string; rebindChip?: HTMLElement; x: number; y: number } | null>(null);
  const mentionAnchorRef = useRef<HTMLSpanElement>(null);
  const [chipMenu, setChipMenu] = useState<{ chip: HTMLElement; x: number; y: number; occurrence: number } | null>(null);
  const [chipPreview, setChipPreview] = useState<{ chip: HTMLElement; x: number; y: number; below: boolean } | null>(null);
  const previewTimerRef = useRef<number | null>(null);
  const mediaIndexRef = useRef<{ mediaMentions: MediaMention[]; mediaRefs: MediaRef[] }>({ mediaMentions: data.mediaMentions ?? [], mediaRefs: data.mediaRefs ?? [] });
  useEffect(() => { mediaIndexRef.current = { mediaMentions: data.mediaMentions ?? [], mediaRefs: data.mediaRefs ?? [] }; }, [data.mediaMentions, data.mediaRefs]);
  const committedReplayRef = useRef<{ text: string; prompt: string; media: string } | null>(null);
  const removingChipRef = useRef(false);

  const zoom = useStore((state) => state.transform[2]);

  const isSelect = data.toolMode === 'select';

  useEffect(() => {
    if (!isSelect) {
      setIsFocused(false);
      setEditing(false);
      editorRef.current?.blur();
    }
  }, [isSelect]);

  useEffect(() => {
    if (!initializedRef.current && editorRef.current) {
      if (typeof data.text === 'string') renderPromptMentions(editorRef.current, data.text, data.promptMentions ?? [], data.promptMaterials ?? [], data.mediaMentions ?? [], data.mediaRefs ?? [], mediaValidity);
      else editorRef.current.innerHTML = sanitizeHtml(data.html || '');
      initializedRef.current = true;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (chipMenu || mentionMenu) return;
    if (!editing && !contentError && editorRef.current && typeof data.text === 'string') {
      const committed = committedReplayRef.current;
      if (committed) {
        const propsCaughtUp = data.text === committed.text
          && JSON.stringify(data.promptMentions ?? []) === committed.prompt
          && JSON.stringify(data.mediaMentions ?? []) === committed.media;
        if (!propsCaughtUp) return;
        committedReplayRef.current = null;
      }
      renderPromptMentions(editorRef.current, data.text, data.promptMentions ?? [], data.promptMaterials ?? [], data.mediaMentions ?? [], data.mediaRefs ?? [], mediaValidity);
    }
  }, [editing, contentError, chipMenu, mentionMenu, data.text, data.promptMentions, data.promptMaterials, data.mediaMentions, data.mediaRefs, mediaValidity]);

  useEffect(() => {
    if (editing && editorRef.current) applyMediaMentionState(editorRef.current, mediaValidity);
  }, [editing, mediaValidity]);

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

  const saveSelection = useCallback(() => {
    savedAnchorRef.current = null;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      if (editorRef.current?.contains(range.commonAncestorContainer)) {
        savedRangeRef.current = range.cloneRange();
      }
    }
  }, []);

  const restoreSelection = useCallback(() => {
    const sel = window.getSelection();
    const range = savedRangeRef.current;
    if (sel && range && editorRef.current?.contains(range.startContainer)) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }, []);

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

  const cancelTitle = useCallback(() => {
    setTitleDraft(data.title ?? (isTextGen ? '文本生成' : '文本节点'));
    setTitleError('');
    setTitleEditing(false);
  }, [data.title, isTextGen]);

  const notifyMediaIndex = useCallback((next: { mediaMentions: MediaMention[]; mediaRefs: MediaRef[] }, delta: { added: string[]; removed: string[] }) => {
    const prevIds = new Set(mediaIndexRef.current.mediaMentions.map(mention => mention.nodeId));
    const nextIds = new Set(next.mediaMentions.map(mention => mention.nodeId));
    const removed = [...new Set([...delta.removed, ...[...prevIds].filter(nodeId => !nextIds.has(nodeId))])];
    const added = delta.added.filter(nodeId => nextIds.has(nodeId));
    const changed = JSON.stringify(mediaIndexRef.current.mediaMentions) !== JSON.stringify(next.mediaMentions)
      || JSON.stringify(mediaIndexRef.current.mediaRefs) !== JSON.stringify(next.mediaRefs);
    mediaIndexRef.current = { mediaMentions: next.mediaMentions, mediaRefs: next.mediaRefs };
    if (!changed && added.length === 0 && removed.length === 0) return;
    data.onMediaIndexChange?.(id, next.mediaMentions, next.mediaRefs, { added, removed });
  }, [data, id]);

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

  const restoreChipAnchor = useCallback((anchor?: ChipAnchor) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    let placed = false;
    if (anchor?.kind === 'caret') {
      placed = placeCaretAtTextOffset(editor, anchor.offset);
    } else if (anchor) {
      const chip = chipsOfKey(editor, anchor.kind, anchor.key)[anchor.occurrence - 1];
      if (chip) {
        const range = document.createRange();
        if (anchor.placement === 'after') range.setStartAfter(chip);
        else range.setStartBefore(chip);
        range.collapse(true);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        placed = true;
      }
    }
    if (!placed) {
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    savedRangeRef.current = window.getSelection()?.getRangeAt(0).cloneRange() ?? null;
  }, []);

  useEffect(() => {
    if (!editing) return;
    editorRef.current?.focus();
    const anchor = savedAnchorRef.current;
    if (anchor) { savedAnchorRef.current = null; restoreChipAnchor(anchor); }
    else restoreSelection();
  }, [editing, restoreChipAnchor, restoreSelection]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const enterEdit = () => {
      if (!isSelect) return;
      if (isTextGen && !writingSelf) return;
      setEditing(true);
    };
    editor.addEventListener('bw-enter-edit', enterEdit);
    return () => editor.removeEventListener('bw-enter-edit', enterEdit);
  }, [isSelect, isTextGen, writingSelf]);

  const commitMediaEdit = useCallback((delta: { added: string[]; removed: string[] }, anchor?: ChipAnchor) => {
    const editor = editorRef.current;
    if (!editor) return;
    const validity = (nodeId: string) => delta.added.includes(nodeId) || mediaValidity(nodeId);
    const content = readPromptMentions(editor, validity);
    renderPromptMentions(editor, content.text, content.mentions, draftMaterialsRef.current ?? [], content.mediaMentions, content.mediaRefs, validity);
    committedReplayRef.current = {
      text: content.text,
      prompt: JSON.stringify(content.mentions),
      media: JSON.stringify(content.mediaMentions),
    };
    restoreChipAnchor(anchor);
    savedAnchorRef.current = anchor ?? null;
    setChipMenu(null);
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
    notifyMediaIndex(content, delta);
  }, [data, id, hasPromptBindings, mediaValidity, notifyMediaIndex, restoreChipAnchor]);

  const removeActiveChip = useCallback((event: React.SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (removingChipRef.current) return;
    const editor = editorRef.current;
    if (!chipMenu || !editor) return;
    removingChipRef.current = true;
    window.setTimeout(() => { removingChipRef.current = false; }, 0);
    const chip = resolveLiveMentionChip(editor, chipMenu.chip, chipMenu.occurrence);
    setChipMenu(null);
    if (!chip) return;
    const offset = domTextOffsetOfChipStart(editor, chip);
    const sourceId = chipSourceNodeId(chip);
    const deletedPrompt = Boolean(chip.dataset.promptIndex);
    chip.remove();
    if (sourceId) {
      const twinSelector = deletedPrompt
        ? `[data-media-node="${CSS.escape(sourceId)}"]`
        : `[data-prompt-mirror-node="${CSS.escape(sourceId)}"]`;
      for (const twin of editor.querySelectorAll<HTMLElement>(twinSelector)) twin.remove();
    }
    commitMediaEdit({ added: [], removed: [] }, { kind: 'caret', offset });
  }, [chipMenu, commitMediaEdit]);

  const openMentionMenuAtCaret = useCallback(() => {
    const editor = editorRef.current;
    const sel = window.getSelection();
    if (!editor || !sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!range.collapsed || !editor.contains(range.startContainer)) return;
    const container = range.startContainer;
    if (container.nodeType === Node.TEXT_NODE) {
      const text = container.textContent ?? '';
      if (text[range.startOffset - 1] !== '@') return;
    } else if (range.startOffset > 0) {
      const prev = container.childNodes[range.startOffset - 1];
      if (prev && prev.nodeName !== 'BR') return;
    }
    saveSelection();
    const rect = range.getBoundingClientRect();
    setMentionMenu({ mode: 'insert', x: rect.left, y: rect.bottom });
  }, [saveSelection]);

  const handleMediaSelect = useCallback((item: AtMentionItem) => {
    const editor = editorRef.current;
    if (!editor || !item.assetId || (item.kind !== 'image' && item.kind !== 'video' && item.kind !== 'audio')) return;
    const identity = { nodeId: item.id, assetId: item.assetId, mediaType: item.kind, name: item.name, url: item.thumbUrl ?? '' };
    const menu = mentionMenu;
    setMentionMenu(null);
    editor.focus();
    if (menu?.mode === 'rebind') {
      const oldNodeId = menu.rebindNodeId ?? '';
      const sameSource = Boolean(oldNodeId && oldNodeId === identity.nodeId);
      if (sameSource) {
        const live = menu.rebindChip?.isConnected ? menu.rebindChip : null;
        commitMediaEdit({ added: [identity.nodeId], removed: [] },
          live ? chipAnchorOf(editor, live, 'after') : undefined);
        return;
      }
      let clickedNext: HTMLElement | null = null;
      const replaceChip = (chip: HTMLElement) => {
        const next = createMediaMentionChip(identity, identity.name, false);
        chip.replaceWith(next);
        if (chip === menu.rebindChip) clickedNext = next;
      };
      if (oldNodeId) {
        for (const chip of editor.querySelectorAll<HTMLElement>(`[data-media-node="${CSS.escape(oldNodeId)}"]`)) replaceChip(chip);
        for (const chip of editor.querySelectorAll<HTMLElement>(`[data-prompt-mirror-node="${CSS.escape(oldNodeId)}"]`)) replaceChip(chip);
      }
      if (menu.rebindChip?.isConnected && menu.rebindChip.dataset.promptIndex) replaceChip(menu.rebindChip);
      const removed = oldNodeId && oldNodeId !== identity.nodeId ? [oldNodeId] : [];
      commitMediaEdit({ added: [identity.nodeId], removed },
        clickedNext ? chipAnchorOf(editor, clickedNext, 'after') : undefined);
      return;
    }
    restoreSelection();
    const base = savedRangeRef.current?.cloneRange();
    const range = base && editor.contains(base.startContainer)
      ? base
      : (() => { const r = document.createRange(); r.selectNodeContents(editor); r.collapse(false); return r; })();
    if (range.startContainer.nodeType === Node.TEXT_NODE && range.startOffset > 0
      && (range.startContainer.textContent ?? '')[range.startOffset - 1] === '@') {
      range.setStart(range.startContainer, range.startOffset - 1);
      range.deleteContents();
    }
    const chip = createMediaMentionChip(identity, identity.name, false);
    range.insertNode(chip);
    range.setStartAfter(chip);
    range.collapse(true);
    savedRangeRef.current = range;
    commitMediaEdit({ added: [identity.nodeId], removed: [] }, chipAnchorOf(editor, chip, 'after'));
  }, [mentionMenu, restoreSelection, commitMediaEdit]);

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

  const openChipMenu = useCallback((chip: HTMLElement, pointer?: { x: number; y: number }) => {
    const editor = editorRef.current;
    const kind = chip.dataset.mediaNode ? 'media' : 'prompt';
    const key = chip.dataset.mediaNode || chip.dataset.promptIndex || '';
    const occurrence = editor && key ? chipsOfKey(editor, kind, key).indexOf(chip) + 1 : 1;
    const rect = chip.getBoundingClientRect();
    setChipMenu({
      chip,
      x: pointer?.x ?? rect.left,
      y: pointer?.y ?? rect.top,
      occurrence: occurrence > 0 ? occurrence : 1,
    });
  }, []);

  const handleEditorMouseOver = useCallback((event: React.MouseEvent) => {
    const chip = (event.target as HTMLElement).closest?.(MENTION_CHIP_SELECTOR) as HTMLElement | null;
    if (previewTimerRef.current) { window.clearTimeout(previewTimerRef.current); previewTimerRef.current = null; }
    if (!chip || chip.dataset.mediaInvalid === '1') { setChipPreview(null); return; }
    previewTimerRef.current = window.setTimeout(() => {
      const rect = chip.getBoundingClientRect();
      setChipPreview({ chip, x: rect.left, y: rect.bottom + 8, below: true });
    }, 150);
  }, []);

  const handleEditorMouseOut = useCallback((event: React.MouseEvent) => {
    const chip = (event.target as HTMLElement).closest?.(MENTION_CHIP_SELECTOR) as HTMLElement | null;
    if (!chip || chip.contains(event.relatedTarget as Node)) return;
    if (previewTimerRef.current) { window.clearTimeout(previewTimerRef.current); previewTimerRef.current = null; }
    setChipPreview(null);
  }, []);

  useEffect(() => {
    if (!chipMenu) return;
    const close = (event: Event) => {
      if ((event.target as HTMLElement | null)?.closest?.(`.${styles.chipMenu}`)) return;
      setChipMenu(null);
    };
    const timer = window.setTimeout(() => document.addEventListener('pointerdown', close, true), 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerdown', close, true);
    };
  }, [chipMenu]);

  const execCmd = useCallback((cmd: string, value?: string) => {
    editorRef.current?.focus();
    restoreSelection();
    document.execCommand(cmd, false, value);
    saveSelection();
    syncContent();
  }, [restoreSelection, saveSelection, syncContent]);

  const setHeading = useCallback((level: string) => {
    editorRef.current?.focus();
    restoreSelection();
    document.execCommand('formatBlock', false, level);
    saveSelection();
    syncContent();
  }, [restoreSelection, saveSelection, syncContent]);

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

  const handleDuplicate = useCallback(() => {
    setContextMenu(null);
    data.onDuplicate?.(id);
  }, [data, id]);

  const handleAddToChat = useCallback(() => {
    setContextMenu(null);
    data.onAddToChat?.(id);
  }, [data, id]);


  const handleEditorMouseUp = useCallback(() => {
    if (!editing) return;
    saveSelection();
  }, [editing, saveSelection]);

  const handleBodyDoublePress = useCallback((e: React.PointerEvent) => {
    if (editing || !isSelect || e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.react-flow__handle')) return;
    if (isTextGen && !writingSelf) return;
    const now = performance.now();
    const prev = lastTextBodyPressAt.get(id) ?? 0;
    lastTextBodyPressAt.set(id, now);
    if (now - prev >= 80 && now - prev < TEXT_BODY_DOUBLE_PRESS_MS) {
      e.stopPropagation();
      setEditing(true);
    }
  }, [editing, isSelect, isTextGen, writingSelf, id]);

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
      } catch {  }
    }
    if (!inserted) document.execCommand('insertHTML', false, markdownToSanitizedHtml(e.clipboardData.getData('text/plain')));
    saveSelection();
    syncContent();
  }, [saveSelection, syncContent, hasPromptBindings, id, data.promptMaterials]);

  const handleEditorInput = useCallback((e: React.FormEvent<HTMLDivElement>) => {
    const native = e.nativeEvent as InputEvent;
    if (native.inputType === 'insertText' && editorRef.current && native.data) {
      applyMarkdownInputRule(editorRef.current, native.data);
      if (native.data === '@') openMentionMenuAtCaret();
    }
    syncContent();
  }, [syncContent, openMentionMenuAtCaret]);

  const handleEditorKeyUp = useCallback(() => {
    saveSelection();
    syncContent();
  }, [saveSelection, syncContent]);

  return (
    <div
      ref={wrapperRef}
      className={`${styles.wrapper} ${selected ? styles.selected : ''} ${isFocused && isSelect ? `${styles.focused} nodrag` : ''}`}
      onContextMenu={handleContextMenu}
      onPointerEnter={handleHoverZoneEnter}
      onPointerLeave={handleHoverZoneLeave}
      onMouseEnter={handleHoverZoneEnter}
      onMouseLeave={handleHoverZoneLeave}
      style={nodeTitleSizing(zoom)}
    >
      {}
      <FollowToolbarLayer
        nodeId={id}
        show={isFocused || showSoloToolbar || hovered}
        toolbarLift={isFocused ? undefined : NODE_BAR_LIFT}
        layerRef={layerRef}
        onLayerPointerEnter={handleHoverZoneEnter}
        onLayerPointerLeave={handleHoverZoneLeave}
      >
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

            {}
            <div className={styles.divider} />
            <button className={styles.toolBtn} onClick={() => data.onAddToChat?.(id)} title="添加到对话">
              <AtSign size={14} strokeWidth={2} />
              <span>添加到对话</span>
            </button>
          </div>
        ) : (
          <div className={`${styles.nodeBar} nodrag nopan`}>
            <button className={styles.addToChatBtn} onClick={() => data.onAddToChat?.(id)}>
              <AtSign size={14} strokeWidth={2} />
              <span>添加到对话</span>
            </button>
          </div>
        )}
      </FollowToolbarLayer>

      {}
      <div className={styles.titleRow} data-testid="text-title">
        <div className={styles.titleLeft}>
          <FileText className={styles.titleIcon} strokeWidth={2} color="#888" />
          {titleEditing ? <input className="nodrag nopan" aria-label="文本节点标题" value={titleDraft} autoFocus
            onChange={event => setTitleDraft(event.target.value)}
            onBlur={commitTitle}
            onKeyDown={event => {
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
      {}
      <div
        className={`${styles.contentCard}${editing ? ' nowheel' : ''}`}
        data-testid="text-content"
        style={expanded ? { height: 540, maxHeight: '70vh' } : undefined}
        onPointerDown={handleBodyDoublePress}
      >
        {}
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
          className={`${styles.editor} ${editing ? `${styles.editorScrolling} nodrag nopan` : ''}`}
          contentEditable={editing ? true : false}
          suppressContentEditableWarning
          style={{
            pointerEvents: isSelect && (!isTextGen || writingSelf) ? 'auto' : 'none',
          }}
          onFocus={() => setIsFocused(true)}
          onBlur={(e) => {
            const related = e.relatedTarget as HTMLElement | null;
            if (related && related.closest(`.${styles.toolbar}, .${styles.nodeBar}, [data-gen-panel-territory], .${styles.chipMenu}, .${chipStyles.chipPreview}, [data-testid="mention-menu"]`)) return;
            setIsFocused(false);
            setEditing(false);
            setWritingSelf(false);
          }}
          onInput={handleEditorInput}
          onClick={event => {
            const chip = (event.target as HTMLElement).closest<HTMLElement>(MENTION_CHIP_SELECTOR);
            if (!chip) return;
            openChipMenu(chip, { x: event.clientX, y: event.clientY });
            setChipPreview(null);
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

      {}
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

      {}
      {chipMenu && createPortal(
        <div
          className={`${styles.chipMenu} nodrag nopan`}
          style={{ left: chipMenu.x, top: chipMenu.y }}
          data-testid="media-chip-menu"
          data-canvas-overlay
          onPointerDown={event => event.stopPropagation()}
          onClick={event => event.stopPropagation()}
        >
          {chipMenu.chip.dataset.mediaInvalid !== '1' && chipSourceNodeId(chipMenu.chip) && (
            <button type="button" className={styles.chipMenuBtn} onPointerDown={event => { event.preventDefault(); event.stopPropagation(); locateSource(chipSourceNodeId(chipMenu.chip)); setChipMenu(null); }}>
              <Crosshair size={13} strokeWidth={2} /><span>定位来源</span>
            </button>
          )}
          <button type="button" className={styles.chipMenuBtn} onPointerDown={event => {
            event.preventDefault();
            event.stopPropagation();
            const editor = editorRef.current;
            const chip = editor ? resolveLiveMentionChip(editor, chipMenu.chip, chipMenu.occurrence) : chipMenu.chip;
            if (!chip) { setChipMenu(null); return; }
            const nodeId = chipSourceNodeId(chip);
            const rect = chip.getBoundingClientRect();
            saveSelection();
            setChipMenu(null);
            setMentionMenu({ mode: 'rebind', rebindNodeId: nodeId, rebindChip: chip, x: rect.left, y: rect.bottom });
          }}>
            <RefreshCw size={13} strokeWidth={2} /><span>{chipMenu.chip.dataset.mediaInvalid === '1' ? '重新绑定' : '替换来源'}</span>
          </button>
          <button type="button" className={`${styles.chipMenuBtn} ${styles.chipMenuDanger}`} onPointerDown={removeActiveChip} onClick={removeActiveChip}>
            <Trash2 size={13} strokeWidth={2} /><span>删除标签</span>
          </button>
        </div>,
        document.body,
      )}

      {}
      {chipPreview && createPortal((() => {
        const preview = chipPreviewFields(chipPreview.chip);
        return (
        <div className={`${chipStyles.chipPreview} ${chipPreview.below ? chipStyles.chipPreviewBelow : ''} nodrag nopan`} style={{ left: chipPreview.x, top: chipPreview.y }} data-testid="media-chip-preview" data-canvas-overlay>
          {preview.mediaType === 'image' && <img src={resolveMediaSrc(preview.url)} crossOrigin={remoteImageCrossOrigin(preview.url)} alt="" />}
          {preview.mediaType === 'video' && <video src={resolveMediaSrc(preview.url)} muted autoPlay loop playsInline />}
          {preview.mediaType === 'audio' && <div className={chipStyles.chipPreviewAudio}><AudioLines size={28} strokeWidth={1.5} /><span>音频</span></div>}
          <div className={chipStyles.chipPreviewName}>{preview.name}</div>
        </div>
        );
      })(), document.body)}

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
