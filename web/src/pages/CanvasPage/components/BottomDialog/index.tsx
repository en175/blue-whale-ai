/* ============================================
 * BottomDialog 视频对话窗口：模式/模型/时长/宽高比配置与发送
 * ============================================ */
import { useState, useRef, useEffect } from 'react';
import {
  Plus,
  ChevronDown,
  ChevronUp,
  X,
  Image,
  Video,
  Sparkles,
  SlidersHorizontal,
} from 'lucide-react';
import { fetchGenerationModels, type GenerationModel } from '@/api/generation';
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
  /** 初始提示词（Agent 生成卡「引用到 dock」带入的分镜提示词） */
  initialPrompt?: string;
  /** 初始提示词胶囊标签（如「镜头 1 · 光影揭幕」） */
  initialPromptLabel?: string;
}

/** 宽高比图标：按比例绘制小矩形 */
function RatioIcon({ ratio }: { ratio: string }) {
  const [w, h] = ratio.split(':').map(Number);
  const max = 16;
  const width = w >= h ? max : Math.round((w / h) * max);
  const height = h >= w ? max : Math.round((h / w) * max);
  return <span className={styles.ratioIcon} style={{ width, height }} />;
}

export default function BottomDialog({ onClose, onSend, initialRefs, initialPrompt, initialPromptLabel }: BottomDialogProps) {
  // Agent 生成卡整体进入输入框：标题作为首行，提示词随其后（作为对话框整体内容）
  const [inputValue, setInputValue] = useState(() => {
    const prompt = initialPrompt ?? '';
    return initialPromptLabel ? `${initialPromptLabel}\n${prompt}` : prompt;
  });
  const [refFiles, setRefFiles] = useState<BottomRefItem[]>(initialRefs ?? []);
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
  const maxImages = isKeyframe ? 2 : 5;

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

  /** 上传视频（首尾帧模式禁用） */
  const handleVideoClick = () => {
    if (isKeyframe) return;
    if (refFiles.length < 5) videoInputRef.current?.click();
  };

  /** 通用上传（底部加号；首尾帧模式仅收图片且限 2 张） */
  const handleAnyUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const list = isKeyframe
      ? Array.from(files)
          .filter((f) => f.type.startsWith('image/'))
          .slice(0, Math.max(0, maxImages - imageCount))
      : Array.from(files).slice(0, 5 - refFiles.length);
    const newFiles = list.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
      type: (file.type.startsWith('video/') ? 'video' : 'image') as 'image' | 'video',
    }));
    setRefFiles((prev) => [...prev, ...newFiles]);
    e.target.value = '';
  };

  /** 处理图片上传（首尾帧模式限 2 张） */
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const remaining = isKeyframe ? Math.max(0, maxImages - imageCount) : 5 - refFiles.length;
    const newFiles = Array.from(files).slice(0, remaining).map((file) => ({
      file,
      preview: URL.createObjectURL(file),
      type: 'image' as const,
    }));
    setRefFiles((prev) => [...prev, ...newFiles]);
    if (imageInputRef.current) imageInputRef.current.value = '';
  };

  /** 处理视频上传（首尾帧模式禁用） */
  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isKeyframe) return;
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const remaining = 5 - refFiles.length;
    const newFiles = Array.from(files).slice(0, remaining).map((file) => ({
      file,
      preview: URL.createObjectURL(file),
      type: 'video' as const,
    }));
    setRefFiles((prev) => [...prev, ...newFiles]);
    if (videoInputRef.current) videoInputRef.current.value = '';
  };

  /** 删除文件（仅本地上传的 objectURL 需要释放） */
  const removeFile = (index: number) => {
    setRefFiles((prev) => {
      const copy = [...prev];
      if (copy[index].file) URL.revokeObjectURL(copy[index].preview);
      copy.splice(index, 1);
      return copy;
    });
  };

  /** 发送：携带当前选择的模型/宽高比/清晰度/时长（模型未加载完成时拦截） */
  const handleSend = () => {
    if (!inputValue.trim()) return;
    if (!currentModel) {
      console.warn('视频模型能力加载中，请稍后重试');
      return;
    }
    const size = currentModel.supported_sizes.find((s) => s.id === selectedSize);
    onSend(inputValue, {
      modelId: currentModel.model_id,
      aspectRatio: selectedRatio,
      resolution: size?.api_value ?? '720p',
      duration,
      mode: selectedMode,
    });
    setInputValue('');
  };

  /** 键盘事件 */
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

      {/* 顶部媒体上传 */}
      <div className={styles.mediaToggle}>
        <button className={styles.mediaBtn} onClick={handleImageClick} title="上传图片">
          <Image size={18} strokeWidth={2} />
        </button>
        <div className={styles.mediaDot} />
        <button
          className={styles.mediaBtn}
          onClick={handleVideoClick}
          title={isKeyframe ? '首尾帧模式不支持视频' : '上传视频'}
          disabled={isKeyframe}
        >
          <Video size={18} strokeWidth={2} />
        </button>
        {refFiles.length > 0 && (
          <span className={styles.fileCount}>
            {isKeyframe ? `${imageCount}/2` : `${refFiles.length}/5`}
          </span>
        )}
      </div>

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
        accept="image/*,video/*"
        multiple
        className={styles.hiddenInput}
        onChange={handleAnyUpload}
      />

      {/* 上传文件预览 */}
      {refFiles.length > 0 && (
        <div className={styles.previewArea}>
          {refFiles.map((item, idx) => (
            <div key={idx} className={styles.previewItem}>
              {item.type === 'image' ? (
                <img src={item.preview} alt="" className={styles.previewThumb} />
              ) : (
                <video src={item.preview} className={styles.previewThumb} />
              )}
              <button
                className={styles.previewRemove}
                onClick={() => removeFile(idx)}
                title="移除"
              >
                <X size={10} strokeWidth={2} />
              </button>
              <span className={styles.previewLabel}>
                {item.type === 'image' ? '图片' : '视频'}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* 输入框（Agent 生成卡以标题+提示词整体进入） */}
      <textarea
        className={styles.textarea}
        placeholder="上传 3-10 秒视频片段，并结合文本或图片轻松修改内容、改变镜头角度或重塑原视频风格。可使用 @ 快速插入已添加资源。"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={2}
      />

      {/* 底部状态栏 */}
      <div className={styles.bottomBar}>
        {/* 左侧 */}
        <div className={styles.barLeft}>
          {/* 加号上传 */}
          <button
            className={styles.addBtn}
            onClick={() => anyInputRef.current?.click()}
            title="添加素材"
          >
            <Plus size={14} strokeWidth={2} />
          </button>

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

        {/* 右侧：倍速 + 生成 + 配置展开 */}
        <div className={styles.barRight}>
          <span className={styles.barInfo}>1x</span>
          <div className={styles.sendWrap}>
            <button
              className={`${styles.generateBtn} ${inputValue.trim() ? styles.generateBtnActive : ''}`}
              onClick={handleSend}
              disabled={!inputValue.trim()}
            >
              <Sparkles size={14} strokeWidth={2} />
              <span>15</span>
              <span>生成</span>
            </button>
            <button
              className={styles.configToggle}
              onClick={() => setShowConfig(!showConfig)}
              title={showConfig ? '收起配置' : '展开配置'}
            >
              <ChevronUp
                size={14}
                strokeWidth={2}
                className={`${styles.configToggleArrow} ${showConfig ? styles.configToggleArrowOpen : ''}`}
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
