/* ============================================
 * MusicDialog AI 音乐底部对话框：参考音频（本地上传/画布选择）+ 曲风描述 +
 * 歌词（纯伴奏开启时不可填）+ 倍速；底部模式可切换回音频生成对话框
 * ============================================ */
import { useRef, useState } from 'react';
import { X, AudioLines, Upload, Move, ChevronDown, Music, ArrowUp } from 'lucide-react';
import { toast } from 'sonner';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside';
import type { AudioRefItem, CanvasPickItem } from '../AudioDialog';
import styles from './index.module.css';

/** 输入框字数上限 */
const MAX_INPUT = 1000;

/** AI 音乐生成附加参数 */
export interface MusicGenOptions {
  /** 纯伴奏：开启后歌词不生效 */
  instrumental: boolean;
  /** 倍速（1-4） */
  speed: number;
  /** 歌词（纯伴奏时为空字符串） */
  lyrics: string;
}

/** 模型（mock） */
const MODEL_OPTIONS = [
  { key: 'mock', label: '音乐模型（mock）' },
  { key: 'suno-v1', label: 'Suno v1（mock）' },
];

const SPEED_OPTIONS = [1, 2, 3, 4];

const MAX_REFS = 3;

interface MusicDialogProps {
  onClose: () => void;
  onSend: (text: string, model: string, opts: MusicGenOptions, refs: AudioRefItem[]) => void;
  /** 画布媒体节点（从画布选择的数据源） */
  canvasMedia: CanvasPickItem[];
  /** 底部模式切换 → 音频生成对话框 */
  onSwitchToAudio: () => void;
}

export default function MusicDialog({ onClose, onSend, canvasMedia, onSwitchToAudio }: MusicDialogProps) {
  const [text, setText] = useState('');
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

  useDismissOnOutside([
    { open: sourceOpen, ref: sourceWrapRef, dismiss: () => setSourceOpen(false) },
    { open: pickerOpen, ref: sourceWrapRef, dismiss: () => setPickerOpen(false) },
    { open: modeOpen, ref: modeWrapRef, dismiss: () => setModeOpen(false) },
    { open: modelOpen, ref: modelWrapRef, dismiss: () => setModelOpen(false) },
    { open: speedOpen, ref: speedWrapRef, dismiss: () => setSpeedOpen(false) },
  ]);

  const currentModel = MODEL_OPTIONS.find((m) => m.key === model);

  /** 本地上传入口 */
  const startLocalUpload = () => {
    setSourceOpen(false);
    audioInputRef.current?.click();
  };

  /** 从画布选择入口 */
  const startCanvasPick = () => {
    setSourceOpen(false);
    setPickerOpen((v) => !v);
  };

  /** 添加参考项（去重 + 上限） */
  const addRef = (item: AudioRefItem) => {
    setRefs((prev) => {
      if (prev.some((r) => r.id === item.id && r.source === item.source)) return prev;
      if (prev.length >= MAX_REFS) return prev;
      return [...prev, item];
    });
    setPickerOpen(false);
  };

  /** 本地文件选择 */
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

  const canvasAudios = canvasMedia.filter((m) => m.mediaType === 'audio');

  const handleSend = () => {
    if (!text.trim()) return;
    onSend(
      text.trim(),
      currentModel?.label ?? model,
      {
        instrumental,
        speed,
        // 纯伴奏开启时歌词不生效
        lyrics: instrumental ? '' : lyrics.trim(),
      },
      refs,
    );
    setText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className={styles.dialog}>
      {/* 关闭按钮 */}
      <button className={styles.closeBtn} onClick={onClose} title="关闭">
        <X size={16} strokeWidth={2} />
      </button>

      {/* 顶部参考音频行 */}
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
                        addRef({ id: it.id, kind: 'audio', name: it.name, src: it.src, source: 'canvas' })
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

      {/* 隐藏 file input */}
      <input
        ref={audioInputRef}
        type="file"
        accept=".mp3,audio/mpeg"
        multiple
        className={styles.hiddenInput}
        onChange={handleFileChange}
      />

      {/* 参考预览 */}
      {refs.length > 0 && (
        <div className={styles.previewArea}>
          {refs.map((r) => (
            <div key={`${r.source}-${r.id}`} className={styles.previewItem}>
              <div className={styles.previewAudio}>
                <AudioLines size={16} strokeWidth={2} />
              </div>
              <button
                className={styles.previewRemove}
                onClick={() => removeRef(r.id, r.source)}
                title="移除"
              >
                <X size={10} strokeWidth={2} />
              </button>
              <span className={styles.previewLabel}>音频{r.source === 'canvas' ? '·画布' : ''}</span>
            </div>
          ))}
        </div>
      )}

      {/* 曲风描述 */}
      <textarea
        className={styles.textarea}
        placeholder="描述音乐曲风、情绪、节奏和乐器等..."
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, MAX_INPUT))}
        onKeyDown={handleKeyDown}
        rows={2}
        maxLength={MAX_INPUT}
      />
      <div className={`${styles.charCount} ${text.length >= MAX_INPUT ? styles.charCountWarn : ''}`}>
        {text.length}/{MAX_INPUT}
      </div>

      {/* 歌词（纯伴奏时禁用） */}
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

      {/* 底部状态栏 */}
      <div className={styles.bottomBar}>
        <div className={styles.barLeft}>
          {/* 模式（AI 音乐 / 音频生成切换） */}
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

          {/* 模型（mock） */}
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

          {/* 纯伴奏开关 */}
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

          {/* 倍速 */}
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
            disabled={!text.trim()}
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
