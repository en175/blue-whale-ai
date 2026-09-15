/**
 * 「▤ .md」「打开查看」：把方案卡 / 提示词卡渲染成一页文档，右上角下载 .md（IKFLB9 定稿，对标竞品的文件查看）。
 * 复用面板自己的 Markdown 组件，所以表格、列表、素材胶囊和正文里长得一样。
 */
import { Download } from 'lucide-react';
import Modal from '@/components/Modal';
import styles from './index.module.css';
import { Markdown } from './Markdown';
import { downloadMarkdown } from './cardMarkdown';
import type { KnownAsset } from './assetMentions';

export function CardDocModal({ title, markdown, assets = [], onClose }: { title: string; markdown: string; assets?: readonly KnownAsset[]; onClose: () => void }) {
  const filename = `${title}.md`;
  return (
    <Modal
      open
      title={filename}
      footer={null}
      onCancel={onClose}
      width={720}
      centered
      classNames={{ body: styles.cardDocBody }}
    >
      <div className={styles.cardDocBar}>
        <button type="button" className={styles.cardBtn} onClick={() => downloadMarkdown(filename, markdown)}>
          <Download size={13} strokeWidth={2} />
          下载 .md
        </button>
      </div>
      <Markdown text={markdown} assets={assets} className={styles.cardDocMd} />
    </Modal>
  );
}
