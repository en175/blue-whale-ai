/* ============================================
 * AudioDialog 音频生成底部对话框：纯文本描述 + 真实模型（fetchGenerationModels('audio')）
 * ============================================ */
import { useEffect, useRef, useState } from 'react';
import { X, AudioLines, ChevronDown, ArrowUp, Maximize2, Minimize2, Music2, Pause, XCircle, Upload, Move } from 'lucide-react';
import { fetchGenerationModels, type GenerationModel } from '@/api/generation';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside';
import type { MediaGenStatus } from '../MediaNode';
import styles from './index.module.css';

/** 输入框字数上限 */
const MAX_INPUT = 1000;
/** 参考音频上限（与首页 Audio tab 一致） */
const MAX_AUDIO_REFS = 3;

/** 仅允许 MP3：按 MIME 与扩展名双判据（兼容 audio/mp3 的浏览器变体） */
const isMp3File = (file: File): boolean => {
  const type = (file.type || '').toLowerCase();
  return type === 'audio/mpeg' || type === 'audio/mp3' || /\.mp3$/i.test(file.name);
};

/** 参考素材类型（保留给 MusicDialog 共享类型） */
type RefKind = 'audio' | 'image';

/** 参考项（保留给 MusicDialog 共享类型） */
export interface AudioRefItem {
  id: string;
  kind: RefKind;
  name: string;
  src: string;
  source: 'local' | 'canvas';
  /** 画布节点选取带入的资产 ID（有则发送时直接复用，跳过上传） */
  assetId?: string | number;
  /** 本地上传保留原始 File（发送时走三步上传换取 assetId） */
  file?: File;
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
  /** 发送：提示词 + 模型ID */
  onSend: (text: string, modelId: string, refs: AudioRefItem[]) => void | Promise<void>;
  /** 初始文字描述（草稿打开时带入已保存 prompt） */
  initialText?: string;
  /** 初始模型（节点打开时带入已保存 draftModelId） */
  initialModelId?: string;
  /** 草稿绑定（IKDMQT）：面板编辑实时写回草稿节点；status 为 generating 时参数只读 */
  draftBinding?: {
    status?: MediaGenStatus;
    restoreExisting?: boolean;
    submitting?: boolean;
    saveFailed?: boolean;
    onParamsChange: (patch: { prompt?: string; modelId?: string }) => void;
  };
  /** Toast 提示（IKDMQU Q3：恢复的模型不可用时提示，由父级注入） */
  onToast?: (type: 'success' | 'error' | 'warn', msg: string) => void;
  /** 画布媒体节点：供「从画布选择」参考音频 */
  canvasMedia?: CanvasPickItem[];
  /** 触发「从画布选择」模式：父级应设置 pickMode */
  onPickFromCanvas?: () => void;
  /** 外部注入的画布选择结果：父级点击音频节点后生成 */
  externalPick?: { ts: number; item: AudioRefItem } | null;
  /** 是否处于画布选择模式中：用于按钮高亮 */
  pickMode?: boolean;
  /** 底部模式切换 → AI 音乐对话框（已废弃：仅保留 prop 兼容父级，不再渲染） */
  onSwitchToMusic?: () => void;
}

