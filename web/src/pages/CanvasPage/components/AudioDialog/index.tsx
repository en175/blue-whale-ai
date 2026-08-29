/* ============================================
 * AudioDialog 音频生成底部对话框：纯文本描述 + 真实模型（fetchGenerationModels('audio')）
 * 参考音频：本地上传 / 到节点选择（后端音频任务一期不支持参考素材参数，暂只带入展示，待后端支持后接线）
 * ============================================ */
import { useEffect, useRef, useState } from 'react';
import { X, AudioLines, ChevronDown, Music, ArrowUp, Upload, MousePointerClick, Maximize2, Minimize2 } from 'lucide-react';
import { fetchGenerationModels, type GenerationModel } from '@/api/generation';
import { refOverflowToast } from '@/utils/ref-overflow';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside';
import styles from './index.module.css';

/** 输入框字数上限 */
const MAX_INPUT = 1000;

/** 参考音频上限（本地上传 + 节点选取合计） */
const MAX_AUDIO_REFS = 3;

/** 参考素材类型（保留给 MusicDialog 共享类型） */
type RefKind = 'audio' | 'image';

/** 参考项（保留给 MusicDialog 共享类型） */
export interface AudioRefItem {
  id: string;
  kind: RefKind;
  name: string;
  src: string;
  source: 'local' | 'canvas';
}

/** 画布可选媒体节点（保留给 MusicDialog 共享类型） */
export interface CanvasPickItem {
  id: string;
  src: string;
  name: string;
  mediaType: 'image' | 'video' | 'audio';
}

interface AudioDialogProps {
  onClose: () => void;
  onSend: (text: string, modelId: string) => void;
  /** 底部模式切换 → AI 音乐对话框 */
  onSwitchToMusic?: () => void;
  /** 到节点选择：进入画布音频节点选取模式 */
  onPickFromCanvas?: () => void;
  /** 画布选取模式进行中（参考按钮高亮提示） */
  pickMode?: boolean;
  /** 画布节点选取结果（ts 驱动注入参考音频） */
  externalPick?: { ts: number; item: { id: string; src: string; name: string; assetId?: string | number } } | null;
  /** Toast 提示（上传超限等场景，由父级注入） */
  onToast?: (type: 'success' | 'error' | 'warn', msg: string) => void;
}

