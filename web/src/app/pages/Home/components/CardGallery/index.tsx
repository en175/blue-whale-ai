import { useEffect, useState } from 'react';
import {
  Megaphone,
  Clapperboard,
  Copy,
  Share2,
  Palette,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import styles from './index.module.css';
import {
  fetchTemplateTags,
  fetchTemplatePage,
  type TemplateTag,
  type TemplateRecord,
} from '@/app/api/agent';
import { remoteImageCrossOrigin, resolveMediaSrc } from '@/shared/utils/remoteImageCors';
import {
  galleryCoverSrc,
  mediaKindFromTagCode,
  shouldShowVideoChrome,
  type GalleryMediaKind,
} from './galleryCardModel';

const TAG_ICON_BY_CODE: Record<string, LucideIcon> = {
  marketing: Megaphone,
  short: Clapperboard,
  replicate: Copy,
  clone: Copy,
  social: Share2,
  image: Palette,
  design: Palette,
  video: Clapperboard,
  picture: Palette,
};

const TAG_ICON_BY_LABEL: Record<string, LucideIcon> = {
  营销视频: Megaphone,
  微短片: Clapperboard,
  视频复刻: Copy,
  社媒视频: Share2,
  图片设计: Palette,
};

const DEFAULT_TAG_ICON = Sparkles;

const iconForTag = (tag: TemplateTag): LucideIcon =>
  TAG_ICON_BY_CODE[tag.tag_code] ?? TAG_ICON_BY_LABEL[tag.label] ?? DEFAULT_TAG_ICON;

const FALLBACK_TAGS: TemplateTag[] = [
  { tag_code: 'video', label: '视频' },
  { tag_code: 'picture', label: '图片' },
];

const LAYOUT_CLASS: Record<string, string> = {
  wide: '',
  social: styles.cardSocial,
};

function truncate(text: string, max = 30) {
  return text.length > max ? text.slice(0, max) + '...' : text;
}

function GalleryCard({
  record,
  mediaKind,
  onClick,
}: {
  record: TemplateRecord;
  mediaKind: GalleryMediaKind;
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
  const [tags, setTags] = useState<TemplateTag[]>(FALLBACK_TAGS);
  const [activeTag, setActiveTag] = useState('');
  const [records, setRecords] = useState<TemplateRecord[]>([]);

  useEffect(() => {
    fetchTemplateTags()
      .then((list) => {
        if (!list.length) return;
        setTags(list);
        setActiveTag((prev) =>
          list.some((t) => t.tag_code === prev) ? prev : list[0].tag_code
        );
      })
      .catch(() => setActiveTag((prev) => prev || FALLBACK_TAGS[0].tag_code));
  }, []);

  useEffect(() => {
    if (!activeTag) return;
    let alive = true;
    fetchTemplatePage(activeTag)
      .then((page) => {
        if (alive) setRecords(page.records ?? []);
      })
      .catch(() => {
        if (alive) setRecords([]);
      });
    return () => {
      alive = false;
    };
  }, [activeTag]);

  return (
    <div className={styles.gallery}>
      {}
      <div className={styles.tabBar}>
        {tags.map((tag) => {
          const Icon = iconForTag(tag);
          return (
            <button
              key={tag.tag_code}
              className={`${styles.tabBtn} ${activeTag === tag.tag_code ? styles.tabBtnActive : ''}`}
              onClick={() => setActiveTag(tag.tag_code)}
            >
              <Icon size={16} strokeWidth={2} />
              <span>{tag.label}</span>
            </button>
          );
        })}
      </div>

      {}
      <div className={styles.cardGrid} data-testid="gallery-card-grid">
        {records.map((record, idx) => {
          const mediaKind = mediaKindFromTagCode(activeTag);
          return (
            <GalleryCard
              key={`${record.title}-${idx}`}
              record={record}
              mediaKind={mediaKind}
              onClick={() => {
                const text = record.content?.trim() || record.title;
                onCardClick?.(text, mediaKind);
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