export default function AudioDialog({
  onClose,
  onSend,
  initialText,
  initialModelId,
  draftBinding,
  onToast,
  canvasMedia = [],
  onPickFromCanvas,
  externalPick,
  pickMode,
}: AudioDialogProps) {
  const [text, setText] = useState(initialText ?? '');
  const [models, setModels] = useState<GenerationModel[]>([]);
  const [modelId, setModelId] = useState(initialModelId ?? '');
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  /** 放大态：输入区高度占屏幕 2/3；收起回底部默认高度 */
  const [expanded, setExpanded] = useState(false);
  /** 参考音频列表（本地上传） */
  const [refs, setRefs] = useState<AudioRefItem[]>([]);
  /** 当前正在播放的参考项 id */
  const [playingId, setPlayingId] = useState<string | null>(null);
  /** 来源菜单（本地上传 / 从画布选择） */
  const [sourceOpen, setSourceOpen] = useState(false);
  /** 画布选择面板 */
  const [pickerOpen, setPickerOpen] = useState(false);
  const modelWrapRef = useRef<HTMLDivElement>(null);
  const sourceWrapRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  if (!audioRef.current) audioRef.current = new Audio();

  useDismissOnOutside([
    { open: modelOpen, ref: modelWrapRef, dismiss: () => setModelOpen(false) },
    { open: sourceOpen, ref: sourceWrapRef, dismiss: () => setSourceOpen(false) },
    { open: pickerOpen, ref: sourceWrapRef, dismiss: () => setPickerOpen(false) },
  ]);

  useEffect(() => {
    let active = true;
    fetchGenerationModels('audio')
      .then((list) => {
        if (!active) return;
        setModels(list);
        setModelsLoaded(true);
        // 原卡编辑保留已保存模型；不可用时由用户显式调整，不自动回写默认值。
        if (draftBinding?.restoreExisting || draftBinding?.status === 'generating') return;
        if (list.length > 0) {
          // 草稿带入的模型优先（仍在可用列表中时），否则回退首个；选中即写回草稿
          // IKDMQU Q3：恢复的模型已不可用时明确提示（回退默认，不静默降级），用户调整后再发送
          const restoredAvailable =
            !!initialModelId && list.some((m) => m.model_id === initialModelId);
          if (initialModelId && !restoredAvailable) {
            onToast?.('warn', '原生成模型已不可用，已回退默认模型，请确认后发送');
          }
          const restored = restoredAvailable ? initialModelId! : list[0].model_id;
          setModelId(restored);
          draftBinding?.onParamsChange({ modelId: restored });
        }
      })
      .catch(() => {
        if (!active) return;
        setModels([]);
        setModelsLoaded(true);
      });
    return () => { active = false; };
    // 挂载时按 seed 初始化一次，后续编辑经用户交互写回
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentModel = models.find((m) => m.model_id === modelId);
  const modelUnavailable = modelsLoaded && !currentModel;
  /** 草稿绑定生成中（IKDMQT）：描述/模型/发送只读，保留查看与画布上的取消入口 */
  const readOnly = draftBinding?.submitting || draftBinding?.status === 'generating';

  const handleTextChange = (value: string) => {
    setText(value);
    draftBinding?.onParamsChange({ prompt: value });
  };

  const handleModelSelect = (id: string) => {
    setModelId(id);
    setModelOpen(false);
    draftBinding?.onParamsChange({ modelId: id });
  };

  /** 打开来源菜单（本地上传 / 从画布选择），上限 MAX_AUDIO_REFS=3 */
  const handlePickAudio = () => {
    if (readOnly) return;
    if (refs.length >= MAX_AUDIO_REFS) {
      onToast?.('warn', `参考音频最多 ${MAX_AUDIO_REFS} 段已超出`);
      return;
    }
    setPickerOpen(false);
    setSourceOpen((v) => !v);
  };

  const startLocalUpload = () => {
    setSourceOpen(false);
    fileInputRef.current?.click();
  };

  const startCanvasPick = () => {
    setSourceOpen(false);
    setPickerOpen(true);
    onPickFromCanvas?.();
  };

  /** 添加参考项（去重 + 上限），画布选择后关闭面板 */
  const addRef = (item: AudioRefItem) => {
    setRefs((prev) => {
      if (prev.some((r) => r.id === item.id && r.source === item.source)) return prev;
      if (prev.length >= MAX_AUDIO_REFS) return prev;
      return [...prev, item];
    });
    setPickerOpen(false);
  };

  /** 外部注入的画布选择结果：去重 + 上限保护 */
  useEffect(() => {
    if (!externalPick) return;
    addRef(externalPick.item);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalPick]);

  const canvasAudios = (canvasMedia ?? []).filter((m) => m.mediaType === 'audio');

  const handleAudioFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!files.length) return;
    // 仅允许 MP3：非 mp3 明确提示并跳过（选择器 accept 已尽量过滤，此处兜底）
    const valid = files.filter((f) => {
      if (isMp3File(f)) return true;
      onToast?.('warn', `「${f.name}」不是 MP3 格式，已跳过`);
      return false;
    });
    if (valid.length === 0) return;
    const remaining = MAX_AUDIO_REFS - refs.length;
    const accepted = valid.slice(0, remaining);
    const next: AudioRefItem[] = accepted.map((f, i) => ({
      id: `local-${Date.now()}-${i}`,
      kind: 'audio',
      name: f.name,
      src: URL.createObjectURL(f),
      source: 'local',
      file: f,
    }));
    setRefs((prev) => [...prev, ...next]);
  };

  /** 点击参考 chip 播放/暂停（同一次点击的音频只允许一个在播） */
  const togglePlay = (item: AudioRefItem) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playingId === item.id) {
      audio.pause();
      setPlayingId(null);
      return;
    }
    audio.src = item.src;
    audio.currentTime = 0;
    audio.play().catch(() => {
      // 播放失败（如格式不被浏览器支持）静默忽略，不阻塞移除/发送
    });
    setPlayingId(item.id);
  };

  const handleRemoveRef = (id: string) => {
    if (playingId === id) {
      audioRef.current?.pause();
      setPlayingId(null);
    }
    setRefs((prev) => {
      const item = prev.find((r) => r.id === id);
      if (item?.source === 'local' && item.src.startsWith('blob:')) {
        URL.revokeObjectURL(item.src);
      }
      return prev.filter((r) => r.id !== id);
    });
  };

  /** 组件卸载时 revoke 所有 blob URL 并停播，防内存泄漏 */
  useEffect(() => {
    const audio = audioRef.current;
    const onEnded = () => setPlayingId(null);
    audio?.addEventListener('ended', onEnded);
    return () => {
      audio?.removeEventListener('ended', onEnded);
      audio?.pause();
      audioRef.current = null;
      refs.forEach((r) => {
        if (r.source === 'local' && r.src.startsWith('blob:')) URL.revokeObjectURL(r.src);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSend = () => {
    if (!text.trim() || !currentModel || readOnly || draftBinding?.saveFailed) return;
    onSend(text.trim(), modelId, refs);
    // 草稿绑定发送后保留输入（卡片原地转生成中，面板进入只读），非草稿保持清空
    if (!draftBinding) {
      setText('');
      setRefs([]);
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

      {/* 顶部参考按钮行（与 ImageDialog/BottomDialog 统一占位视觉；参考上传功能待后续接入） */}
      <div className={styles.topRow}>
        {/* 已上传的参考音频 chip：点击播放/暂停 */}
        {refs.map((r) => (
          <button
            key={`${r.source}-${r.id}`}
            type="button"
            className={`${styles.audioChip} ${playingId === r.id ? styles.audioChipPlaying : ''}`}
            onClick={() => togglePlay(r)}
            disabled={readOnly}
            title={playingId === r.id ? '暂停' : `播放：${r.name}`}
          >
            <span className={styles.audioChipIcon}>
              {playingId === r.id ? <Pause size={13} strokeWidth={2} /> : <Music2 size={13} strokeWidth={2} />}
            </span>
            <span className={styles.audioChipName}>{r.name}</span>
            <span
              role="button"
              tabIndex={-1}
              className={styles.audioChipRemove}
              onClick={(ev) => {
                ev.stopPropagation();
                handleRemoveRef(r.id);
              }}
              title="移除"
            >
              <XCircle size={14} strokeWidth={2} />
            </span>
          </button>
        ))}
        <div className={styles.refWrap} ref={sourceWrapRef}>
          {refs.length < MAX_AUDIO_REFS ? (
            <>
              <button
                className={`${styles.refBtn} ${pickMode ? styles.refBtnPicking : ''}`}
                onClick={handlePickAudio}
                disabled={readOnly}
                title={readOnly ? '生成中只读' : '添加参考音频（最多 3 段）'}
              >
                <AudioLines size={20} strokeWidth={2} />
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
            </>
          ) : (
            <span className={styles.refCount} title={`参考音频最多 ${MAX_AUDIO_REFS} 段`}>
              已达上限
            </span>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".mp3,audio/mpeg"
          multiple
          className={styles.hiddenInput}
          onChange={handleAudioFileChange}
        />
      </div>

      {/* 输入框 */}
      <textarea
        className={styles.textarea}
        data-testid="audio-input"
        placeholder="描述想生成的音频：可生成音乐、音效、台词、多人对话等任意类型，最长 120 秒。"
        value={text}
        onChange={(e) => handleTextChange(e.target.value.slice(0, MAX_INPUT))}
        rows={3}
        maxLength={MAX_INPUT}
        disabled={readOnly}
      />

      {modelUnavailable && <div role="alert">模型不可用，请选择可用模型后发送</div>}

      {/* 底部状态栏 */}
      <div className={styles.bottomBar}>
        <div className={styles.barLeft}>
          {/* 模式：固定显示「音频生成」，无下拉（AI 音乐已废弃） */}
          <div className={styles.modeBtn}>
            <AudioLines size={14} strokeWidth={2} />
            <span>音频生成</span>
          </div>

          {/* 模型选择 */}
          <div className={styles.modeWrap} ref={modelWrapRef}>
            <button className={styles.modeBtn} onClick={() => setModelOpen((v) => !v)} disabled={readOnly}>
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
                    onClick={() => handleModelSelect(opt.model_id)}
                  >
                    {opt.model_label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className={styles.barRight}>
          {readOnly && (
            <span className={styles.readOnlyHint}>生成中，参数只读；可在画布卡片上取消生成</span>
          )}
          {/* 字数统计 */}
          <div className={`${styles.charCount} ${text.length >= MAX_INPUT ? styles.charCountWarn : ''}`}>
            {text.length}/{MAX_INPUT}
          </div>
          <button
            className={`${styles.sendBtn} ${text.trim() && modelId ? styles.sendBtnActive : ''}`}
            data-testid="audio-send"
            disabled={!text.trim() || !currentModel || readOnly || draftBinding?.saveFailed}
            onClick={handleSend}
            title="发送"
          >
            <ArrowUp size={12.8} fill="currentColor" strokeWidth={0} />
          </button>
        </div>
      </div>
    </div>
  );
}
