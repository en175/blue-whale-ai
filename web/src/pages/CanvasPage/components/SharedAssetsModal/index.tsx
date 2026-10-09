




import { useMemo, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { markdownToSanitizedHtml, unifiedTextNodeText } from '@lib/contracts/text-node-markdown';
import {
  X,
  Search,
  Image as ImageIcon,
  Video,
  AudioLines,
  Type,
  Box,
  BarChart3,
  ChevronDown,
  Plus,
  Trash2,
  ExternalLink,
  Loader2,
  Inbox,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import {
  fetchSharedAssetList,
  removeSharedAsset,
  addSceneToProject,
  type SharedAssetView,
  type SharedAssetType,
  type SharedAssetKind,
  type SharedAssetListQuery,
  type SharedAssetMediaSnapshot,
  type SharedAssetCardSnapshot,
  type SharedAssetGoodsSnapshot,
  type SharedAssetTextSnapshot,
  type SharedAssetSceneSnapshot,
} from '@/api/sharedAssets';
import { isApiError } from '@/api/http';
import { remoteImageCrossOrigin, resolveMediaSrc } from '@/utils/remoteImageCors';
import styles from './index.module.css';


const TABS: { key: string; label: string; assetType?: SharedAssetType; kind?: SharedAssetKind; icon: typeof ImageIcon }[] = [
  { key: 'image', label: '图片', assetType: 'media', kind: 'image', icon: ImageIcon },
  { key: 'video', label: '视频', assetType: 'media', kind: 'video', icon: Video },
  { key: 'audio', label: '音频', assetType: 'media', kind: 'audio', icon: AudioLines },
  { key: 'text', label: '文本', assetType: 'text', icon: Type },
  { key: 'goods', label: '商品', assetType: 'goods', icon: Box },
];


type CardKind = 'style' | 'character' | 'object' | 'environment';
type CardFilter = 'all' | 'all-assets' | CardKind;
const CARD_KINDS: CardKind[] = ['style', 'character', 'object', 'environment'];
const CARD_KIND_LABEL: Record<CardKind, string> = {
  style: '风格',
  character: '角色',
  object: '物体',
  environment: '环境',
};


const TYPE_ICON: Record<string, typeof ImageIcon> = {
  card: ImageIcon,
  media: ImageIcon,
  goods: Box,
  scene: BarChart3,
  text: Type,
  image: ImageIcon,
  video: Video,
  audio: AudioLines,
};


const TYPE_GRADIENT: Record<string, { from: string; to: string }> = {
  card: { from: '#5b2a86', to: '#8e2f66' },
  media: { from: '#31307a', to: '#6b2f8e' },
  goods: { from: '#7a4a1f', to: '#5a5a1e' },
  scene: { from: '#1f4a5a', to: '#1e5a3a' },
  text: { from: '#4a3a5a', to: '#3a4a6a' },
  image: { from: '#31307a', to: '#6b2f8e' },
  video: { from: '#3a1f5a', to: '#5a2f8e' },
  audio: { from: '#1f3a5a', to: '#2f5a6b' },
};


interface AssetListItem extends SharedAssetView {

  deleting?: boolean;
}


type ToastFn = (type: 'success' | 'error' | 'warn', msg: string) => void;

interface SharedAssetsModalProps {
  onClose: () => void;

  projectId: string;

  onAddItem: (item: SharedAssetView) => Promise<boolean>;

  onToast: ToastFn;

  defaultTab?: string;

  defaultCardFilter?: CardFilter;
}


function titleFromAsset(item: SharedAssetView): string {
  if (item.name) return item.name;
  switch (item.assetType) {
    case 'card': {
      const snap = item.snapshot as { description?: string };
      return snap.description || '卡片';
    }
    case 'media': {
      const snap = item.snapshot as { url: string };
      try {
        const seg = decodeURIComponent(snap.url.split('/').filter(Boolean).pop() ?? '');
        return seg || '媒体';
      } catch {
        return '媒体';
      }
    }
    case 'goods': {
      const snap = item.snapshot as { name: string };
      return snap.name || '商品';
    }
    case 'text':
      return '文本';
    case 'scene': {
      const snap = item.snapshot as { title: string };
      return snap.title || '场景卡';
    }
    default:
      return '共享资产';
  }
}


function coverUrl(item: SharedAssetView): string | undefined {
  if (item.assetType === 'media') {

    if (item.kind !== 'image') return undefined;
    const snap = item.snapshot as { url: string };
    return item.thumbnailUrl ?? snap.url;
  }
  if (item.thumbnailUrl) return item.thumbnailUrl;
  if (item.assetType === 'card') {
    const snap = item.snapshot as { referenceImages?: Array<{ src: string }> };
    return snap.referenceImages?.[0]?.src;
  }
  if (item.assetType === 'goods') {
    const snap = item.snapshot as { images?: Array<{ src: string; enabled?: boolean }> };
    return snap.images?.find((img) => img.enabled !== false)?.src || snap.images?.[0]?.src;
  }
  return undefined;
}


function badgeText(item: SharedAssetView): string {
  if (item.kind) {
    if (item.assetType === 'card') return CARD_KIND_LABEL[item.kind as CardKind] || item.kind;
    if (item.assetType === 'media') {
      if (item.kind === 'image') return '图片';
      if (item.kind === 'video') return '视频';
      if (item.kind === 'audio') return '音频';
    }
  }

  const tabKey = item.assetType === 'media'
    ? (item.kind === 'video' ? 'video' : item.kind === 'audio' ? 'audio' : 'image')
    : item.assetType === 'text' ? 'text'
    : item.assetType === 'goods' ? 'goods'
    : '';
  return TABS.find((t) => t.key === tabKey)?.label ?? item.assetType;
}

export default function SharedAssetsModal({
  onClose,
  projectId,
  onAddItem,
  onToast,
  defaultTab,
  defaultCardFilter,
}: SharedAssetsModalProps) {
  const [tab, setTab] = useState(defaultTab ?? 'image');

  const [cardFilter, setCardFilter] = useState<CardFilter>(defaultCardFilter ?? 'all');
  const [cardOpen, setCardOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [items, setItems] = useState<AssetListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [addItemId, setAddItemId] = useState<string | null>(null);

  const [previewItem, setPreviewItem] = useState<AssetListItem | null>(null);


  const buildQuery = useCallback((): SharedAssetListQuery => {
    const q: SharedAssetListQuery = { page: 1, size: 50 };
    if (cardFilter === 'all-assets') {

    } else if (cardFilter !== 'all') {

      q.assetType = 'card';
      q.kind = cardFilter;
    } else {

      const tabDef = TABS.find((t) => t.key === tab);
      if (tabDef?.assetType) q.assetType = tabDef.assetType;
      if (tabDef?.kind) q.kind = tabDef.kind;
    }
    return q;
  }, [tab, cardFilter]);


  const loadList = useCallback(async (reset = false) => {
    if (reset) {
      setLoading(true);
      setLoadError(false);
    }
    try {
      const q = buildQuery();
      q.page = reset ? 1 : page;
      const data = await fetchSharedAssetList(q);
      if (reset) {
        setItems(data.records as AssetListItem[]);
        setTotal(data.total);
      } else {
        setItems((prev) => [...prev, ...(data.records as AssetListItem[])]);
        setTotal(data.total);
      }
      setHasMore(data.current * data.size < data.total);
    } catch {
      if (reset) {

        setLoadError(true);
      } else {

        onToast('error', '加载共享资产失败');
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [buildQuery, page, onToast]);


  useEffect(() => {
    setPage(1);
    loadList(true);
  }, [tab, cardFilter, loadList]);


  const filteredItems = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return items;
    return items.filter((it) => {
      const title = titleFromAsset(it).toLowerCase();
      return title.includes(kw) || (it.name && it.name.toLowerCase().includes(kw));
    });
  }, [items, keyword]);


  const handleLoadMore = () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    setPage((p) => {
      const next = p + 1;

      setTimeout(() => loadList(false), 0);
      return next;
    });
  };


  const handleDelete = async (id: string) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, deleting: true } : it)));
    try {
      await removeSharedAsset(id);
      setItems((prev) => prev.filter((it) => it.id !== id));
      onToast('success', '已删除共享资产');
    } catch (e) {
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, deleting: false } : it)));
      if (!isApiError(e)) onToast('error', '删除失败');
    }
  };


  const handleAddToCanvas = async (item: AssetListItem) => {
    if (addItemId) return;

    if (item.assetType === 'scene') {
      if (!projectId) {
        onToast('error', '请先选择项目');
        return;
      }
      setAddItemId(item.id);
      try {
        const result = await addSceneToProject(item.id, projectId);

        onToast('success', `场景卡已添加（ID: ${result.sceneCardId}）`);
        onClose();
      } catch (e) {
        if (!isApiError(e)) onToast('error', '添加失败');
      } finally {
        setAddItemId(null);
      }
      return;
    }

    setAddItemId(item.id);
    try {
      await onAddItem(item);
    } catch {
      onToast('error', '添加到画布失败');
    } finally {
      setAddItemId(null);
    }
  };


  const handleCardClick = (item: AssetListItem) => {
    if (item.deleting || addItemId) return;
    const directAdd =
      (item.assetType === 'media' && item.kind === 'image') || item.assetType === 'card';
    if (directAdd) {
      handleAddToCanvas(item);
      return;
    }
    setPreviewItem(item);
  };

  return createPortal(
    <>
    <div className={styles.overlay} onClick={onClose}>
      { }
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        { }
        <div className={styles.head}>
          <div className={styles.headTitle}>
            <BarChart3 size={18} strokeWidth={2} />
            <span>共享资产</span>
          </div>
          <button className={styles.closeBtn} onClick={onClose} title="关闭">
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        { }
        <div className={styles.tabRow}>
          <div className={styles.tabs}>
            { }
            <button
              className={`${styles.tab} ${cardFilter !== 'all' ? styles.tabActive : ''}`}
              onClick={() => setCardOpen((v) => !v)}
            >
              <ImageIcon size={14} strokeWidth={2} />
              <span>资产</span>
              <ChevronDown
                size={12}
                strokeWidth={2}
                className={`${styles.tabArrow} ${cardOpen ? styles.tabArrowUp : ''}`}
              />
            </button>
            {cardOpen && (
              <div className={styles.subDropdown}>
                <button
                  className={`${styles.subOption} ${cardFilter === 'all-assets' ? styles.subOptionActive : ''}`}
                  onClick={() => {
                    setCardFilter('all-assets');
                    setCardOpen(false);
                  }}
                >
                  全部资产
                </button>
                {CARD_KINDS.map((s) => (
                  <button
                    key={s}
                    className={`${styles.subOption} ${cardFilter === s ? styles.subOptionActive : ''}`}
                    onClick={() => {
                      setCardFilter(s);
                      setCardOpen(false);
                    }}
                  >
                    {CARD_KIND_LABEL[s]}
                  </button>
                ))}
              </div>
            )}
            {TABS.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.key}
                  className={`${styles.tab} ${tab === t.key && cardFilter === 'all' ? styles.tabActive : ''}`}
                  onClick={() => {
                    setTab(t.key);
                    setCardFilter('all');
                    setCardOpen(false);
                  }}
                >
                  <Icon size={14} strokeWidth={2} />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>

          <div className={styles.tabRight}>
            <div className={styles.searchBox}>
              <Search size={14} strokeWidth={2} />
              <input
                className={styles.searchInput}
                placeholder="搜索资产"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
            </div>
          </div>
        </div>

        { }
        <div className={styles.gridWrap}>
          {loading ? (
            <div className={styles.empty}>
              <Loader2 size={22} className={styles.loadingIcon} />
              <span>加载中...</span>
            </div>
          ) : loadError ? (
            <div className={`${styles.empty} ${styles.loadError}`}>
              <div className={styles.emptyIconBox}>
                <AlertCircle size={32} strokeWidth={1.5} />
              </div>
              <p className={styles.emptyTitle}>加载失败</p>
              <p className={styles.emptyHint}>网络异常或服务暂时不可用</p>
              <button className={styles.retryBtn} onClick={() => loadList(true)}>
                <RefreshCw size={14} strokeWidth={2} />
                <span>重新加载</span>
              </button>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className={styles.empty}>
              <div className={styles.emptyIconBox}>
                <Inbox size={28} strokeWidth={1.5} />
              </div>
              <p className={styles.emptyTitle}>
                {keyword.trim() ? '未找到匹配的资产' : '暂无共享资产'}
              </p>
              <p className={styles.emptyHint}>
                {keyword.trim()
                  ? '换个关键词试试'
                  : '在画布中右键节点，选择「保存到共享资产」即可添加'}
              </p>
            </div>
          ) : (
            <>
              <div className={styles.grid}>
                {filteredItems.map((item) => {
                  const lookupKey = item.assetType === 'media' ? (item.kind ?? 'media') : item.assetType;
                  const Icon = TYPE_ICON[lookupKey] || TYPE_ICON[item.assetType] || ImageIcon;
                  const cUrl = coverUrl(item);
                  const gradient = TYPE_GRADIENT[lookupKey] || TYPE_GRADIENT[item.assetType] || TYPE_GRADIENT.card;
                  const isAdding = addItemId === item.id;
                  return (
                    <div
                      key={item.id}
                      className={`${styles.card} ${isAdding ? styles.cardSelected : ''}`}
                      onClick={() => handleCardClick(item)}
                    >
                      <div className={styles.thumbBox}>
                        {item.assetType === 'media' && item.kind === 'video' ? (
                          <>
                            <video
                              className={styles.coverImg}
                              src={`${(item.snapshot as SharedAssetMediaSnapshot).url}#t=0.1`}
                              preload="metadata"
                              muted
                              playsInline
                            />
                            <div className={styles.videoOverlay}>
                              <Video size={28} strokeWidth={1.5} />
                            </div>
                          </>
                        ) : cUrl ? (
                          <img
                            className={styles.coverImg}
                            src={resolveMediaSrc(cUrl)}
                            crossOrigin={remoteImageCrossOrigin(cUrl)}
                            alt={titleFromAsset(item)}
                            loading="lazy"
                          />
                        ) : (
                          <div
                            className={styles.cover}
                            style={{ background: `linear-gradient(135deg, ${gradient.from}, ${gradient.to})` }}
                          >
                            <Icon size={36} strokeWidth={1.5} className={styles.coverIcon} />
                            <span>{titleFromAsset(item)}</span>
                          </div>
                        )}
                      </div>
                      <div className={styles.cardTitle}>{titleFromAsset(item)}</div>
                      <div className={styles.cardMeta}>
                        <span className={styles.badge}>{badgeText(item)}</span>
                        <span className={styles.date}>{(item.createdAt || '').slice(0, 10)}</span>
                        { }
                        <button
                          className={styles.moreBtn}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (item.deleting) return;
                            handleDelete(item.id);
                          }}
                          title="删除"
                        >
                          {item.deleting ? (
                            <Loader2 size={12} strokeWidth={2} className={styles.loadingIcon} />
                          ) : (
                            <Trash2 size={12} strokeWidth={2} />
                          )}
                        </button>
                        { }
                        <button
                          className={styles.moreBtn}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isAdding) return;
                            handleAddToCanvas(item);
                          }}
                          title={isAdding ? '添加中...' : '添加到画布'}
                        >
                          {isAdding ? (
                            <Loader2 size={12} strokeWidth={2} className={styles.loadingIcon} />
                          ) : (
                            <Plus size={12} strokeWidth={2} />
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              { }
              {hasMore && (
                <div className={styles.loadMore}>
                  <button
                    className={styles.loadMoreBtn}
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                  >
                    {loadingMore ? <Loader2 size={14} /> : <ExternalLink size={14} />}
                    <span>加载更多</span>
                  </button>
                </div>
              )}
              {total > 0 && !loading && (
                <div className={styles.totalHint}>共 {total} 项</div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
    { }
    {previewItem && (
      <div className={styles.previewOverlay} onClick={() => setPreviewItem(null)}>
        <div className={styles.previewPanel} onClick={(e) => e.stopPropagation()}>
          <div className={styles.previewHead}>
            <div className={styles.previewTitle}>
              <span>{titleFromAsset(previewItem)}</span>
              <span className={styles.badge}>{badgeText(previewItem)}</span>
            </div>
            <div className={styles.previewActions}>
              <button
                className={styles.addBtn}
                onClick={() => {
                  const it = previewItem;
                  setPreviewItem(null);
                  handleAddToCanvas(it);
                }}
              >
                <Plus size={14} strokeWidth={2} />
                <span>添加到画布</span>
              </button>
              <button className={styles.closeBtn} onClick={() => setPreviewItem(null)} title="关闭">
                <X size={16} strokeWidth={2} />
              </button>
            </div>
          </div>
          <div className={styles.previewBody}>
            <PreviewContent item={previewItem} />
          </div>
        </div>
      </div>
    )}
    </>,
    document.body,
  );
}


function PreviewContent({ item }: { item: SharedAssetView }) {
  switch (item.assetType) {
    case 'media': {
      const snap = item.snapshot as SharedAssetMediaSnapshot;
      if (item.kind === 'video') {
        return <video className={styles.previewMedia} src={resolveMediaSrc(snap.url)} controls />;
      }
      if (item.kind === 'audio') {
        return (
          <div className={styles.previewAudioBox}>
            <AudioLines size={48} strokeWidth={1.5} className={styles.previewAudioIcon} />
            <p className={styles.previewAudioName}>{titleFromAsset(item)}</p>
            <audio className={styles.previewAudio} src={resolveMediaSrc(snap.url)} crossOrigin={remoteImageCrossOrigin(snap.url)} controls />
          </div>
        );
      }
      return <img className={styles.previewMedia} src={resolveMediaSrc(snap.url)} crossOrigin={remoteImageCrossOrigin(snap.url)} alt={titleFromAsset(item)} />;
    }
    case 'card': {
      const snap = item.snapshot as SharedAssetCardSnapshot;
      return (
        <div className={styles.previewCard}>
          {snap.referenceImages?.length > 0 && (
            <div className={styles.previewImgGrid}>
              {snap.referenceImages.map((img) => (
                <img key={img.id} className={styles.previewImgItem} src={resolveMediaSrc(img.src)} crossOrigin={remoteImageCrossOrigin(img.src)} alt="参考图" />
              ))}
            </div>
          )}
          {snap.description && <p className={styles.previewDesc}>{snap.description}</p>}
          {snap.voice && (
            <div className={styles.previewVoice}>
              <span className={styles.previewVoiceName}>音色：{snap.voice.name}</span>
              <audio className={styles.previewAudio} src={resolveMediaSrc(snap.voice.src)} crossOrigin={remoteImageCrossOrigin(snap.voice.src)} controls />
            </div>
          )}
        </div>
      );
    }
    case 'goods': {
      const snap = item.snapshot as SharedAssetGoodsSnapshot;
      return (
        <div className={styles.previewCard}>
          <h3 className={styles.previewGoodsName}>{snap.name}</h3>
          {snap.images?.length > 0 && (
            <div className={styles.previewImgGrid}>
              {snap.images.map((img) => (
                <img key={img.id} className={styles.previewImgItem} src={resolveMediaSrc(img.src)} crossOrigin={remoteImageCrossOrigin(img.src)} alt={snap.name} />
              ))}
            </div>
          )}
          {snap.detail && <p className={styles.previewDesc}>{snap.detail}</p>}
        </div>
      );
    }
    case 'text': {
      const snap = item.snapshot as SharedAssetTextSnapshot;
      return (
        <div
          className={styles.previewText}

          dangerouslySetInnerHTML={{ __html: markdownToSanitizedHtml(unifiedTextNodeText(snap)) }}
        />
      );
    }
    case 'scene': {
      const snap = item.snapshot as SharedAssetSceneSnapshot;
      return (
        <div className={styles.previewCard}>
          <h3 className={styles.previewGoodsName}>{snap.title}</h3>
          {snap.summary && <p className={styles.previewDesc}>{snap.summary}</p>}
          <pre className={styles.previewText}>{snap.contentMarkdown}</pre>
        </div>
      );
    }
    default:
      return null;
  }
}
