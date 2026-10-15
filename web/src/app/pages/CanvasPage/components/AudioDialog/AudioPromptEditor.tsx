import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { flattenPromptDocWith, type PromptDoc, type PromptRefKey } from '@/app/utils/prompt-doc';
import PromptRefEditor, { type PromptRefEditorHandle, type MentionState } from '../PromptRefEditor';
import type { AssetRefMeta } from '../PromptRefEditor/AssetRefNode';
import AtMentionMenu from '../AtMentionMenu';
import type { AtMentionItem } from '../../atMention';
import type { ImageTextAttachment } from '../ImageDialog';
import { audioRefItemMediaTypeOf } from '../../audioMediaRefs';
import type { AudioRefItem } from './index';

interface Props {
  refs: AudioRefItem[];
  attachments?: ImageTextAttachment[];
  initialDoc?: PromptDoc | null;
  initialText?: string;
  readOnly?: boolean;
  placeholder?: string;
  className?: string;
  mentionItems?: AtMentionItem[];
  onMentionCanvas?: (item: AtMentionItem) => void;
  onChange: (doc: PromptDoc, text: string) => void;
  onSubmit?: () => void;
}
export interface AudioPromptEditorHandle { insert: (key: PromptRefKey) => void; clear: () => void }

export default forwardRef<AudioPromptEditorHandle, Props>(function AudioPromptEditor(
  { refs, attachments = [], initialDoc, initialText, readOnly, placeholder, className, mentionItems = [], onMentionCanvas, onChange, onSubmit }, ref,
) {
  const editor = useRef<PromptRefEditorHandle>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const pending = useRef<{ key: PromptRefKey; replacement: string | null } | null>(null);
  const [mention, setMention] = useState<MentionState>({ open: false, query: '' });
  const [replacement, setReplacement] = useState<string | null>(null);
  const labels = new Map<string, string>();
  const meta = new Map<string, AssetRefMeta>();
  let audioIndex = 0;
  let imageIndex = 0;
  refs.forEach((r) => {
    if (!r.assetId) return;
    const type = audioRefItemMediaTypeOf(r);
    const n = type === 'image' ? ++imageIndex : ++audioIndex;
    labels.set(String(r.assetId), type === 'image' ? `图片${n}` : `音频${n}`);
    meta.set(String(r.assetId), { name: r.name, mediaType: type, url: r.src });
  });
  attachments.forEach((a, i) => {
    labels.set(a.nodeId, `文本${i + 1}`);
    meta.set(a.nodeId, { name: a.title, mediaType: 'text', url: '' });
  });
  const signature = JSON.stringify([...labels]);
  const labelOf = (key: PromptRefKey) => {
    const valid = key.kind === 'text_ref' ? attachments.some(a => a.nodeId === key.id) : refs.some(r => String(r.assetId) === key.id && !!r.assetId);
    return valid ? labels.get(key.id) ?? null : null;
  };
  useEffect(() => {
    const accepted = pending.current;
    if (accepted && labelOf(accepted.key)) {
      if (accepted.replacement) editor.current?.replaceRefAt(accepted.replacement, accepted.key);
      else editor.current?.insertRefAtPending(accepted.key);
      pending.current = null;
      setReplacement(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  useImperativeHandle(ref, () => ({
    insert: key => { if (!readOnly && labelOf(key)) editor.current?.insertRefAtPending(key, true); },
    clear: () => editor.current?.clear(),
  }));
  const items = useMemo(() => {
    const selected: AtMentionItem[] = [
      ...refs.filter(r => r.assetId).map(r => ({
        id: r.id,
        kind: audioRefItemMediaTypeOf(r),
        name: r.name,
        thumbUrl: r.src,
        assetId: String(r.assetId),
      })),
      ...attachments.map(a => ({ id: a.nodeId, kind: 'text' as const, name: a.title, searchText: a.text })),
    ];
    return [...selected, ...mentionItems.filter(item => !selected.some(s => s.kind === item.kind && s.id === item.id))];
  }, [refs, attachments, mentionItems]);
  const close = () => { editor.current?.dismissMention(); setReplacement(null); setMention({ open: false, query: '' }); };
  return <div ref={anchor} onKeyDownCapture={event => {
    if (!onSubmit || readOnly || mention.open || event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    if (!(event.target instanceof HTMLElement) || event.target.getAttribute('contenteditable') !== 'true') return;
    event.preventDefault();
    event.stopPropagation();
    onSubmit();
  }}>
    <PromptRefEditor ref={editor} initialDoc={initialDoc} initialText={initialText} readOnly={readOnly}
      placeholder={placeholder} className={className} labels={labels} refsMeta={meta}
      labelOf={labelOf} reconcileKey={signature}
      onChange={doc => onChange(doc, flattenPromptDocWith(doc, labelOf))}
      onMentionChange={setMention}
      onInvalidTagClick={key => { setReplacement(key); setMention({ open: true, query: '' }); }} />
    {mention.open && !readOnly && <AtMentionMenu anchorRef={anchor} items={items} editorQuery={mention.query}
      disabledKinds={['image', 'video']} onClose={close} onSelect={item => {
        const key: PromptRefKey = item.kind === 'text' ? { kind: 'text_ref', id: item.id } : { kind: 'asset_ref', id: item.assetId ?? '' };
        if (labelOf(key)) {
          if (replacement) editor.current?.replaceRefAt(replacement, key);
          else editor.current?.insertRefAtMention(key);
          close();
        } else if (onMentionCanvas && key.id && (item.kind === 'text' || refs.length < 3)) {
          editor.current?.consumeMentionForPendingInsert();
          pending.current = { key, replacement };
          onMentionCanvas(item);
          setMention({ open: false, query: '' });
        }
      }} />}
  </div>;
});
