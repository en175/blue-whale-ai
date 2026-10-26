import { useEffect, useState } from 'react';
import { ArrowUp, SlidersHorizontal, X } from 'lucide-react';
import { fetchGenerationModels, type GenerationModel } from '@/custom/api/generation';
import { promptMaxLengthOf } from '@/custom/utils/prompt-max-length';
import Select from '@/custom/components/Select';
import { anchoredOverlayStyle, type FollowDialogAnchor } from '../../agent/followDialog';
import type { ImageTextAttachment } from '../ImageDialog';
import styles from './index.module.css';

interface TextGenDialogProps {
  onClose: () => void;
  onSend: (text: string, modelId: string) => void | Promise<void>;
  initialText?: string;
  attachments?: ImageTextAttachment[];
  followAnchor?: FollowDialogAnchor | null;
  dragHidden?: boolean;
  onParamsChange?: (patch: { prompt?: string; modelId?: string }) => void;
}

export default function TextGenDialog({
  onClose,
  onSend,
  initialText,
  attachments,
  followAnchor, dragHidden,
  onParamsChange,
}: TextGenDialogProps) {
  const [inputValue, setInputValue] = useState(initialText ?? '');
  const [modelList, setModelList] = useState<GenerationModel[]>([]);
  const [selectedModel, setSelectedModel] = useState('');

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
  const maxInput = promptMaxLengthOf(currentModel?.features?.max_prompt_length);
  const hasAttachmentText = (attachments ?? []).some((item) => item.text.trim().length > 0);
  const canSend = (inputValue.trim().length > 0 || hasAttachmentText) && Boolean(selectedModel);

  const handleSend = () => {
    if (!canSend) return;
    void onSend(inputValue.trim(), selectedModel);
  };

  return (
    <div
      className={`${styles.dialogWrap} ${followAnchor ? styles.dialogWrapFollow : ''}`}
      style={anchoredOverlayStyle(followAnchor ?? null, dragHidden)}
      data-gen-panel-territory
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
            maxLength={maxInput ?? undefined}
            onChange={(e) => {
              const next = maxInput != null ? e.target.value.slice(0, maxInput) : e.target.value;
              setInputValue(next);
              onParamsChange?.({ prompt: next });
            }}
          />

          <div className={styles.bottomBar}>
            <div className={styles.barLeft}>
              <Select
                value={selectedModel}
                onChange={(modelId) => {
                  setSelectedModel(modelId);
                  onParamsChange?.({ modelId });
                }}
                size="sm"
                side="top"
                placeholder="选择模型"
                leading={<SlidersHorizontal size={14} strokeWidth={2} />}
                triggerClassName={styles.configBtn}
                options={modelList.map((item) => ({
                  value: item.model_id,
                  label: item.model_label,
                }))}
              />
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
