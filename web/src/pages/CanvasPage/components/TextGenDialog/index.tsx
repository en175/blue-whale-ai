/* 文本生成跟随输入框：文生文模式，大类定死 */
import { useEffect, useRef, useState } from 'react';
import { ArrowUp, ChevronDown, SlidersHorizontal, X } from 'lucide-react';
import { fetchGenerationModels, type GenerationModel } from '@/api/generation';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside';
import type { FollowDialogAnchor } from '../../followDialog';
import type { ImageTextAttachment } from '../ImageDialog';
import styles from './index.module.css';

const DEFAULT_MAX_INPUT = 1000;

interface TextGenDialogProps {
  onClose: () => void;
  onSend: (text: string, modelId: string) => void | Promise<void>;
  initialText?: string;
  attachments?: ImageTextAttachment[];
  followAnchor?: FollowDialogAnchor | null;
  onParamsChange?: (patch: { prompt?: string; modelId?: string }) => void;
}

export default function TextGenDialog({
  onClose,
  onSend,
  initialText,
  attachments,
  followAnchor,
  onParamsChange,
}: TextGenDialogProps) {
  const [inputValue, setInputValue] = useState(initialText ?? '');
  const [modelList, setModelList] = useState<GenerationModel[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [modelOpen, setModelOpen] = useState(false);
  const modelWrapRef = useRef<HTMLDivElement>(null);

  useDismissOnOutside([{ open: modelOpen, ref: modelWrapRef, dismiss: () => setModelOpen(false) }]);

  useEffect(() => {
    let cancelled = false;
    fetchGenerationModels('text').then((list) => {
      if (cancelled) return;
      setModelList(list);
      const fallback = list.find((item) => item.is_default)?.model_id ?? list[0]?.model_id ?? '';
      setSelectedModel((prev) => prev || fallback);
    }).catch(() => {
      if (!cancelled) setModelList([]);
    });
    return () => { cancelled = true; };
  }, []);

  const currentModel = modelList.find((item) => item.model_id === selectedModel);
  const maxInput = currentModel?.features?.max_prompt_length ?? DEFAULT_MAX_INPUT;
  const hasAttachmentText = (attachments ?? []).some((item) => item.text.trim().length > 0);
  const canSend = (inputValue.trim().length > 0 || hasAttachmentText) && Boolean(selectedModel);

  const handleSend = () => {
    if (!canSend) return;
    void onSend(inputValue.trim(), selectedModel);
  };

  return (
    <div
      className={`${styles.dialogWrap} ${followAnchor ? styles.dialogWrapFollow : ''}`}
      style={followAnchor ? { left: followAnchor.left, top: followAnchor.top } : undefined}
    >
      <div className={styles.dialog}>
        <div className={styles.inputBox}>
          <div className={styles.topRow}>
            <span className={styles.kindLabel}>文本生成 · 文生文</span>
            <div className={styles.topActions}>
              <button type="button" className={styles.iconBtn} onClick={onClose} title="关闭">
                <X size={14} strokeWidth={2} />
              </button>
            </div>
          </div>

          {attachments && attachments.length > 0 && (
            <div className={styles.attachments}>
              {attachments.map((item) => (
                <div key={item.nodeId} className={styles.attachmentItem}>
                  {item.title}：{item.text.slice(0, 80)}{item.text.length > 80 ? '…' : ''}
                </div>
              ))}
            </div>
          )}

          <textarea
            className={styles.textarea}
            placeholder="描述你希望生成的文案，可结合连入的参考。"
            value={inputValue}
            maxLength={maxInput}
            onChange={(e) => {
              const next = e.target.value.slice(0, maxInput);
              setInputValue(next);
              onParamsChange?.({ prompt: next });
            }}
          />

          <div className={styles.bottomBar}>
            <div className={styles.barLeft}>
              <div className={styles.selectWrap} ref={modelWrapRef}>
                <button
                  type="button"
                  className={styles.configBtn}
                  onClick={() => setModelOpen((open) => !open)}
                >
                  <SlidersHorizontal size={14} strokeWidth={2} />
                  <span>{currentModel?.model_label ?? '选择模型'}</span>
                  <ChevronDown size={12} strokeWidth={2} />
                </button>
                {modelOpen && (
                  <div className={styles.selectDropdown}>
                    {modelList.map((item) => (
                      <button
                        key={item.model_id}
                        type="button"
                        className={`${styles.selectOption} ${item.model_id === selectedModel ? styles.selectOptionActive : ''}`}
                        onClick={() => {
                          setSelectedModel(item.model_id);
                          onParamsChange?.({ modelId: item.model_id });
                          setModelOpen(false);
                        }}
                      >
                        {item.model_label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <button
              type="button"
              className={`${styles.sendBtn} ${canSend ? styles.sendBtnActive : ''}`}
              disabled={!canSend}
              onClick={handleSend}
              title="发送"
            >
              <ArrowUp size={16} fill="currentColor" strokeWidth={0} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
