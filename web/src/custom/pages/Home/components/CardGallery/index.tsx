import { type GalleryMediaKind } from '@/custom/enums';
import { useEffect, useMemo, useState } from 'react';

import styles from './index.module.css';
import {
  fetchTemplateTags,
  fetchTemplatePage,
  type TemplateTag,
  type TemplateRecord,
} from '@/custom/api/agent';
import { remoteImageCrossOrigin, resolveMediaSrc } from '@/shared/utils/remoteImageCors';
import { galleryCoverSrc, mediaKindFromTagCode, shouldShowVideoChrome } from './galleryCardModel';

const FALLBACK_TAGS: TemplateTag[] = [
  { tag_code: 'video', label: '视频' },
  { tag_code: 'picture', label: '图片' },
];

const LAYOUT_CLASS: Record<string, string> = {
  wide: '',
  social: styles.cardSocial,
};

const HIDDEN_CASE_TITLES = new Set(['测试20260828144946']);

function truncate(text: string, max = 30) {
  return text.length > max ? text.slice(0, max) + '...' : text;
}

function GalleryCard({
  record,
  mediaKind,
  purposeLabel,
  onClick,
}: {
  record: TemplateRecord;
  mediaKind: GalleryMediaKind;
  purposeLabel: string;
  onClick?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [first, , third] = record.images ?? [];
  const cover = galleryCoverSrc(record.images);
  const layoutCls = LAYOUT_CLASS[record.layout] ?? LAYOUT_CLASS.wide;
  const videoChrome = shouldShowVideoChrome(mediaKind);
  const playingHoverVideo = Boolean(hovered && videoChrome && record.video);

  return (
    <div
      className={`${styles.card} ${layoutCls}`}
      data-testid="gallery-card"
      data-media-kind={mediaKind}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <p className={styles.cardTitle}>{truncate(record.title)}</p>
      <div className={styles.imageArea}>
        {cover ? (
          <>
            {first && (
              <img className={`${styles.stackImg} ${styles.stackLeft}`} src={resolveMediaSrc(first)} crossOrigin={remoteImageCrossOrigin(first)} alt="" loading="lazy" />
            )}
            {third && (
              <img className={`${styles.stackImg} ${styles.stackRight}`} src={resolveMediaSrc(third)} crossOrigin={remoteImageCrossOrigin(third)} alt="" loading="lazy" />
            )}
            <img className={`${styles.stackImg} ${styles.stackTop}`} src={resolveMediaSrc(cover)} crossOrigin={remoteImageCrossOrigin(cover)} alt={record.title} loading="lazy" />
          </>
        ) : mediaKind === 'image' ? (
          <div className={styles.imagePlaceholder} data-testid="gallery-image-placeholder" />
        ) : null}
        {videoChrome && !playingHoverVideo && (
          <div className={styles.hoverOverlay} data-testid="gallery-play-overlay">
            <span className={styles.playIcon}>▶</span>
          </div>
        )}
        <span className={styles.purposeTag}>{purposeLabel}</span>
      </div>
      {playingHoverVideo && (
        <video
          className={styles.hoverVideo}
          data-testid="gallery-hover-video"
          src={resolveMediaSrc(record.video)}
          autoPlay
          muted
          loop
          playsInline
          disablePictureInPicture
        />
      )}
    </div>
  );
}

export default function CardGallery({ onCardClick }: { onCardClick?: (text: string, mediaType: 'video' | 'image') => void }) {
  const [records, setRecords] = useState<{ tag: TemplateTag; records: TemplateRecord[] }[]>([]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const tags = await fetchTemplateTags().catch(() => FALLBACK_TAGS);
      const list = tags.length ? tags : FALLBACK_TAGS;
      const loaded = await Promise.all(
        list.map(async (tag) => ({
          tag,
          records: await fetchTemplatePage(tag.tag_code).then((page) => page.records ?? []).catch(() => []),
        })),
      );
      if (alive) setRecords(loaded);
    };
    void load();
    return () => {
      alive = false;
    };
  }, []);

  const cards = useMemo(() => {
    const groups = records
      .map(({ tag, records: list }) => ({
        tag,
        list: list.filter((record) => !HIDDEN_CASE_TITLES.has(record.title)),
      }))
      .filter((group) => group.list.length > 0);
    const longest = Math.max(0, ...groups.map((group) => group.list.length));
    const mixed: { record: TemplateRecord; tag: TemplateTag; mediaKind: GalleryMediaKind }[] = [];
    for (let index = 0; index < longest; index += 1) {
      groups.forEach((group) => {
        const record = group.list[index];
        if (record) mixed.push({ record, tag: group.tag, mediaKind: mediaKindFromTagCode(group.tag.tag_code) });
      });
    }
    return mixed;
  }, [records]);

  return (
    <div className={styles.gallery}>
      {}
      <div className={styles.cardGrid} data-testid="gallery-card-grid">
        {cards.map(({ record, tag, mediaKind }, idx) => (
          <GalleryCard
            key={`${record.title}-${idx}`}
            record={record}
            mediaKind={mediaKind}
            purposeLabel={tag.label}
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
