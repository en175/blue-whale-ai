/* ============================================
 * AudioDialog 音频生成底部对话框：音频/图片参考（本地上传或从画布选择）
 * ============================================ */
import { useRef, useState } from 'react';
import {
  X,
  AudioLines,
  Image as ImageIcon,
  Upload,
  Move,
  ChevronDown,
  Sparkles,
  Music,
} from 'lucide-react';
import styles from './index.module.css';

/** 参考素材类型 */
type RefKind = 'audio' | 'image';

/** 参考项 */
export interface AudioRefItem {
  id: string;
  kind: RefKind;
  name: string;
  src: string;
  source: 'local' | 'canvas';
}

/** 画布可选媒体节点 */
export interface CanvasPickItem {
  id: string;
  src: string;
  name: string;
  mediaType: 'image' | 'video' | 'audio';
}

/** 模型（mock） */
const MODEL_OPTIONS = [
  { key: 'mock', label: '音频模型（mock）' },
  { key: 'music-v1', label: 'MusicGen v1（mock）' },
];

const MAX_REFS = 5;

interface AudioDialogProps {
  onClose: () => void;
  onSend: (text: string, model: string, refs: AudioRefItem[]) => void;
  /** 画布媒体节点（从画布选择的数据源） */
  canvasMedia: CanvasPickItem[];
  /** 底部模式切换 → AI 音乐对话框 */
  onSwitchToMusic?: () => void;
  /** 初始参考项（节点「生成音频」带入被点节点图片） */
  initialRefs?: AudioRefItem[];
}

