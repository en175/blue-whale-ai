import { useEffect, useMemo, useRef, useState } from 'react';
import { X, AudioLines, Upload, Move, ChevronDown, Music, ArrowUp } from 'lucide-react';
import { toast } from 'sonner';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside';
import { useAudioDurations } from '../../hooks/useAudioDurations';
import type { AudioRefItem, CanvasPickItem } from '../AudioDialog';
import type { AtMentionItem } from '../../atMention';
import { docHasInvalidRef, type PromptDoc } from '@/custom/utils/prompt-doc';
import AudioPromptEditor, { type AudioPromptEditorHandle } from '../AudioDialog/AudioPromptEditor';
import RefThumbnail from '../RefThumbnail';
import { arrayMove, useRefStripDrag } from '../RefThumbnail/strip-dnd';
import styles from './index.module.css';

const MAX_INPUT = 1000;

export interface MusicGenOptions {
  instrumental: boolean;
  speed: number;
  lyrics: string;
}

const MODEL_OPTIONS = [
  { key: 'mock', label: '音乐模型（mock）' },
  { key: 'suno-v1', label: 'Suno v1（mock）' },
];

const SPEED_OPTIONS = [1, 2, 3, 4];

const MAX_REFS = 3;

interface MusicDialogProps {
  onClose: () => void;
  onSend: (text: string, model: string, opts: MusicGenOptions, refs: AudioRefItem[], promptDoc?: PromptDoc | null) => void;
  canvasMedia: CanvasPickItem[];
  onSwitchToAudio: () => void;
  mentionItems?: AtMentionItem[];
  onMentionCanvas?: (item: AtMentionItem) => void;
  externalPick?: { ts: number; item: AudioRefItem } | null;
}

