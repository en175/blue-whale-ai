import { type GalleryMediaKind } from '@/custom/enums';
import { useEffect, useMemo, useState } from 'react';
import { Image as ImageIcon, Video } from 'lucide-react';

import styles from './index.module.css';
import {
  fetchTemplateTags,
  fetchTemplatePage,
  type TemplateTag,
  type TemplateRecord,
} from '@/custom/api/agent';
import { remoteImageCrossOrigin, resolveMediaSrc } from '@/shared/utils/remoteImageCors';
import { galleryCoverSrc, galleryPreloadMode, shouldShowVideoChrome } from './galleryCardModel';

const FALLBACK_TAGS: TemplateTag[] = [
  { tag_code: 'video', label: '视频' },
  { tag_code: 'picture', label: '图片' },
];

const HIDDEN_CASE_TITLES = new Set(['测试20260828144946']);

function mediaKindOf(record: TemplateRecord): GalleryMediaKind {
  return record.video ? 'video' : 'image';
}

function truncate(text: string, max = 30) {
  return text.length > max ? text.slice(0, max) + '...' : text;
}

function GalleryCard({
  record,
  mediaKind,
  purposeLabel,
  preload,
  onClick,
}: {
  record: TemplateRecord;
  mediaKind: GalleryMediaKind;
  purposeLabel: string;
  preload: 'eager' | 'lazy';
  onClick?: () => void;
}) {
  const cover = galleryCoverSrc(record.images);
  const videoChrome = shouldShowVideoChrome(mediaKind);
  const TypeIcon = videoChrome ? Video : ImageIcon;
  const video = videoChrome ? record.video : '';

  return (
    <button
      type="button"
      className={styles.card}
      data-testid="gallery-card"
      data-media-kind={mediaKind}
      onClick={onClick}
    >
      <div className={styles.cover}>
        {video ? (
          <video
            className={styles.coverVideo}
            data-testid="gallery-video"
            data-preload={preload}
            src={resolveMediaSrc(video)}
            poster={cover ? resolveMediaSrc(cover) : undefined}
            autoPlay
            muted
            loop
            playsInline
            disablePictureInPicture
            preload={preload === 'eager' ? 'auto' : 'metadata'}
          />
        ) : cover ? (
          <img
            className={styles.coverImg}
            src={resolveMediaSrc(cover)}
            crossOrigin={remoteImageCrossOrigin(cover)}
            alt={record.title}
            loading={preload}
          />
        ) : (
          <span className={styles.coverEmpty}>暂无内容预览</span>
        )}
        <span className={styles.typeIcon} aria-hidden="true">
          <TypeIcon size={15} strokeWidth={1.8} />
        </span>
      </div>
      <span className={styles.cardTitle}>{truncate(record.title)}</span>
      <span className={styles.cardTags}>{purposeLabel}</span>
    </button>
  );
}

export default function CardGallery({ onCardClick }: { onCardClick?: (text: string, mediaType: 'video' | 'image') => void }) {
  const [records, setRecords] = useState<{ tag: TemplateTag; records: TemplateRecord[] }[]>([]);
  const [activeTag, setActiveTag] = useState('');

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const tags = await fetchTemplateTags().catch(() => FALLBACK_TAGS);
      const list = tags.length ? tags : FALLBACK_TAGS;
      const loaded = await Promise.all(
        list.map(async (tag) => ({
          tag,
          records: await fetchTemplatePage(tag.tag_code, 1, 50, { isFeatured: true })
            .then((page) => page.records ?? [])
            .catch(() => []),
        })),
      );
      if (!alive) return;
      setRecords(loaded);
      setActiveTag(list[0].tag_code);
    };
    void load();
    return () => {
      alive = false;
    };
  }, []);

  const tags = records.map((group) => group.tag);

  const cards = useMemo(() => {
    const groups = records
      .filter((group) => !activeTag || group.tag.tag_code === activeTag)
      .map(({ tag, records: list }) => ({
        tag,
        list: list.filter((record) => !HIDDEN_CASE_TITLES.has(record.title)),
      }))
      .filter((group) => group.list.length > 0);
    return groups.flatMap((group) =>
      group.list.map((record) => ({ record, tag: group.tag, mediaKind: mediaKindOf(record) })),
    );
  }, [records, activeTag]);

  return (
    <div className={styles.gallery}>
      {tags.length > 1 && (
        <div className={styles.filters} role="group" aria-label="案例分类">
          {tags.map((tag) => (
            <button
              key={tag.tag_code}
              type="button"
              className={styles.filter}
              aria-pressed={activeTag === tag.tag_code}
              onClick={() => setActiveTag(tag.tag_code)}
            >
              {tag.label}
            </button>
          ))}
        </div>
      )}

      <div className={styles.cardGrid} data-testid="gallery-card-grid">
        {cards.map(({ record, tag, mediaKind }, idx) => (
          <GalleryCard
            key={`${record.title}-${idx}`}
            record={record}
            mediaKind={mediaKind}
            purposeLabel={tag.label}
            preload={galleryPreloadMode(activeTag, tag.tag_code)}
            onClick={() => {
              const text = record.content?.trim() || record.title;
              onCardClick?.(text, mediaKind);
            }}
          />
        ))}
      </div>
    </div>
  );
}