export default function AudioDialog({ onClose, onSend, canvasMedia, onSwitchToMusic, initialRefs }: AudioDialogProps) {
  const [text, setText] = useState('');
  const [refs, setRefs] = useState<AudioRefItem[]>(initialRefs ?? []);
  /** 来源弹出（本地上传/从画布选择）针对的参考类型 */
  const [sourceFor, setSourceFor] = useState<RefKind | null>(null);
  /** 画布选择面板针对的参考类型 */
  const [pickerFor, setPickerFor] = useState<RefKind | null>(null);
  const [model, setModel] = useState(MODEL_OPTIONS[0].key);
  const [modelOpen, setModelOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const currentModel = MODEL_OPTIONS.find((m) => m.key === model);

  /** 点击参考按钮：切换来源弹出 */
  const toggleSource = (kind: RefKind) => {
    setPickerFor(null);
    setSourceFor((prev) => (prev === kind ? null : kind));
  };

  /** 本地上传入口 */
  const startLocalUpload = (kind: RefKind) => {
    setSourceFor(null);
    if (kind === 'audio') audioInputRef.current?.click();
    else imageInputRef.current?.click();
  };

  /** 从画布选择入口 */
  const startCanvasPick = (kind: RefKind) => {
    setSourceFor(null);
    setPickerFor((prev) => (prev === kind ? null : kind));
  };

  /** 添加参考项（去重 + 上限） */
  const addRef = (item: AudioRefItem) => {
    setRefs((prev) => {
      if (prev.some((r) => r.id === item.id && r.source === item.source)) return prev;
      if (prev.length >= MAX_REFS) return prev;
      return [...prev, item];
    });
    setPickerFor(null);
  };

  /** 本地文件选择 */
  const handleFileChange = (kind: RefKind) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const items: AudioRefItem[] = Array.from(files).map((f, i) => ({
        id: `local-${Date.now()}-${i}`,
        kind,
        name: f.name,
        src: URL.createObjectURL(f),
        source: 'local',
      }));
      setRefs((prev) => [...prev, ...items].slice(0, MAX_REFS));
    }
    if (e.target) e.target.value = '';
    setSourceFor(null);
  };

  const removeRef = (id: string, source: string) => {
    setRefs((prev) => {
      const target = prev.find((r) => r.id === id && r.source === source);
      if (target?.source === 'local') URL.revokeObjectURL(target.src);
      return prev.filter((r) => !(r.id === id && r.source === source));
    });
  };

  /** 画布可选项：音频参考→画布音频节点；图片参考→画布图片节点 */
  const pickable = (kind: RefKind) =>
    canvasMedia.filter((m) => m.mediaType === kind);

  const handleSend = () => {
    if (!text.trim()) return;
    onSend(text.trim(), currentModel?.label ?? model, refs);
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

      {/* 顶部参考按钮行 */}
      <div className={styles.topRow}>
        {/* 音频参考 */}
        <div className={styles.refWrap}>
          <button
            className={styles.refBtn}
            onClick={() => toggleSource('audio')}
            title="添加音频参考"
          >
            <AudioLines size={18} strokeWidth={2} />
          </button>
          {sourceFor === 'audio' && (
            <div className={styles.sourcePopup} onClick={(e) => e.stopPropagation()}>
              <button className={styles.sourceItem} onClick={() => startLocalUpload('audio')}>
                <Upload size={14} strokeWidth={2} />
                <span>本地上传</span>
              </button>
              <button className={styles.sourceItem} onClick={() => startCanvasPick('audio')}>
                <Move size={14} strokeWidth={2} />
                <span>从画布选择</span>
              </button>
            </div>
          )}
          {pickerFor === 'audio' && (
            <CanvasPicker
              items={pickable('audio')}
              kind="audio"
              onPick={(it) =>
                addRef({ id: it.id, kind: 'audio', name: it.name, src: it.src, source: 'canvas' })
              }
              onClose={() => setPickerFor(null)}
            />
          )}
        </div>

        {/* 图片参考 */}
        <div className={styles.refWrap}>
          <button
            className={styles.refBtn}
            onClick={() => toggleSource('image')}
            title="添加图片参考"
          >
            <ImageIcon size={18} strokeWidth={2} />
          </button>
          {sourceFor === 'image' && (
            <div className={styles.sourcePopup} onClick={(e) => e.stopPropagation()}>
              <button className={styles.sourceItem} onClick={() => startLocalUpload('image')}>
                <Upload size={14} strokeWidth={2} />
                <span>本地上传</span>
              </button>
              <button className={styles.sourceItem} onClick={() => startCanvasPick('image')}>
                <Move size={14} strokeWidth={2} />
                <span>从画布选择</span>
              </button>
            </div>
          )}
          {pickerFor === 'image' && (
            <CanvasPicker
              items={pickable('image')}
              kind="image"
              onPick={(it) =>
                addRef({ id: it.id, kind: 'image', name: it.name, src: it.src, source: 'canvas' })
              }
              onClose={() => setPickerFor(null)}
            />
          )}
        </div>

        <span className={styles.refHint}>音频参考 / 图片参考（均可选）</span>
        {refs.length > 0 && <span className={styles.refCount}>{refs.length}/{MAX_REFS}</span>}
      </div>

      {/* 隐藏的 file inputs */}
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/*"
        multiple
        className={styles.hiddenInput}
        onChange={handleFileChange('audio')}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        className={styles.hiddenInput}
        onChange={handleFileChange('image')}
      />

      {/* 参考预览 */}
      {refs.length > 0 && (
        <div className={styles.previewArea}>
          {refs.map((r) => (
            <div key={`${r.source}-${r.id}`} className={styles.previewItem}>
              {r.kind === 'image' ? (
                <img src={r.src} alt="" className={styles.previewThumb} />
              ) : (
                <div className={styles.previewAudio}>
                  <AudioLines size={16} strokeWidth={2} />
                </div>
              )}
              <button
                className={styles.previewRemove}
                onClick={() => removeRef(r.id, r.source)}
                title="移除"
              >
                <X size={10} strokeWidth={2} />
              </button>
              <span className={styles.previewLabel}>
                {r.kind === 'image' ? '图片' : '音频'}
                {r.source === 'canvas' ? '·画布' : ''}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* 输入框 */}
      <textarea
        className={styles.textarea}
        placeholder="描述想生成的音频：可生成音乐、音效、台词、多人对话等任意类型。支持音频或图片参考。最长 120 秒。"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={2}
      />

      {/* 底部状态栏 */}
      <div className={styles.bottomBar}>
        <div className={styles.barLeft}>
          {/* 模式（音频生成） */}
          <div className={styles.modeWrap}>
            <button className={styles.modeBtn} onClick={() => setModeOpen((v) => !v)}>
              <AudioLines size={14} strokeWidth={2} />
              <span>音频生成</span>
              <ChevronDown
                size={10}
                strokeWidth={2}
                className={`${styles.modeArrow} ${modeOpen ? styles.modeArrowUp : ''}`}
              />
            </button>
            {modeOpen && (
              <div className={styles.modeDropdown}>
                <button className={`${styles.modeOption} ${styles.modeOptionActive}`} onClick={() => setModeOpen(false)}>
                  音频生成
                </button>
                {onSwitchToMusic && (
                  <button
                    className={styles.modeOption}
                    onClick={() => {
                      setModeOpen(false);
                      onSwitchToMusic();
                    }}
                  >
                    <span className={styles.modeOptionRow}>
                      <Music size={12} strokeWidth={2} />
                      AI 音乐
                    </span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* 模型（mock） */}
          <div className={styles.modeWrap}>
            <button className={styles.modeBtn} onClick={() => setModelOpen((v) => !v)}>
              <span>{currentModel?.label ?? '音频模型（mock）'}</span>
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
        </div>

        <div className={styles.barRight}>
          <span className={styles.simHint}>模拟生成</span>
          <button
            className={`${styles.generateBtn} ${text.trim() ? styles.generateBtnActive : ''}`}
            disabled={!text.trim()}
            onClick={handleSend}
          >
            <Sparkles size={14} strokeWidth={2} />
            <span>生成</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============ 画布选择面板 ============ */
function CanvasPicker({
  items,
  kind,
  onPick,
  onClose,
}: {
  items: CanvasPickItem[];
  kind: RefKind;
  onPick: (it: CanvasPickItem) => void;
  onClose: () => void;
}) {
  return (
    <div className={styles.pickerPanel} onClick={(e) => e.stopPropagation()}>
      <div className={styles.pickerHead}>
        <span>从画布选择{kind === 'audio' ? '音频' : '图片'}</span>
        <button className={styles.pickerClose} onClick={onClose} title="关闭">
          <X size={12} strokeWidth={2} />
        </button>
      </div>
      {items.length === 0 ? (
        <div className={styles.pickerEmpty}>画布暂无可选{kind === 'audio' ? '音频' : '图片'}</div>
      ) : (
        <div className={styles.pickerList}>
          {items.map((it) => (
            <button key={it.id} className={styles.pickerItem} onClick={() => onPick(it)}>
              {kind === 'image' ? (
                <img src={it.src} alt="" className={styles.pickerThumb} />
              ) : (
                <div className={styles.pickerAudio}>
                  <AudioLines size={14} strokeWidth={2} />
                </div>
              )}
              <span className={styles.pickerName}>{it.name || it.id}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
