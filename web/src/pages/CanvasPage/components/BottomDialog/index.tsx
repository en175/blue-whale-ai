/* ============================================
 * BottomDialog 视频对话窗口：模式/模型/时长/宽高比配置与发送
 * ============================================ */
import { useState, useRef, useEffect } from 'react';
import {
  Plus,
  ChevronDown,
  X,
  Image,
  Video,
  Sparkles,
  SlidersHorizontal,
  Play,
  ArrowUp,
} from 'lucide-react';
import { fetchGenerationModels, type GenerationModel } from '@/api/generation';
import ChipTextEditor, { type ChipTextEditorHandle, type ChipRef } from '../ChipTextEditor';
import styles from './index.module.css';

/** 模式选项 */
const modeOptions = [
  { key: 'all', label: '全能参考' },
  { key: 'keyframe', label: '首尾帧' },
];

/** 宽高比选项（接口失败回退） */
const FALLBACK_RATIOS = ['16:9', '9:16', '1:1'];

/** 时长范围（接口失败回退） */
const FALLBACK_DURATION = { min: 4, max: 15, step: 1 };

/** 视频最大上传数量（接口未下发该字段，前端统一 3） */
const MAX_VIDEOS = 3;

/** 视频生成参数（发送时传给画布创建生成任务） */
export interface VideoGenOptions {
  /** 模型ID（能力接口未加载时为空串，调用方需拦截） */
  modelId: string;
  aspectRatio: string;
  /** 分辨率 api_value，如 1080p */
  resolution: string;
  /** 时长（秒） */
  duration: number;
  /** 参考模式：all 全能参考 / keyframe 首尾帧 */
  mode: string;
}

/** 参考素材项（file 仅本地上传有值；画布带入的节点图片只有 preview URL） */
export interface BottomRefItem {
  file?: File;
  preview: string;
  type: 'image' | 'video';
}

interface BottomDialogProps {
  onClose: () => void;
  onSend: (text: string, opts: VideoGenOptions) => void;
  /** 初始参考素材（节点「生成视频」带入被点节点图片） */
  initialRefs?: BottomRefItem[];
  /** 初始生成卡引用胶囊（Agent 生成卡「引用到 dock」带入，累计不覆盖，可多张） */
  initialCards?: ChipRef[];
  /** 初始自由文本（视频节点「重新编辑」带入原提示词） */
  initialText?: string;
}

/** 宽高比图标：按比例绘制小矩形 */
function RatioIcon({ ratio }: { ratio: string }) {
  const [w, h] = ratio.split(':').map(Number);
  const max = 16;
  const width = w >= h ? max : Math.round((w / h) * max);
  const height = h >= w ? max : Math.round((h / w) * max);
  return <span className={styles.ratioIcon} style={{ width, height }} />;
}