export default function AudioDialog({ onClose, onSend, onPickFromCanvas, pickMode, externalPick, onToast }: AudioDialogProps) {
  const [text, setText] = useState('');
  const [models, setModels] = useState<GenerationModel[]>([]);
  const [modelId, setModelId] = useState<string>('');
  const [modelOpen, setModelOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  /** 参考音频列表（本地上传 + 节点选取） */
  const [refs, setRefs] = useState<AudioRefItem[]>([]);
  /** 参考按钮弹菜单：音频上传 / 到节点选择 */
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  /** 放大态：输入区高度占屏幕 2/3；收起回底部默认高度 */
  const [expanded, setExpanded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modeWrapRef = useRef<HTMLDivElement>(null);
  const modelWrapRef = useRef<HTMLDivElement>(null);
  const sourceWrapRef = useRef<HTMLDivElement>(null);

  useDismissOnOutside([
    { open: modeOpen, ref: modeWrapRef, dismiss: () => setModeOpen(false) },
    { open: modelOpen, ref: modelWrapRef, dismiss: () => setModelOpen(false) },
    { open: sourceMenuOpen, ref: sourceWrapRef, dismiss: () => setSourceMenuOpen(false) },
  ]);

  useEffect(() => {
    fetchGenerationModels('audio')
      .then((list) => {
        setModels(list);
        if (list.length > 0) setModelId(list[0].model_id);
      })
      .catch(() => setModels([]));
  }, []);

  /** 本地音频上传：仅接受 MP3（扩展名 + MIME 双重校验），非 MP3 直接过滤并提示 */
  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!list.length) return;
    const isMp3 = (f: File) =>
      f.name.toLowerCase().endsWith('.mp3') || f.type === 'audio/mpeg';
    const mp3Files = list.filter(isMp3);
    const rejected = list.length - mp3Files.length;
    if (rejected > 0) {
      onToast?.('warn', `仅支持 MP3 格式，已跳过 ${rejected} 个非 MP3 文件`);
    }
    if (!mp3Files.length) return;
    setRefs((prev) => {
      const room = Math.max(0, MAX_AUDIO_REFS - prev.length);
      if (mp3Files.length > room) onToast?.('warn', refOverflowToast('audio', MAX_AUDIO_REFS));
      const add: AudioRefItem[] = mp3Files.slice(0, room).map((f, i) => ({
        id: `local-${Date.now()}-${i}`,
        kind: 'audio',
        name: f.name,
        src: URL.createObjectURL(f),
        source: 'local',
      }));
      return [...prev, ...add];
    });
  };

  // 画布节点选取结果注入参考音频（去重 + 上限保护）
  useEffect(() => {
    if (!externalPick) return;
    const item = externalPick.item;
    setRefs((prev) => {
      if (prev.length >= MAX_AUDIO_REFS) return prev;
      if (prev.some((r) => r.id === item.id || r.src === item.src)) return prev;
      return [...prev, { id: item.id, kind: 'audio', name: item.name, src: item.src, source: 'canvas' }];
    });
  }, [externalPick]);

  /** 删除参考（仅本地上传的 objectURL 需要释放） */
  const removeRef = (id: string) => {
    setRefs((prev) => {
      const target = prev.find((r) => r.id === id);
      if (target?.source === 'local') URL.revokeObjectURL(target.src);
      return prev.filter((r) => r.id !== id);
    });
  };

  const currentModel = models.find((m) => m.model_id === modelId);

  const handleSend = () => {
    if (!text.trim() || !modelId) return;
    onSend(text.trim(), modelId);
    setText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className={`${styles.dialog} ${expanded ? styles.dialogExpanded : ''}`}>
      {/* 右上角操作：放大/收起 + 关闭 */}
      <div className={styles.topActions}>
        <button
          className={styles.iconBtn}
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? '收起' : '展开'}
        >
          {expanded ? <Minimize2 size={14} strokeWidth={2} /> : <Maximize2 size={14} strokeWidth={2} />}
        </button>
        <button className={styles.iconBtn} onClick={onClose} title="关闭">
          <X size={16} strokeWidth={2} />
        </button>
      </div>

      {/* 顶部参考行：参考音频预览 + 添加按钮（菜单：音频上传 / 到节点选择） */}
      <div className={styles.topRow}>
        {refs.map((r) => (
          <div key={r.id} className={styles.audioChip} title={r.name}>
            <span className={styles.audioChipIcon}>
              <AudioLines size={14} strokeWidth={2} />
            </span>
            <span className={styles.audioChipName}>{r.name}</span>
            <button className={styles.audioChipRemove} onClick={() => removeRef(r.id)} title="移除">
              <X size={10} strokeWidth={2.5} />
            </button>
          </div>
        ))}
        {refs.length < MAX_AUDIO_REFS && (
          <div className={styles.refWrap} ref={sourceWrapRef}>
            <button
              className={`${styles.refBtn} ${pickMode ? styles.refBtnPicking : ''}`}
              onClick={() => setSourceMenuOpen((v) => !v)}
              title="音频上传 / 到节点选择"
            >
              <AudioLines size={18} strokeWidth={2} />
            </button>
            {sourceMenuOpen && (
              <>
                <div className={styles.menuOverlay} onClick={() => setSourceMenuOpen(false)} />
                <div className={styles.sourcePopup}>
                  <button
                    className={styles.sourceItem}
                    onClick={() => { setSourceMenuOpen(false); fileInputRef.current?.click(); }}
                  >
                    <Upload size={14} strokeWidth={2} />
                    <span>音频上传</span>
                  </button>
                  <button
                    className={styles.sourceItem}
                    onClick={() => { setSourceMenuOpen(false); onPickFromCanvas?.(); }}
                  >
                    <MousePointerClick size={14} strokeWidth={2} />
                    <span>到节点选择</span>
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        <span className={styles.refOptionalLabel}>参考音频（可选）</span>
        {refs.length > 0 && (
          <span className={styles.refCount}>{refs.length}/{MAX_AUDIO_REFS}</span>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".mp3,audio/mpeg"
        multiple
        className={styles.hiddenInput}
        onChange={handleUpload}
      />

      {/* 参考素材数量提示（输入框上方固定灰色小字，与 BottomDialog/ImageDialog 统一） */}
      <div className={styles.refHint}>参考音频最多 3 段</div>

      {/* 输入框 */}
      <textarea
        className={styles.textarea}
        placeholder="描述想生成的音频：可生成音乐、音效、台词、多人对话等任意类型，最长 120 秒。"
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, MAX_INPUT))}
        onKeyDown={handleKeyDown}
        rows={2}
        maxLength={MAX_INPUT}
      />

      {/* 字数统计 */}
      <div className={`${styles.charCount} ${text.length >= MAX_INPUT ? styles.charCountWarn : ''}`}>
        {text.length}/{MAX_INPUT}
      </div>

      {/* 底部状态栏 */}
      <div className={styles.bottomBar}>
        <div className={styles.barLeft}>
          {/* 模式（音频生成） */}
          <div className={styles.modeWrap} ref={modeWrapRef}>
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
                {/* AI 音乐暂未上线：展示但禁用 */}
                <button className={styles.modeOption} disabled title="即将上线">
                  <span className={styles.modeOptionRow}>
                    <Music size={12} strokeWidth={2} />
                    AI 音乐
                  </span>
                </button>
              </div>
            )}
          </div>

          {/* 模型（真实） */}
          <div className={styles.modeWrap} ref={modelWrapRef}>
            <button className={styles.modeBtn} onClick={() => setModelOpen((v) => !v)}>
              <span>{currentModel?.model_label ?? '选择模型'}</span>
              <ChevronDown
                size={10}
                strokeWidth={2}
                className={`${styles.modeArrow} ${modelOpen ? styles.modeArrowUp : ''}`}
              />
            </button>
            {modelOpen && (
              <div className={styles.modeDropdown}>
                {models.map((opt) => (
                  <button
                    key={opt.model_id}
                    className={`${styles.modeOption} ${opt.model_id === modelId ? styles.modeOptionActive : ''}`}
                    onClick={() => {
                      setModelId(opt.model_id);
                      setModelOpen(false);
                    }}
                  >
                    {opt.model_label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className={styles.barRight}>
          <button
            className={`${styles.sendBtn} ${text.trim() && modelId ? styles.sendBtnActive : ''}`}
            disabled={!text.trim() || !modelId}
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
