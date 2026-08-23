/* ============================================
 * SharedAssetsModal 共享资产弹框：真实 API 联调版
 * 列表：GET /api/shared-assets（双维过滤 + 分页）
 * 操作：添加回画布 / 删除 / 场景卡加入项目
 * ============================================ */
import { useMemo, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
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
import styles from './index.module.css';

/** Tab 定义（对齐现有画布卡片类型） */
const TABS: { key: string; label: string; assetType?: SharedAssetType; kind?: SharedAssetKind; icon: typeof ImageIcon }[] = [
  { key: 'image', label: '图片', assetType: 'media', kind: 'image', icon: ImageIcon },
  { key: 'video', label: '视频', assetType: 'media', kind: 'video', icon: Video },
  { key: 'audio', label: '音频', assetType: 'media', kind: 'audio', icon: AudioLines },
  { key: 'text', label: '文本', assetType: 'text', icon: Type },
  { key: 'goods', label: '商品', assetType: 'goods', icon: Box },
];

/** 资产子类型下拉（card 种类筛选） */
type CardKind = 'style' | 'character' | 'object' | 'environment';
const CARD_KINDS: CardKind[] = ['style', 'character', 'object', 'environment'];
const CARD_KIND_LABEL: Record<CardKind, string> = {
  style: '风格',
  character: '角色',
  object: '物体',
  environment: '环境',
};

/** 类型 → 图标 */
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

/** 类型 → 渐变封面（无缩略图时的占位） */
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

/** 完整列表项（含后端数据 + UI 状态） */
interface AssetListItem extends SharedAssetView {
  /** 是否正在删除 */
  deleting?: boolean;
}

/** Toast 回调类型 */
type ToastFn = (type: 'success' | 'error' | 'warn', msg: string) => void;

interface SharedAssetsModalProps {
  onClose: () => void;
  /** 当前项目 ID（场景卡 add-to-project 需要） */
  projectId: string;
  /** 添加资产到画布（由父组件实现具体节点构造） */
  onAddItem: (item: SharedAssetView) => Promise<boolean>;
  /** Toast 提示回调 */
  onToast: ToastFn;
}

/** 构建标题（从快照提取） */
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

/** 构建封面 URL */
function coverUrl(item: SharedAssetView): string | undefined {
  if (item.assetType === 'media') {
    // 仅图片类型可作 <img> 封面；视频/音频的 thumbnailUrl 是媒体文件本身，不能当图片渲染
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

/** 构建徽章文案 */
function badgeText(item: SharedAssetView): string {
  if (item.kind) {
    if (item.assetType === 'card') return CARD_KIND_LABEL[item.kind as CardKind] || item.kind;
    if (item.assetType === 'media') {
      if (item.kind === 'image') return '图片';
      if (item.kind === 'video') return '视频';
      if (item.kind === 'audio') return '音频';
    }
  }
  // 查找对应 tab label
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
}: SharedAssetsModalProps) {
  const [tab, setTab] = useState('image');
  /** 资产子类型筛选（'all' 表示不筛选 card 种类，使用主 Tab 过滤） */
  const [cardFilter, setCardFilter] = useState<CardKind | 'all'>('all');
  const [cardOpen, setCardOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [items, setItems] = useState<AssetListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [addItemId, setAddItemId] = useState<string | null>(null);
  /** 预览弹窗当前资产 */
  const [previewItem, setPreviewItem] = useState<AssetListItem | null>(null);

  /** 构建查询参数 */
  const buildQuery = useCallback((): SharedAssetListQuery => {
    const q: SharedAssetListQuery = { page: 1, size: 50 };
    if (cardFilter !== 'all') {
      // 资产子类型筛选：只查 card 类型 + 指定 kind
      q.assetType = 'card';
      q.kind = cardFilter;
    } else {
      // 主 Tab 筛选
      const tabDef = TABS.find((t) => t.key === tab);
      if (tabDef?.assetType) q.assetType = tabDef.assetType;
      if (tabDef?.kind) q.kind = tabDef.kind;
    }
    return q;
  }, [tab, cardFilter]);

  /** 加载列表 */
  const loadList = useCallback(async (reset = false) => {
    if (reset) setLoading(true);
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
      onToast('error', '加载共享资产失败');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [buildQuery, page, onToast]);

  /** tab 或筛选变化时重新加载 */
  useEffect(() => {
    setPage(1);
    loadList(true);
  }, [tab, cardFilter, loadList]);

  /** 搜索过滤（前端本地过滤） */
  const filteredItems = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return items;
    return items.filter((it) => {
      const title = titleFromAsset(it).toLowerCase();
      return title.includes(kw) || (it.name && it.name.toLowerCase().includes(kw));
    });
  }, [items, keyword]);

  /** 加载更多 */
  const handleLoadMore = () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    setPage((p) => {
      const next = p + 1;
      // 用 setTimeout 避免 state 闭包问题
      setTimeout(() => loadList(false), 0);
      return next;
    });
  };

  /** 删除共享资产 */
  const handleDelete = async (id: string) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, deleting: true } : it)));
    try {
      await removeSharedAsset(id);
      setItems((prev) => prev.filter((it) => it.id !== id));
      onToast('success', '已删除共享资产');
    } catch (e) {
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, deleting: false } : it)));
      if (isApiError(e)) onToast('error', e.message || '删除失败');
      else onToast('error', '删除失败');
    }
  };

  /** 添加到画布 */
  const handleAddToCanvas = async (item: AssetListItem) => {
    if (addItemId) return;
    // 场景卡需要走 add-to-project 接口
    if (item.assetType === 'scene') {
      if (!projectId) {
        onToast('error', '请先选择项目');
        return;
      }
      setAddItemId(item.id);
      try {
        const result = await addSceneToProject(item.id, projectId);
        // 成功后通知父组件创建 scene_card 节点
        onToast('success', `场景卡已添加（ID: ${result.sceneCardId}）`);
        onClose();
      } catch (e) {
        if (isApiError(e)) onToast('error', e.message || '添加失败');
        else onToast('error', '添加失败');
      } finally {
        setAddItemId(null);
      }
      return;
    }
    // 其他类型走统一 onAddItem
    setAddItemId(item.id);
    try {
      await onAddItem(item);
    } catch {
      onToast('error', '添加到画布失败');
    } finally {
      setAddItemId(null);
    }
  };

  /** 卡片点击：图片/卡片直接添加到画布，其他类型打开预览 */
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
      {/* ESC 守卫靠这两个属性识别弹层，见 ConfirmModal 里的说明（审查 W·A3）。 */}
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className={styles.head}>
          <div className={styles.headTitle}>
            <BarChart3 size={18} strokeWidth={2} />
            <span>共享资产</span>
          </div>
          <button className={styles.closeBtn} onClick={onClose} title="关闭">
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        {/* tabs + 搜索 */}
        <div className={styles.tabRow}>
          <div className={styles.tabs}>
            {/* 资产子类型下拉（独立筛选 card 种类，放在最前面） */}
            <button
              className={`${styles.tab} ${styles.tabActive}`}
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
                  className={`${styles.subOption} ${cardFilter === 'all' ? styles.subOptionActive : ''}`}
                  onClick={() => {
                    setCardFilter('all');
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

        {/* 资产网格 */}
        <div className={styles.gridWrap}>
          {loading ? (
            <div className={styles.empty}>
              <Loader2 size={22} className={styles.loadingIcon} />
              <span>加载中...</span>
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
                            src={cUrl}
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
                        {/* 删除按钮 */}
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
                        {/* 添加按钮 */}
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
              {/* 加载更多 */}
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
    {/* 预览弹窗 */}
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

/** 预览内容：按资产类型渲染 */
function PreviewContent({ item }: { item: SharedAssetView }) {
  switch (item.assetType) {
    case 'media': {
      const snap = item.snapshot as SharedAssetMediaSnapshot;
      if (item.kind === 'video') {
        return <video className={styles.previewMedia} src={snap.url} controls />;
      }
      if (item.kind === 'audio') {
        return (
          <div className={styles.previewAudioBox}>
            <AudioLines size={48} strokeWidth={1.5} className={styles.previewAudioIcon} />
            <p className={styles.previewAudioName}>{titleFromAsset(item)}</p>
            <audio className={styles.previewAudio} src={snap.url} controls />
          </div>
        );
      }
      return <img className={styles.previewMedia} src={snap.url} alt={titleFromAsset(item)} />;
    }
    case 'card': {
      const snap = item.snapshot as SharedAssetCardSnapshot;
      return (
        <div className={styles.previewCard}>
          {snap.referenceImages?.length > 0 && (
            <div className={styles.previewImgGrid}>
              {snap.referenceImages.map((img) => (
                <img key={img.id} className={styles.previewImgItem} src={img.src} alt="参考图" />
              ))}
            </div>
          )}
          {snap.description && <p className={styles.previewDesc}>{snap.description}</p>}
          {snap.voice && (
            <div className={styles.previewVoice}>
              <span className={styles.previewVoiceName}>音色：{snap.voice.name}</span>
              <audio className={styles.previewAudio} src={snap.voice.src} controls />
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
                <img key={img.id} className={styles.previewImgItem} src={img.src} alt={snap.name} />
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
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: snap.html }}
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
