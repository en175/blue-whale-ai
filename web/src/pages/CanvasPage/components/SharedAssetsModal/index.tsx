/* ============================================
 * SharedAssetsModal 共享资产弹框：tab 切换筛选 + 搜索 + 选择模式；
 * 选中商品弹出详情弹窗，可添加到画布（生成商品节点）
 * ============================================ */
import { useMemo, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Search,
  MoreHorizontal,
  Image as ImageIcon,
  Video,
  AudioLines,
  Type,
  Box,
  BarChart3,
  ChevronDown,
  Plus,
  AtSign,
} from 'lucide-react';
import { fetchAllAssets, type AssetRecord } from '@/api/assets';
import styles from './index.module.css';

/** 商品资产（添加到画布的数据） */
export interface SharedProduct {
  id: string;
  title: string;
  /** 一句话描述 */
  desc: string;
  /** 商品详情初始文本 */
  detail: string;
}

/** 资产子类型（资产 tab 下拉筛选） */
type AssetSub = 'style' | 'character' | 'object' | 'environment';

const SUB_LABEL: Record<AssetSub, string> = {
  style: '风格',
  character: '角色',
  object: '物体',
  environment: '环境',
};

/** 资产条目类型 */
type AssetType = 'asset' | 'image' | 'video' | 'audio' | 'text' | 'goods';

interface AssetItem {
  id: string;
  type: AssetType;
  sub?: AssetSub;
  title: string;
  date: string;
  /** 封面渐变（无封面时显示占位图标） */
  cover?: { text: string; from: string; to: string };
  /** 真实图片封面 URL（接口资产） */
  coverUrl?: string;
  /** 接口资产ID（复制到项目时使用） */
  realId?: number;
  product?: SharedProduct;
}

/** mock 数据（待资产接口联调替换） */
const ASSET_ITEMS: AssetItem[] = [
  { id: 'a1', type: 'asset', sub: 'style', title: '赛博朋克霓虹', date: '2026-07-30', cover: { text: '风格 · 赛博朋克', from: '#5b2a86', to: '#8e2f66' } },
  { id: 'a2', type: 'asset', sub: 'style', title: '水彩手绘', date: '2026-07-28' },
  { id: 'a3', type: 'asset', sub: 'character', title: 'Apollo', date: '2026-07-30', cover: { text: '角色 · Apollo', from: '#6b6b1f', to: '#3f5a1e' } },
  { id: 'a4', type: 'asset', sub: 'character', title: '旁白老者', date: '2026-07-25' },
  { id: 'a5', type: 'asset', sub: 'object', title: '复古相机', date: '2026-07-22', cover: { text: '物体 · 相机', from: '#6b6b1f', to: '#4a5a1e' } },
  { id: 'a6', type: 'asset', sub: 'environment', title: '山顶日出', date: '2026-07-20', cover: { text: '环境 · 日出', from: '#7a4a1f', to: '#5a5a1e' } },
  { id: 'a7', type: 'asset', sub: 'environment', title: '地下实验室', date: '2026-07-18' },
  { id: 'i1', type: 'image', title: '商品主图 A', date: '2026-07-29' },
  { id: 'i2', type: 'image', title: '赛博朋克街景', date: '2026-07-26', cover: { text: '图片 · 街景', from: '#31307a', to: '#6b2f8e' } },
  { id: 'v1', type: 'video', title: '产品宣传片 15s', date: '2026-07-27' },
  { id: 'au1', type: 'audio', title: '品牌音效 jingle', date: '2026-07-24' },
  { id: 't1', type: 'text', title: '直播带货话术', date: '2026-07-23' },
  {
    id: 'g1',
    type: 'goods',
    title: '露营氛围灯',
    date: '2026-07-19',
    product: {
      id: 'g1',
      title: '露营氛围灯',
      desc: '暖光多档调光露营灯',
      detail: '品类:露营灯\n核心参数:1200lm·Type-C 充电',
    },
  },
  {
    id: 'g2',
    type: 'goods',
    title: '便携榨汁杯',
    date: '2026-07-17',
    product: {
      id: 'g2',
      title: '便携榨汁杯',
      desc: '350ml 随身榨汁杯',
      detail: '品类:榨汁杯\n核心参数:350ml·15000 转/分',
    },
  },
];

