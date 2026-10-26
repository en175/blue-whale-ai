import type { NodeKey } from 'lexical';
import { $getNodeByKey } from 'lexical';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { AtSign, X } from 'lucide-react';
import { ImageMentionChip } from '../ImageMentionChip';
import { AudioMentionChip, VideoMentionChip } from '../VideoMentionChip';
import styles from './index.module.css';

export default function ChipComponent({
  nodeKey,
  label,
  imageUrl,
  videoUrl,
  audioUrl,
}: {
  nodeKey: NodeKey;
  label: string;
  imageUrl?: string;
  videoUrl?: string;
  audioUrl?: string;
}) {
  const [editor] = useLexicalComposerContext();
  const handleRemove = () => {
    if (!editor.isEditable()) return;
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      node?.remove();
    });
  };
  if (audioUrl) {
    return <AudioMentionChip url={audioUrl} label={label} onRemove={handleRemove} />;
  }
  if (videoUrl) {
    return <VideoMentionChip url={videoUrl} label={label} onRemove={handleRemove} />;
  }
  if (imageUrl) {
    return <ImageMentionChip url={imageUrl} label={label} onRemove={handleRemove} />;
  }
  return (
    <span className={styles.chip} contentEditable={false}>
      <AtSign size={12} strokeWidth={2} className={styles.chipIcon} />
      <span className={styles.chipLabel}>{label}</span>
      <button
        type="button"
        className={styles.chipRemove}
        onMouseDown={(e) => e.preventDefault()}
        onClick={handleRemove}
        title="移除引用"
      >
        <X size={12} strokeWidth={2} />
      </button>
    </span>
  );
}
