/* ============================================
 * CanvasToolbar 画布左侧工具栏：节点创建、对话窗口与扩展工具菜单入口
 * ============================================ */
import { useEffect, useRef, useState } from 'react';
import {
  Hand,
  MousePointer2,
  Plus,
  ImagePlus,
  Video,
  Type,
  AudioLines,
  // 暂时隐藏AI音乐，图标导入同步注释
  // Music,
  Library,
  Upload,
  ShoppingBag,
  // 共享资产隐藏，图标导入同步注释
  // BarChart3,
  Palette,
  UserRound,
  Box,
  Mountain,
  SquarePlus,
  Download,
  type LucideIcon,
} from 'lucide-react';
import styles from './index.module.css';

type ToolMode = 'drag' | 'select';

/** 扩展工具菜单 key（audio 暂时隐藏：改为直开对话框，后续恢复时加回） */
export type ToolMenuKey = 'assets' | 'goods';

interface ToolMenuItem {
  key: string;
  label: string;
  icon: LucideIcon;
}

/** 扩展工具：资产库 / 商品，点击在工具栏旁弹出选择（音频改为直开对话框，AI 音乐暂时隐藏） */
const TOOL_MENUS: Record<ToolMenuKey, { title: string; icon: LucideIcon; items: ToolMenuItem[] }> = {
  // 暂时隐藏音频选择菜单（改为直开音频生成对话框），注释保留后续恢复
  // audio: {
  //   title: '音频',
  //   icon: AudioLines,
  //   items: [
  //     { key: 'generate', label: '音频生成', icon: AudioLines },
  //     // 暂时隐藏AI音乐
  //     // { key: 'music', label: 'AI 音乐', icon: Music },
  //   ],
  // },
  assets: {
    title: '资产库',
    icon: Library,
    items: [
      // 共享资产概念下线，隐藏入口，仅保留四种卡片
      // { key: 'shared', label: '共享资产', icon: BarChart3 },
      { key: 'style', label: '风格卡', icon: Palette },
      { key: 'character', label: '角色卡', icon: UserRound },
      { key: 'object', label: '物体卡', icon: Box },
      { key: 'environment', label: '环境卡', icon: Mountain },
    ],
  },
  goods: {
    title: '商品',
    icon: ShoppingBag,
    items: [
      { key: 'create', label: '新建商品', icon: SquarePlus },
      { key: 'import', label: '导入商品', icon: Download },
    ],
  },
};

interface CanvasToolbarProps {
  mode: ToolMode;
  onModeChange: (mode: ToolMode) => void;
  onUploadFile: (files: File[]) => void;
  /** 打开「资产库选择」弹窗（从已有资产中选取素材落画布） */
  onOpenAssetsPicker?: () => void;
  onToggleVideoDialog: () => void;
  onToggleImageDialog: () => void;
  onToggleAudioDialog: () => void;
  onAddTextNode: () => void;
  showVideoDialog: boolean;
  showImageDialog: boolean;
  showAudioDialog: boolean;
  /** 扩展工具菜单项选择（预留联调入口） */
  onMenuSelect?: (menu: ToolMenuKey, item: string) => void;
}

/** 加号上传菜单项 key */
type AddMenuItem = 'local' | 'assets';