const TABS: { key: string; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'asset', label: '资产' },
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
  { key: 'audio', label: '音频' },
  { key: 'text', label: '文本' },
  { key: 'goods', label: '商品' },
];

/** 类型 → 占位图标（无封面时） */
const TYPE_ICON: Record<AssetType, typeof ImageIcon> = {
  asset: ImageIcon,
  image: ImageIcon,
  video: Video,
  audio: AudioLines,
  text: Type,
  goods: Box,
};

/** 类型 → 徽章文案 */
const typeBadge = (it: AssetItem) => (it.type === 'asset' && it.sub ? SUB_LABEL[it.sub] : TABS.find((t) => t.key === it.type)?.label ?? it.type);

/** 接口资产 URL → 卡片标题（取末段文件名，失败回退类型名） */
function titleFromUrl(url: string, fallback: string): string {
  try {
    const seg = decodeURIComponent(url.split('/').filter(Boolean).pop() ?? '');
    if (seg) return seg;
  } catch {
    /* URL 异常时回退 */
  }
  return fallback;
}

/** 接口资产记录 → 卡片条目 */
function toAssetItem(r: AssetRecord): AssetItem {
  const label = r.type === 'image' ? '图片' : r.type === 'video' ? '视频' : '音频';
  return {
    id: `real-${r.id}`,
    type: r.type,
    title: titleFromUrl(r.url, `${label} ${String(r.id).slice(-4)}`),
    date: (r.created_at || '').slice(0, 10),
    coverUrl: r.type === 'image' ? r.url : undefined,
    realId: typeof r.id === 'number' ? r.id : Number(r.id) || undefined,
  };
}

interface SharedAssetsModalProps {
  onClose: () => void;
  /** 添加到画布（生成商品节点） */
  onAddProduct: (product: SharedProduct) => void;
  /** 真实资产添加到项目（复制到当前项目并上画布），返回 Promise 供卡片反馈 */
  onAddAsset?: (assetId: number) => Promise<boolean> | void;
}

