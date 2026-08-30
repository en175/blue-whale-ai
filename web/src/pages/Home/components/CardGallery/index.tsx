/* ============================================
 * CardGallery 首页作品卡片画廊：模板展示与复用
 * ============================================ */
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
} from '@/api/agent';
import {
  galleryCoverSrc,
  mediaKindFromTagCode,
  shouldShowVideoChrome,
  type GalleryMediaKind,
} from './galleryCardModel';

/** 图标映射：按 tag_code / label 对应现有图标，无匹配返回默认图标 */
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

/** 接口失败时的兜底标签（IKA64P：双栏） */
const FALLBACK_TAGS: TemplateTag[] = [
  { tag_code: 'video', label: '视频' },
  { tag_code: 'picture', label: '图片' },
];

/** layout 样式映射：wide 为当前默认卡片样式，social 为竖版卡片，其他布局后续扩展 */
const LAYOUT_CLASS: Record<string, string> = {
  wide: '',
  social: styles.cardSocial,
};

/** 截断文字：超过30字展示省略号 */
function truncate(text: string, max = 30) {
  return text.length > max ? text.slice(0, max) + '...' : text;
}

/** 单张画廊卡片：形态由 tagCode 决定；图片卡即使 images 为空也不走视频壳 */
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
              <img className={`${styles.stackImg} ${styles.stackLeft}`} src={first} alt="" loading="lazy" />
            )}
            {third && (
              <img className={`${styles.stackImg} ${styles.stackRight}`} src={third} alt="" loading="lazy" />
            )}
            <img className={`${styles.stackImg} ${styles.stackTop}`} src={cover} alt={record.title} loading="lazy" />
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
          src={record.video}
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
  /** IKA64P：初始空值，加载后取接口返回首个可见标签 */
  const [activeTag, setActiveTag] = useState('');
  const [records, setRecords] = useState<TemplateRecord[]>([]);

  // 加载画廊标签；失败保留兜底列表并落到兜底首标签（IKA64P 修复：避免空 activeTag 导致卡片永久空白）
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

  // 加载当前标签下的卡片列表（默认 page=1, size=50；IKA64P：标签未定时不发请求）
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
      {/* Tab 栏 */}
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

      {/* 卡片网格（IKA64P：图片栏 3+3 排布） */}
      <div className={`${styles.cardGrid} ${activeTag === 'picture' ? styles.cardGridThree : ''}`}>
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