export default function CanvasToolbar({
  mode,
  onModeChange,
  onUploadFile,
  onOpenAssetsPicker,
  onToggleVideoDialog,
  onToggleImageDialog,
  onToggleAudioDialog,
  onAddTextNode,
  showVideoDialog,
  showImageDialog,
  showAudioDialog,
  onMenuSelect,
}: CanvasToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [openMenu, setOpenMenu] = useState<ToolMenuKey | 'upload' | null>(null);

  /** 点击外部关闭弹出菜单 */
  useEffect(() => {
    if (!openMenu) return;
    const handleDocClick = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener('mousedown', handleDocClick);
    return () => document.removeEventListener('mousedown', handleDocClick);
  }, [openMenu]);

  /** 文件选择 */
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      onUploadFile(Array.from(files));
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  /** 扩展工具按钮：切换弹出菜单（含加号上传菜单） */
  const toggleMenu = (key: ToolMenuKey | 'upload') => {
    setOpenMenu((prev) => (prev === key ? null : key));
  };

  /** 加号上传菜单项点击：本地上传走隐藏 input，资产库选择交由父组件开弹窗 */
  const handleAddMenuItemClick = (item: AddMenuItem) => {
    setOpenMenu(null);
    if (item === 'local') {
      fileInputRef.current?.click();
    } else {
      onOpenAssetsPicker?.();
    }
  };

  /** 菜单项点击：回调后收起 */
  const handleItemClick = (menu: ToolMenuKey, item: string) => {
    setOpenMenu(null);
    onMenuSelect?.(menu, item);
  };

  /** 渲染扩展工具按钮 + 侧弹菜单 */
  const renderMenuTool = (key: ToolMenuKey) => {
    const def = TOOL_MENUS[key];
    const Icon = def.icon;
    return (
      <div className={styles.menuWrap} key={key}>
        <button
          className={`${styles.toolBtn} ${openMenu === key ? styles.toolBtnActive : ''}`}
          onClick={() => toggleMenu(key)}
          data-tooltip={def.title}
          aria-label={def.title}
        >
          <Icon size={20} strokeWidth={2} />
        </button>
        {openMenu === key && (
          <div className={styles.popup} onClick={(e) => e.stopPropagation()}>
            {def.items.map((it) => {
              const ItemIcon = it.icon;
              return (
                <button
                  key={it.key}
                  className={styles.popupItem}
                  onClick={() => handleItemClick(key, it.key)}
                >
                  <ItemIcon size={16} strokeWidth={2} />
                  <span>{it.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div ref={toolbarRef} className={styles.toolbar}>
      {/* 菜单打开时点击外部收起 */}
      {openMenu && <div className={styles.menuOverlay} onClick={() => setOpenMenu(null)} />}

      {/* 拖动/选择切换 */}
      <button
        className={`${styles.toolBtn} ${mode === 'drag' ? styles.toolBtnActive : ''}`}
        onClick={() => onModeChange(mode === 'drag' ? 'select' : 'drag')}
        data-tooltip={mode === 'drag' ? '切换为选择' : '切换为拖动'}
        aria-label={mode === 'drag' ? '切换为选择' : '切换为拖动'}
      >
        {mode === 'drag' ? (
          <Hand size={20} strokeWidth={2} />
        ) : (
          <MousePointer2 size={20} strokeWidth={2} />
        )}
      </button>

      {/* 加号上传：弹出「本地上传 / 资产库选择」两项菜单 */}
      <div className={styles.menuWrap}>
        <button
          className={`${styles.toolBtn} ${openMenu === 'upload' ? styles.toolBtnActive : ''}`}
          onClick={() => toggleMenu('upload')}
          data-tooltip="上传素材"
          aria-label="上传素材"
        >
          <Plus size={20} strokeWidth={2} />
        </button>
        {openMenu === 'upload' && (
          <div className={styles.popup} onClick={(e) => e.stopPropagation()}>
            <button className={styles.popupItem} onClick={() => handleAddMenuItemClick('local')}>
              <Upload size={16} strokeWidth={2} />
              <span>本地上传</span>
            </button>
            <button className={styles.popupItem} onClick={() => handleAddMenuItemClick('assets')}>
              <Library size={16} strokeWidth={2} />
              <span>从资产中选择</span>
            </button>
          </div>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,video/*"
        className={styles.hiddenInput}
        onChange={handleFileChange}
      />

      {/* 分隔线 */}
      <div className={styles.divider} />

      {/* 图片 */}
      <button
        className={`${styles.toolBtn} ${showImageDialog ? styles.toolBtnActive : ''}`}
        onClick={onToggleImageDialog}
        data-tooltip="图片"
        aria-label="图片"
      >
        <ImagePlus size={20} strokeWidth={2} />
      </button>

      {/* 视频 */}
      <button
        className={`${styles.toolBtn} ${showVideoDialog ? styles.toolBtnActive : ''}`}
        onClick={onToggleVideoDialog}
        data-tooltip="视频"
        aria-label="视频"
      >
        <Video size={20} strokeWidth={2} />
      </button>

      {/* 音频：直接打开音频生成底部对话框（AI 音乐暂时隐藏，不再弹选择菜单） */}
      <button
        className={`${styles.toolBtn} ${showAudioDialog ? styles.toolBtnActive : ''}`}
        onClick={onToggleAudioDialog}
        data-tooltip="音频"
        aria-label="音频"
      >
        <AudioLines size={20} strokeWidth={2} />
      </button>

      {/* 文本 */}
      <button className={styles.toolBtn} onClick={onAddTextNode} data-tooltip="添加文本" aria-label="添加文本">
        <Type size={20} strokeWidth={2} />
      </button>

      {/* 分隔线 */}
      <div className={styles.divider} />

      {/* 资产库（弹出：共享资产 / 风格卡 / 角色卡 / 物体卡 / 环境卡） */}
      {renderMenuTool('assets')}

      {/* 商品（弹出：新建商品 / 导入商品） */}
      {renderMenuTool('goods')}
    </div>
  );
}
