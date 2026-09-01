import { X } from 'lucide-react';
import { ImageMentionChip } from '../ImageMentionChip';
import { VideoMentionChip } from '../VideoMentionChip';
import { composerAttachmentPreview } from './attachments';
import styles from './index.module.css';

export interface ComposerAttachmentChipProps {
  name: string;
  mediaType: 'image' | 'video';
  status: 'uploading' | 'ready' | 'failed';
  url?: string;
  error?: string;
  onRemove: () => void;
}

/**
 * 侧边栏上传在输入框上方的那一颗：有 URL 就走图片/视频提及胶囊，
 * 上传中也能看见缩略图，而不是干等「图片：文件名」。
 */
export function ComposerAttachmentChip({
  name,
  mediaType,
  status,
  url,
  error,
  onRemove,
}: ComposerAttachmentChipProps) {
  const preview = composerAttachmentPreview({ name, mediaType, url });
  const hint = status === 'uploading' ? '上传中…' : status === 'failed' ? (error ?? '上传失败') : null;

  if (preview) {
    return (
      <span className={`${styles.attachmentPreview} ${status === 'failed' ? styles.attachmentFailed : ''}`}>
        {preview.mediaType === 'video' ? (
          <VideoMentionChip url={preview.url} label={preview.label} onRemove={onRemove} />
        ) : (
          <ImageMentionChip url={preview.url} label={preview.label} onRemove={onRemove} />
        )}
        {hint ? <span className={styles.attachmentHint}>{hint}</span> : null}
      </span>
    );
  }

  return (
    <span
      className={`${styles.attachmentChip} ${status === 'failed' ? styles.attachmentFailed : ''}`}
      title={status === 'failed' ? error : name}
    >
      <span className={styles.attachmentName}>
        {mediaType === 'video' ? '视频' : '图片'}：{name}
      </span>
      {hint ? <span className={styles.attachmentHint}>{hint}</span> : null}
      <button
        type="button"
        className={styles.attachmentRemove}
        onClick={onRemove}
        title="移除"
        aria-label={`移除 ${name}`}
      >
        <X size={11} strokeWidth={2.5} />
      </button>
    </span>
  );
}

export default ComposerAttachmentChip;