export default function BottomDialog({ onClose, onSend, initialRefs, initialCards, initialText }: BottomDialogProps) {
  /** 富文本输入框（可多次插入生成卡引用胶囊，发送时替换成完整 prompt） */
  const chipEditorRef = useRef<ChipTextEditorHandle>(null);
  /** 输入框实时纯文本（胶囊已替换成完整 prompt），供生成按钮启用态判断 */
  const [composedText, setComposedText] = useState('');
  const [refFiles, setRefFiles] = useState<BottomRefItem[]>(initialRefs ?? []);
  /** 视频文件时长（秒），key 为 refFiles 索引 */
  const [videoDurations, setVideoDurations] = useState<Record<number, number>>({});
  const [selectedMode, setSelectedMode] = useState(modeOptions[0].key);
  const [modeOpen, setModeOpen] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [modelList, setModelList] = useState<GenerationModel[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedSize, setSelectedSize] = useState('');
  const [selectedRatio, setSelectedRatio] = useState('16:9');
  const [duration, setDuration] = useState(10);
  const [modelOpen, setModelOpen] = useState(false);
  const [sizeOpen, setSizeOpen] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const anyInputRef = useRef<HTMLInputElement>(null);

  /** Toast 提示 */
  const [toast, setToast] = useState('');
  const toastTimer = useRef<number | null>(null);
  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 2800);
  };

  const currentModel = modelList.find((m) => m.model_id === selectedModel) ?? null;
  const modelOptions = modelList.map((m) => ({ key: m.model_id, label: m.model_label }));
  const sizeOptions = currentModel?.supported_sizes?.length
    ? currentModel.supported_sizes.map((s) => ({ key: s.id, label: s.label }))
    : [{ key: '720p', label: '720p' }];
  const ratioOptions = currentModel?.supported_aspect_ratios?.length
    ? currentModel.supported_aspect_ratios
    : FALLBACK_RATIOS;
  const durationRange = currentModel?.supported_durations ?? FALLBACK_DURATION;
  const currentSizeLabel =
    sizeOptions.find((s) => s.key === selectedSize)?.label ?? selectedSize ?? '720p';
  const currentMode = modeOptions.find((m) => m.key === selectedMode);

  /** 首尾帧模式：仅允许上传 2 张图片（首帧+尾帧），禁止视频 */
  const isKeyframe = selectedMode === 'keyframe';
  const imageCount = refFiles.filter((f) => f.type === 'image').length;
  const videoCount = refFiles.filter((f) => f.type === 'video').length;
  /** 图片上限：首尾帧模式固定 2（首帧+尾帧），其余采用接口定义的 max_reference_images（失败回退 5） */
  const maxImages = isKeyframe ? 2 : (currentModel?.features?.max_reference_images ?? 5);

  /** 时长刻度（min..max 逐 step） */
  const ticks: number[] = [];
  for (let v = durationRange.min; v <= durationRange.max; v += durationRange.step) ticks.push(v);

  /** 选中模型后应用其默认清晰度/宽高比/时长 */
  const applyModelDefaults = (m: GenerationModel) => {
    setSelectedModel(m.model_id);
    if (m.supported_aspect_ratios.length) {
      setSelectedRatio(
        m.default_aspect_ratio && m.supported_aspect_ratios.includes(m.default_aspect_ratio)
          ? m.default_aspect_ratio
          : m.supported_aspect_ratios[0],
      );
    }
    if (m.supported_sizes.length) {
      setSelectedSize(
        m.default_size && m.supported_sizes.some((s) => s.id === m.default_size)
          ? (m.default_size as string)
          : m.supported_sizes[0].id,
      );
    }
    if (m.supported_durations) {
      const clamp = (v: number) =>
        Math.min(Math.max(v, m.supported_durations!.min), m.supported_durations!.max);
      setDuration(typeof m.default_duration === 'number' ? clamp(m.default_duration) : m.supported_durations.min);
    }
  };

  // 初始自由文本（视频节点重新编辑带入原提示词）—— 先设文本，再插胶囊，避免覆盖
  useEffect(() => {
    if (initialText) {
      chipEditorRef.current?.setText(initialText);
    }
  }, [initialText]);

  // 只插入 initialCards 里「上次还没插过」的新增部分：对话框不因追加引用而重挂载，
  // 已输入的自由文字不会被清空；ref 记录已插入数量，同时防 StrictMode 开发态 effect 双调用重复插入
  const insertedCardCountRef = useRef(0);
  useEffect(() => {
    const newCards = (initialCards ?? []).slice(insertedCardCountRef.current);
    insertedCardCountRef.current = initialCards?.length ?? 0;
    newCards.forEach((card) => chipEditorRef.current?.insertChip(card));
  }, [initialCards]);

  // 加载视频模型能力列表
  useEffect(() => {
    fetchGenerationModels('video')
      .then((list) => {
        setModelList(list);
        if (list.length) applyModelDefaults(list[0]);
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 上传图片（首尾帧模式限 2 张） */
  const handleImageClick = () => {
    if (imageCount < maxImages) imageInputRef.current?.click();
  };

  /** 上传视频（首尾帧模式禁用；达上限时按钮已隐藏） */
  const handleVideoClick = () => {
    if (isKeyframe) return;
    if (videoCount < MAX_VIDEOS) videoInputRef.current?.click();
  };

  /** 通用上传（底部加号；首尾帧模式仅收图片且限 2 张） */
  const handleAnyUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(e.target.files, 'any');
    e.target.value = '';
  };

  /** 处理图片上传（按接口上限/首尾帧 2 张截断） */
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(e.target.files, 'image');
    if (imageInputRef.current) imageInputRef.current.value = '';
  };

  /** 处理视频上传（首尾帧模式禁用） */
  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isKeyframe) return;
    addFiles(e.target.files, 'video');
    if (videoInputRef.current) videoInputRef.current.value = '';
  };

  /** 截断文件名用于 chip 展示 */
  const truncateName = (name: string, max = 14) => {
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    if (base.length <= max) return name;
    return `${base.slice(0, max)}...${ext}`;
  };

  /** 删除文件（仅本地上传的 objectURL 需要释放） */
  const removeFile = (index: number) => {
    setRefFiles((prev) => {
      const copy = [...prev];
      if (copy[index].file) URL.revokeObjectURL(copy[index].preview);
      copy.splice(index, 1);
      return copy;
    });
    setVideoDurations((prev) => {
      const next: Record<number, number> = {};
      // 删除后重新编号索引
      Object.entries(prev).forEach(([k, v]) => {
        const key = Number(k);
        if (key < index) next[key] = v;
        else if (key > index) next[key - 1] = v;
      });
      return next;
    });
  };

  /** 获取视频文件时长（秒） */
  const getVideoDuration = (file: File): Promise<number> =>
    new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        resolve(Math.round(video.duration * 10) / 10);
        URL.revokeObjectURL(video.src);
      };
      video.onerror = () => { resolve(0); URL.revokeObjectURL(video.src); };
      video.src = URL.createObjectURL(file);
    });

  /** 将文件列表转为 BottomRefItem[] 并预取视频时长 */
  const addFiles = async (files: FileList | null, acceptType?: 'image' | 'video' | 'any') => {
    if (!files || files.length === 0) return;
    const all = Array.from(files);
    const list = acceptType === 'image'
      ? all.filter((f) => f.type.startsWith('image/')).slice(0, Math.max(0, maxImages - imageCount))
      : acceptType === 'video'
        ? (isKeyframe ? [] : all.filter((f) => f.type.startsWith('video/')).slice(0, Math.max(0, MAX_VIDEOS - videoCount)))
        : (() => {
            let imgRoom = Math.max(0, maxImages - imageCount);
            let vidRoom = Math.max(0, MAX_VIDEOS - videoCount);
            return isKeyframe
              ? all.filter((f) => f.type.startsWith('image/')).slice(0, imgRoom)
              : all.filter((f) => {
                  if (f.type.startsWith('video/')) { if (vidRoom <= 0) return false; vidRoom -= 1; return true; }
                  if (f.type.startsWith('image/')) { if (imgRoom <= 0) return false; imgRoom -= 1; return true; }
                  return false;
                });
          })();
    if (!list.length) return;
    const startIdx = refFiles.length;
    const newItems: BottomRefItem[] = list.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
      type: (file.type.startsWith('video/') ? 'video' : 'image') as 'image' | 'video',
    }));
    setRefFiles((prev) => [...prev, ...newItems]);
    // 预取视频时长
    list.forEach(async (file, i) => {
      if (file.type.startsWith('video/')) {
        const dur = await getVideoDuration(file);
        setVideoDurations((prev) => ({ ...prev, [startIdx + i]: dur }));
      }
    });
  };

  /** 发送：composedText 已把胶囊替换成完整 prompt 并跟自由输入拼接好（携带模型/宽高比/清晰度/时长） */
  const handleSend = () => {
    const text = composedText.trim();
    if (!text) return;
    if (!currentModel) {
      console.warn('视频模型能力加载中，请稍后重试');
      return;
    }
    // 首尾帧模式校验：必须恰好 2 张图片
    if (isKeyframe) {
      if (videoCount > 0) {
        showToast('首尾帧模式仅支持上传首帧和尾帧两张图片，不支持视频');
        return;
      }
      if (imageCount !== 2) {
        showToast('首尾帧模式需要上传首帧和尾帧两张图片');
        return;
      }
    }
    const size = currentModel.supported_sizes.find((s) => s.id === selectedSize);
    onSend(text, {
      modelId: currentModel.model_id,
      aspectRatio: selectedRatio,
      resolution: size?.api_value ?? '720p',
      duration,
      mode: selectedMode,
    });
    chipEditorRef.current?.clear();
  };

  return (
    <div className={styles.dialog}>
      {/* 关闭按钮 */}
      <button className={styles.closeBtn} onClick={onClose} title="关闭">
        <X size={16} strokeWidth={2} />
      </button>

      {/* 配置面板（展开悬浮于底栏上方） */}
      {showConfig && (
        <div className={styles.configPanel}>
          {/* 关闭按钮 */}
          <button
            className={styles.configCloseBtn}
            onClick={() => setShowConfig(false)}
            title="关闭"
          >
            <X size={14} strokeWidth={2} />
          </button>
          {/* 模型与质量 */}
          <span className={styles.configLabel}>模型与质量</span>
          <div className={styles.configRow}>
            <div className={styles.selectWrap}>
              <button
                className={styles.selectBtn}
                onClick={() => { setModelOpen(!modelOpen); setSizeOpen(false); }}
              >
                <span>{currentModel?.model_label ?? '选择模型'}</span>
                <ChevronDown
                  size={14}
                  strokeWidth={2}
                  className={`${styles.configArrow} ${modelOpen ? styles.configArrowUp : ''}`}
                />
              </button>
              {modelOpen && (
                <div className={styles.selectDropdown}>
                  {modelOptions.map((m) => (
                    <button
                      key={m.key}
                      className={`${styles.selectOption} ${m.key === selectedModel ? styles.selectOptionActive : ''}`}
                      onClick={() => {
                        const gen = modelList.find((x) => x.model_id === m.key);
                        if (gen) applyModelDefaults(gen);
                        setModelOpen(false);
                      }}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className={styles.selectWrap}>
              <button
                className={styles.selectBtn}
                onClick={() => { setSizeOpen(!sizeOpen); setModelOpen(false); }}
              >
                <span>{currentSizeLabel}</span>
                <ChevronDown
                  size={14}
                  strokeWidth={2}
                  className={`${styles.configArrow} ${sizeOpen ? styles.configArrowUp : ''}`}
                />
              </button>
              {sizeOpen && (
                <div className={styles.selectDropdown}>
                  {sizeOptions.map((s) => (
                    <button
                      key={s.key}
                      className={`${styles.selectOption} ${s.key === selectedSize ? styles.selectOptionActive : ''}`}
                      onClick={() => { setSelectedSize(s.key); setSizeOpen(false); }}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 时长滑杆 */}
          <div className={styles.durationHead}>
            <span className={styles.configLabel}>时长</span>
            <span className={styles.durationValue}>{duration}s</span>
          </div>
          <input
            type="range"
            className={styles.durationSlider}
            min={durationRange.min}
            max={durationRange.max}
            step={durationRange.step}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
          />
          <div className={styles.durationTicks}>
            {ticks.map((v) => (
              <span key={v} className={`${styles.tick} ${v === duration ? styles.tickActive : ''}`} />
            ))}
          </div>
          <div className={styles.durationRange}>
            <span>{durationRange.min}s</span>
            <span>{durationRange.max}s</span>
          </div>

          {/* 宽高比 */}
          <span className={styles.configLabel}>宽高比</span>
          <div className={styles.ratioGroup}>
            {ratioOptions.map((r) => (
              <button
                key={r}
                className={`${styles.ratioBtn} ${r === selectedRatio ? styles.ratioBtnActive : ''}`}
                onClick={() => setSelectedRatio(r)}
              >
                <RatioIcon ratio={r} />
                <span>{r}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 顶部媒体行：已上传缩略图 + 上传按钮 + 计数（同一水平行） */}
      <div className={styles.mediaRow}>
        {/* 图片缩略图 */}
        {refFiles.filter((f) => f.type === 'image').map((item, i) => {
          const idx = refFiles.indexOf(item);
          return (
            <div key={`img-${i}`} className={styles.mediaThumb}>
              <img src={item.preview} alt="" className={styles.mediaThumbImg} />
              <button className={styles.mediaThumbRemove} onClick={() => removeFile(idx)} title="移除">
                <X size={10} strokeWidth={2} />
              </button>
            </div>
          );
        })}
        {/* 图片上传按钮 */}
        {imageCount < maxImages && (
          <button className={styles.mediaBtn} onClick={handleImageClick} title={`上传图片（最多 ${maxImages} 张）`}>
            <Image size={18} strokeWidth={2} />
          </button>
        )}

        {/* 分隔点 */}
        {((imageCount > 0 || imageCount < maxImages) && (isKeyframe || videoCount < MAX_VIDEOS || videoCount > 0)) && (
          <div className={styles.mediaDot} />
        )}

        {/* 视频缩略图 */}
        {!isKeyframe && refFiles.filter((f) => f.type === 'video').map((item, i) => {
          const idx = refFiles.indexOf(item);
          const dur = videoDurations[idx];
          return (
            <div key={`vid-${i}`} className={styles.mediaThumb}>
              <video src={item.preview} className={styles.mediaThumbImg} muted />
              <button className={styles.mediaThumbRemove} onClick={() => removeFile(idx)} title="移除">
                <X size={10} strokeWidth={2} />
              </button>
              {dur ? <span className={styles.mediaDuration}>{dur}s</span> : null}
              <div className={styles.mediaPlayIcon}><Play size={12} fill="#fff" strokeWidth={0} /></div>
            </div>
          );
        })}
        {/* 视频上传按钮 */}
        {(isKeyframe || videoCount < MAX_VIDEOS) && (
          <button
            className={styles.mediaBtn}
            onClick={handleVideoClick}
            title={isKeyframe ? '首尾帧模式不支持视频' : `上传视频（最多 ${MAX_VIDEOS} 个）`}
            disabled={isKeyframe}
          >
            <Video size={18} strokeWidth={2} />
          </button>
        )}

        {/* 计数 */}
        {refFiles.length > 0 && (
          <span className={styles.fileCount}>
            {isKeyframe ? `${imageCount}/2` : `${refFiles.length}/15`}
          </span>
        )}
      </div>

      {/* 文件名 chips */}
      {refFiles.length > 0 && (
        <div className={styles.fileChipRow}>
          {refFiles.map((item, idx) => (
            <div key={idx} className={styles.fileChip}>
              {item.type === 'image'
                ? <Image size={12} strokeWidth={2} />
                : <Video size={12} strokeWidth={2} />}
              <span>{item.file ? truncateName(item.file.name) : (item.type === 'image' ? '图片' : '视频')}</span>
              <button
                className={styles.fileChipRemove}
                onClick={() => removeFile(idx)}
                title="移除"
              >
                <X size={10} strokeWidth={2} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 隐藏的 file inputs */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        className={styles.hiddenInput}
        onChange={handleImageUpload}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        multiple
        className={styles.hiddenInput}
        onChange={handleVideoUpload}
      />
      <input
        ref={anyInputRef}
        type="file"
        accept={
          isKeyframe
            ? 'image/*'
            : imageCount >= maxImages
              ? 'video/*'
              : videoCount >= MAX_VIDEOS
                ? 'image/*'
                : 'image/*,video/*'
        }
        multiple
        className={styles.hiddenInput}
        onChange={handleAnyUpload}
      />

      {/* 输入框：可多次插入生成卡引用胶囊，胶囊跟文字同一行 */}
      <div className={styles.editorWrap}>
        <ChipTextEditor
          ref={chipEditorRef}
          placeholder="上传 3-10 秒视频，结合文本或图片编辑，@ 插入已添加资源。"
          onChangeText={setComposedText}
          onSend={handleSend}
          className={styles.editorArea}
        />
      </div>

      {/* 底部状态栏 */}
      <div className={styles.bottomBar}>
        {/* 左侧 */}
        <div className={styles.barLeft}>
          {/* 加号上传（两类均达上限隐藏） */}
          {(isKeyframe
            ? imageCount < maxImages
            : imageCount < maxImages || videoCount < MAX_VIDEOS) && (
            <button
              className={styles.addBtn}
              onClick={() => anyInputRef.current?.click()}
              title="添加素材"
            >
              <Plus size={14} strokeWidth={2} />
            </button>
          )}

          {/* 模式选择器 */}
          <div className={styles.modeWrap}>
            <button
              className={styles.modeBtn}
              onClick={() => setModeOpen(!modeOpen)}
            >
              <span>{currentMode?.label ?? '选择模式'}</span>
              <ChevronDown
                size={12}
                strokeWidth={2}
                className={`${styles.modeArrow} ${modeOpen ? styles.modeArrowUp : ''}`}
              />
            </button>
            {modeOpen && (
              <div className={styles.modeDropdown}>
                {modeOptions.map((opt) => (
                  <button
                    key={opt.key}
                    className={`${styles.modeOption} ${opt.key === selectedMode ? styles.modeOptionActive : ''}`}
                    onClick={() => {
                      if (opt.key === 'keyframe' && videoCount > 0) {
                        showToast('首尾帧模式仅支持图片，请先移除视频文件');
                        setModeOpen(false);
                        return;
                      }
                      if (opt.key === 'keyframe' && imageCount > 2) {
                        showToast('首尾帧模式仅支持上传 2 张图片，请先移除多余图片');
                        setModeOpen(false);
                        return;
                      }
                      setSelectedMode(opt.key);
                      setModeOpen(false);
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 配置信息（点击展开配置面板） */}
          <button className={styles.configBtn} onClick={() => setShowConfig(!showConfig)}>
            <SlidersHorizontal size={14} strokeWidth={2} />
            <span>{currentModel?.model_label ?? 'Seedance 2.0'}</span>
            <span className={styles.barDivider}>|</span>
            <span>{selectedRatio}</span>
            <span className={styles.barDivider}>|</span>
            <span>{currentSizeLabel}</span>
            <span className={styles.barDivider}>|</span>
            <span>{duration}s</span>
          </button>
        </div>

        {/* 右侧：消耗 + 发送 */}
        <div className={styles.barRight}>
          <span className={styles.costText}>
            <Sparkles size={14} strokeWidth={2} />
            <span>15 生成</span>
          </span>
          <button
            className={`${styles.sendBtn} ${composedText.trim() ? styles.sendBtnActive : ''}`}
            onClick={handleSend}
            disabled={!composedText.trim()}
            title="发送"
          >
            <ArrowUp size={16} fill="currentColor" strokeWidth={0} />
          </button>
        </div>
      </div>

      {/* Toast 提示 */}
      {toast && (
        <div className={styles.toast} role="alert">
          {toast}
        </div>
      )}
    </div>
  );
}