export default function MusicDialog({
  onClose,
  onSend,
  canvasMedia,
  onSwitchToAudio,
  mentionItems,
  onMentionCanvas,
  externalPick,
}: MusicDialogProps) {
  const [text, setText] = useState('');
  const [promptDoc, setPromptDoc] = useState<PromptDoc | null>(null);
  const editorRef = useRef<AudioPromptEditorHandle>(null);
  const invalidPrompt = (promptDoc !== null && docHasInvalidRef(promptDoc)) || text.length > MAX_INPUT;
  const [lyrics, setLyrics] = useState('');
  const [refs, setRefs] = useState<AudioRefItem[]>([]);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [model, setModel] = useState(MODEL_OPTIONS[0].key);
  const [modelOpen, setModelOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [instrumental, setInstrumental] = useState(false);
  const [speed, setSpeed] = useState(1);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const sourceWrapRef = useRef<HTMLDivElement>(null);
  const modeWrapRef = useRef<HTMLDivElement>(null);
  const modelWrapRef = useRef<HTMLDivElement>(null);
  const speedWrapRef = useRef<HTMLDivElement>(null);

  const durationSources = useMemo(
    () => refs.map((r) => ({ key: `${r.source}-${r.id}`, src: r.src })),
    [refs],
  );
  const durations = useAudioDurations(durationSources);

  useDismissOnOutside([
    { open: sourceOpen, ref: sourceWrapRef, dismiss: () => setSourceOpen(false) },
    { open: pickerOpen, ref: sourceWrapRef, dismiss: () => setPickerOpen(false) },
    { open: modeOpen, ref: modeWrapRef, dismiss: () => setModeOpen(false) },
    { open: modelOpen, ref: modelWrapRef, dismiss: () => setModelOpen(false) },
    { open: speedOpen, ref: speedWrapRef, dismiss: () => setSpeedOpen(false) },
  ]);

  const currentModel = MODEL_OPTIONS.find((m) => m.key === model);

  const startLocalUpload = () => {
    setSourceOpen(false);
    audioInputRef.current?.click();
  };

  const startCanvasPick = () => {
    setSourceOpen(false);
    setPickerOpen((v) => !v);
  };

  const addRef = (item: AudioRefItem) => {
    setRefs((prev) => {
      if (prev.some((r) => r.id === item.id && r.source === item.source)) return prev;
      if (prev.length >= MAX_REFS) return prev;
      return [...prev, item];
    });
    setPickerOpen(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []);
    if (!list.length) return;
    const isMp3 = (f: File) =>
      f.name.toLowerCase().endsWith('.mp3') || f.type === 'audio/mpeg';
    const mp3Files = list.filter(isMp3);
    const rejected = list.length - mp3Files.length;
    if (rejected > 0) toast.warning(`仅支持 MP3 格式，已跳过 ${rejected} 个非 MP3 文件`);
    if (!mp3Files.length) return;
    const items: AudioRefItem[] = mp3Files.map((f, i) => ({
      id: `local-${Date.now()}-${i}`,
      kind: 'audio',
      name: f.name,
      src: URL.createObjectURL(f),
      source: 'local',
      file: f,
    }));
    setRefs((prev) => [...prev, ...items].slice(0, MAX_REFS));
    if (e.target) e.target.value = '';
  };

  const removeRef = (id: string, source: string) => {
    setRefs((prev) => {
      const target = prev.find((r) => r.id === id && r.source === source);
      if (target?.source === 'local') URL.revokeObjectURL(target.src);
      return prev.filter((r) => !(r.id === id && r.source === source));
    });
  };

  const stripDrag = useRefStripDrag({
    onReorder: (from, to) => setRefs((prev) => arrayMove(prev, from, to)),
  });

  useEffect(() => {
    if (!externalPick) return;
    addRef(externalPick.item);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalPick]);

  const canvasAudios = canvasMedia.filter((m) => m.mediaType === 'audio');

  const handleSend = () => {
    if (!text.trim() || invalidPrompt) return;
    onSend(
      text.trim(),
      currentModel?.label ?? model,
      {
        instrumental,
        speed,
        lyrics: instrumental ? '' : lyrics.trim(),
      },
      refs,
      promptDoc,
    );
    editorRef.current?.clear();
    setText('');
  };

  return (
    <div className={styles.dialog} data-gen-panel-territory>
      {}
      <button className={styles.closeBtn} onClick={onClose} title="关闭">
        <X size={16} strokeWidth={2} />
      </button>

      {}
      <div className={styles.topRow}>
        <div className={styles.refWrap} ref={sourceWrapRef}>
          <button
            className={styles.refBtn}
            onClick={() => {
              setPickerOpen(false);
              setSourceOpen((v) => !v);
            }}
            title="添加参考音频"
          >
            <AudioLines size={18} strokeWidth={2} />
          </button>
          {sourceOpen && (
            <div className={styles.sourcePopup} onClick={(e) => e.stopPropagation()}>
              <button className={styles.sourceItem} onClick={startLocalUpload}>
                <Upload size={14} strokeWidth={2} />
                <span>本地上传</span>
              </button>
              <button className={styles.sourceItem} onClick={startCanvasPick}>
                <Move size={14} strokeWidth={2} />
                <span>从画布选择</span>
              </button>
            </div>
          )}
          {pickerOpen && (
            <div className={styles.pickerPanel} onClick={(e) => e.stopPropagation()}>
              <div className={styles.pickerHead}>
                <span>从画布选择音频</span>
                <button className={styles.pickerClose} onClick={() => setPickerOpen(false)} title="关闭">
                  <X size={12} strokeWidth={2} />
                </button>
              </div>
              {canvasAudios.length === 0 ? (
                <div className={styles.pickerEmpty}>画布暂无可选音频</div>
              ) : (
                <div className={styles.pickerList}>
                  {canvasAudios.map((it) => (
                    <button
                      key={it.id}
                      className={styles.pickerItem}
                      onClick={() =>
                        addRef({ id: it.id, kind: 'audio', name: it.name, src: it.src, source: 'canvas', assetId: it.assetId })
                      }
                    >
                      <div className={styles.pickerAudio}>
                        <AudioLines size={14} strokeWidth={2} />
                      </div>
                      <span className={styles.pickerName}>{it.name || it.id}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <span className={styles.refHint}>参考音频（可选）</span>
        {refs.length > 0 && <span className={styles.refCount}>{refs.length}/{MAX_REFS}</span>}
      </div>

      {}
      <input
        ref={audioInputRef}
        type="file"
        accept=".mp3,audio/mpeg"
        multiple
        className={styles.hiddenInput}
        onChange={handleFileChange}
      />

      {}
      {refs.length > 0 && (
        <div className={styles.previewArea}>
          {refs.map((r, i) => (
            <RefThumbnail
              key={`${r.source}-${r.id}`}
              data-testid="music-ref-thumb"
              kind="audio"
              name={r.name}
              number={i + 1}
              audioDuration={durations.get(`${r.source}-${r.id}`)}
              onRemove={() => removeRef(r.id, r.source)}
              onInsertRef={
                r.assetId
                  ? () => editorRef.current?.insert({ kind: 'asset_ref', id: String(r.assetId) })
                  : undefined
              }
              dragProps={stripDrag.itemProps(i)}
            />
          ))}
        </div>
      )}

      {}
      <div className={styles.mentionAnchor}>
        <AudioPromptEditor ref={editorRef} refs={refs} className={styles.textarea} onSubmit={handleSend}
          placeholder="描述音乐曲风、情绪、节奏和乐器等... 使用 @ 引用画布素材。"
          mentionItems={mentionItems?.filter(item => item.kind !== 'text')} onMentionCanvas={onMentionCanvas}
          onChange={(doc, value) => { setPromptDoc(doc); setText(value); }} />
      </div>
      {invalidPrompt && <div role="alert">正文有已失效的素材标签或超过字数上限，请调整后发送</div>}
      <div className={`${styles.charCount} ${text.length >= MAX_INPUT ? styles.charCountWarn : ''}`}>
        {text.length}/{MAX_INPUT}
      </div>

      {}
      <div className={styles.lyricBlock}>
        <span className={`${styles.lyricLabel} ${instrumental ? styles.lyricLabelDisabled : ''}`}>
          歌词（可选）
        </span>
        <textarea
          className={styles.textarea}
          placeholder="输入或粘贴歌词..."
          value={lyrics}
          onChange={(e) => setLyrics(e.target.value.slice(0, MAX_INPUT))}
          disabled={instrumental}
          rows={2}
          maxLength={MAX_INPUT}
        />
        <div className={`${styles.charCount} ${lyrics.length >= MAX_INPUT ? styles.charCountWarn : ''}`}>
          {lyrics.length}/{MAX_INPUT}
        </div>
      </div>

      {}
      <div className={styles.bottomBar}>
        <div className={styles.barLeft}>
          {}
          <div className={styles.modeWrap} ref={modeWrapRef}>
            <button className={styles.modeBtn} onClick={() => setModeOpen((v) => !v)}>
              <Music size={14} strokeWidth={2} />
              <span>AI 音乐</span>
              <ChevronDown
                size={10}
                strokeWidth={2}
                className={`${styles.modeArrow} ${modeOpen ? styles.modeArrowUp : ''}`}
              />
            </button>
            {modeOpen && (
              <div className={styles.modeDropdown}>
                <button
                  className={styles.modeOption}
                  onClick={() => {
                    setModeOpen(false);
                    onSwitchToAudio();
                  }}
                >
                  音频生成
                </button>
                <button className={`${styles.modeOption} ${styles.modeOptionActive}`} onClick={() => setModeOpen(false)}>
                  AI 音乐
                </button>
              </div>
            )}
          </div>

          {}
          <div className={styles.modeWrap} ref={modelWrapRef}>
            <button className={styles.modeBtn} onClick={() => setModelOpen((v) => !v)}>
              <span>{currentModel?.label ?? '音乐模型（mock）'}</span>
              <ChevronDown
                size={10}
                strokeWidth={2}
                className={`${styles.modeArrow} ${modelOpen ? styles.modeArrowUp : ''}`}
              />
            </button>
            {modelOpen && (
              <div className={styles.modeDropdown}>
                {MODEL_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    className={`${styles.modeOption} ${opt.key === model ? styles.modeOptionActive : ''}`}
                    onClick={() => {
                      setModel(opt.key);
                      setModelOpen(false);
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {}
          <div className={styles.toggleGroup}>
            <button
              className={`${styles.switch} ${instrumental ? styles.switchOn : ''}`}
              onClick={() => setInstrumental((v) => !v)}
              role="switch"
              aria-checked={instrumental}
              title="纯伴奏"
            >
              <span className={styles.switchKnob} />
            </button>
            <span className={styles.toggleLabel}>纯伴奏</span>
          </div>

          {}
          <div className={styles.modeWrap} ref={speedWrapRef}>
            <button className={styles.modeBtn} onClick={() => setSpeedOpen((v) => !v)}>
              <span>{speed}x</span>
              <ChevronDown
                size={10}
                strokeWidth={2}
                className={`${styles.modeArrow} ${speedOpen ? styles.modeArrowUp : ''}`}
              />
            </button>
            {speedOpen && (
              <div className={styles.modeDropdown}>
                {SPEED_OPTIONS.map((s) => (
                  <button
                    key={s}
                    className={`${styles.modeOption} ${s === speed ? styles.modeOptionActive : ''}`}
                    onClick={() => {
                      setSpeed(s);
                      setSpeedOpen(false);
                    }}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className={styles.barRight}>
          <button
            className={`${styles.sendBtn} ${text.trim() ? styles.sendBtnActive : ''}`}
            disabled={!text.trim() || invalidPrompt}
            onClick={handleSend}
            title="发送"
          >
            <ArrowUp size={16} fill="currentColor" strokeWidth={0} />
          </button>
        </div>
      </div>
    </div>
  );
}