export default function SharedAssetsModal({ onClose, onAddProduct, onAddAsset }: SharedAssetsModalProps) {
  const [tab, setTab] = useState('asset');
  const [subFilter, setSubFilter] = useState<AssetSub | 'all'>('all');
  const [subOpen, setSubOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<AssetItem | null>(null);
  const [realItems, setRealItems] = useState<AssetItem[]>([]);
  const [loading, setLoading] = useState(true);
  /** 复制中的资产卡片 id（防重复点击） */
  const [copyingId, setCopyingId] = useState<string | null>(null);

  // 拉取真实资产（图片/视频/音频），失败静默回退 mock
  useEffect(() => {
    let alive = true;
    fetchAllAssets('')
      .then((list) => {
        if (alive) setRealItems(list.map(toAssetItem));
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  /** tab + 子类型 + 搜索 过滤（真实资产 + mock 合并） */
  const items = useMemo(() => {
    const kw = keyword.trim();
    const all = [...realItems, ...ASSET_ITEMS];
    return all.filter((it) => {
      if (tab === 'asset') {
        if (it.type !== 'asset') return false;
        if (subFilter !== 'all' && it.sub !== subFilter) return false;
      } else if (tab !== 'all' && it.type !== tab) {
        return false;
      }
      if (kw && !it.title.includes(kw)) return false;
      return true;
    });
  }, [tab, subFilter, keyword, realItems]);

  /** 卡片点击：选择模式→勾选；商品→详情弹窗；真实资产→复制到项目 */
  const handleCardClick = (it: AssetItem) => {
    if (selectMode) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(it.id)) next.delete(it.id);
        else next.add(it.id);
        return next;
      });
      return;
    }
    if (it.type === 'goods' && it.product) {
      setPicked(it);
      return;
    }
    // 真实资产：复制到当前项目（失败保留弹框，成功后关闭）
    if (it.realId !== undefined && onAddAsset && copyingId === null) {
      setCopyingId(it.id);
      Promise.resolve(onAddAsset(it.realId))
        .then((ok) => {
          if (ok) onClose();
        })
        .finally(() => setCopyingId(null));
    }
  };

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
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
            {TABS.map((t) => (
              <button
                key={t.key}
                className={`${styles.tab} ${tab === t.key ? styles.tabActive : ''}`}
                onClick={() => {
                  setTab(t.key);
                  setSubOpen(false);
                }}
              >
                <span>{t.label}</span>
                {t.key === 'asset' && tab === 'asset' && (
                  <ChevronDown
                    size={12}
                    strokeWidth={2}
                    className={`${styles.tabArrow} ${subOpen ? styles.tabArrowUp : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSubOpen((v) => !v);
                    }}
                  />
                )}
              </button>
            ))}
            {/* 资产子类型下拉 */}
            {tab === 'asset' && subOpen && (
              <div className={styles.subDropdown}>
                <button
                  className={`${styles.subOption} ${subFilter === 'all' ? styles.subOptionActive : ''}`}
                  onClick={() => {
                    setSubFilter('all');
                    setSubOpen(false);
                  }}
                >
                  全部资产
                </button>
                {(Object.keys(SUB_LABEL) as AssetSub[]).map((s) => (
                  <button
                    key={s}
                    className={`${styles.subOption} ${subFilter === s ? styles.subOptionActive : ''}`}
                    onClick={() => {
                      setSubFilter(s);
                      setSubOpen(false);
                    }}
                  >
                    {SUB_LABEL[s]}
                  </button>
                ))}
              </div>
            )}
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
            <button
              className={`${styles.selectBtn} ${selectMode ? styles.selectBtnActive : ''}`}
              onClick={() => {
                setSelectMode((v) => !v);
                setSelected(new Set());
              }}
            >
              选择
            </button>
          </div>
        </div>

        {/* 资产网格 */}
        <div className={styles.gridWrap}>
          {loading && realItems.length === 0 ? (
            <div className={styles.empty}>加载中...</div>
          ) : items.length === 0 ? (
            <div className={styles.empty}>无匹配资产</div>
          ) : (
            <div className={styles.grid}>
              {items.map((it) => {
                const Icon = TYPE_ICON[it.type];
                return (
                  <div
                    key={it.id}
                    className={`${styles.card} ${selected.has(it.id) ? styles.cardSelected : ''}`}
                    onClick={() => handleCardClick(it)}
                  >
                    <div className={styles.thumbBox}>
                      {it.coverUrl ? (
                        <img className={styles.coverImg} src={it.coverUrl} alt={it.title} loading="lazy" />
                      ) : it.cover ? (
                        <div
                          className={styles.cover}
                          style={{ background: `linear-gradient(135deg, ${it.cover.from}, ${it.cover.to})` }}
                        >
                          <span>{it.cover.text}</span>
                        </div>
                      ) : (
                        <Icon size={22} strokeWidth={1.5} className={styles.thumbIcon} />
                      )}
                    </div>
                    <div className={styles.cardTitle}>{it.title}</div>
                    <div className={styles.cardMeta}>
                      <span className={styles.badge}>{typeBadge(it)}</span>
                      <span className={styles.date}>{it.date}</span>
                      <button
                        className={styles.moreBtn}
                        onClick={(e) => e.stopPropagation()}
                        title="更多"
                      >
                        <MoreHorizontal size={14} strokeWidth={2} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 商品详情弹窗 */}
      {picked?.product && (
        <ProductPickModal
          product={picked.product}
          onClose={() => setPicked(null)}
          onAdd={() => {
            const p = picked.product;
            setPicked(null);
            if (p) onAddProduct(p);
          }}
        />
      )}
    </div>,
    document.body,
  );
}

/* ============ 商品选择弹窗（添加到画布） ============ */
function ProductPickModal({
  product,
  onClose,
  onAdd,
}: {
  product: SharedProduct;
  onClose: () => void;
  onAdd: () => void;
}) {
  return (
    <div className={styles.pickOverlay} onClick={onClose}>
      <div className={styles.pickPanel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.pickHead}>
          <div className={styles.pickTitle}>
            <Box size={16} strokeWidth={2} />
            <span>商品</span>
          </div>
          <button className={styles.closeBtn} onClick={onClose} title="关闭">
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        <div className={styles.pickCard}>
          <div className={styles.pickNameRow}>
            <span className={styles.pickAt}>
              <AtSign size={14} strokeWidth={2} />
            </span>
            <span className={styles.pickName}>{product.title}</span>
          </div>
          <div className={styles.pickDesc}>{product.desc}</div>
        </div>

        <div className={styles.pickFoot}>
          <button className={styles.addBtn} onClick={onAdd}>
            <Plus size={14} strokeWidth={2} />
            <span>添加到画布</span>
          </button>
        </div>
      </div>
    </div>
  );
}
