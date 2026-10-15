import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Hand,
  MousePointer2,
  Plus,
  ImagePlus,
  Video,
  Type,
  AudioLines,
  Library,
  Upload,
  ShoppingBag,
  Palette,
  UserRound,
  Box,
  Mountain,
  SquarePlus,
  Download,
  type LucideIcon,
} from 'lucide-react';
import styles from './index.module.css';
import { lockChromeSelection, registerCanvasChrome } from '../Canvas/chromeHitGuard';

type ToolMode = 'drag' | 'select';

export type ToolMenuKey = 'assets' | 'goods';

interface ToolMenuItem {
  key: string;
  label: string;
  icon: LucideIcon;
}

const TOOL_MENUS: Record<ToolMenuKey, { title: string; icon: LucideIcon; items: ToolMenuItem[] }> = {
  assets: {
    title: '资产库',
    icon: Library,
    items: [
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
  onOpenAssetsPicker?: () => void;
  onToggleVideoDialog: () => void;
  onToggleImageDialog: () => void;
  onToggleAudioDialog: () => void;
  onAddTextNode: () => void;
  showVideoDialog: boolean;
  showImageDialog: boolean;
  showAudioDialog: boolean;
  onMenuSelect?: (menu: ToolMenuKey, item: string) => void;
}

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
  const [stageAnchor, setStageAnchor] = useState({ left: 16, top: typeof window === 'undefined' ? 0 : window.innerHeight / 2 });

  useEffect(() => registerCanvasChrome(toolbarRef.current), []);

  useLayoutEffect(() => {
    const update = () => {
      const stage = document.querySelector('[data-canvas-stage]');
      if (!(stage instanceof HTMLElement)) return;
      const rect = stage.getBoundingClientRect();
      const pad = Number.parseFloat(getComputedStyle(stage).getPropertyValue('--spacing-lg')) || 16;
      setStageAnchor({ left: rect.left + pad, top: rect.top + rect.height / 2 });
    };
    update();
    const stage = document.querySelector('[data-canvas-stage]');
    const observer = stage ? new ResizeObserver(update) : null;
    if (stage) observer?.observe(stage);
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      onUploadFile(Array.from(files));
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const toggleMenu = (key: ToolMenuKey | 'upload') => {
    setOpenMenu((prev) => (prev === key ? null : key));
  };

  const handleAddMenuItemClick = (item: AddMenuItem) => {
    setOpenMenu(null);
    if (item === 'local') {
      fileInputRef.current?.click();
    } else {
      onOpenAssetsPicker?.();
    }
  };

  const handleItemClick = (menu: ToolMenuKey, item: string) => {
    setOpenMenu(null);
    onMenuSelect?.(menu, item);
  };

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

  return createPortal(
    <div
      ref={toolbarRef}
      className={styles.toolbar}
      data-canvas-chrome
      style={{ left: stageAnchor.left, top: stageAnchor.top, zIndex: 2147483000 }}
      onPointerDownCapture={() => {
        lockChromeSelection();
      }}
    >
      {}
      {openMenu && <div className={styles.menuOverlay} onClick={() => setOpenMenu(null)} />}

      {}
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

      {}
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
        accept="image/*,video/*,audio/*"
        className={styles.hiddenInput}
        onChange={handleFileChange}
      />

      {}
      <div className={styles.divider} />

      {}
      <button
        className={`${styles.toolBtn} ${showImageDialog ? styles.toolBtnActive : ''}`}
        onClick={onToggleImageDialog}
        data-tooltip="图片"
        aria-label="图片"
      >
        <ImagePlus size={20} strokeWidth={2} />
      </button>

      {}
      <button
        className={`${styles.toolBtn} ${showVideoDialog ? styles.toolBtnActive : ''}`}
        onClick={onToggleVideoDialog}
        data-tooltip="视频"
        aria-label="视频"
      >
        <Video size={20} strokeWidth={2} />
      </button>

      {}
      <button
        className={`${styles.toolBtn} ${showAudioDialog ? styles.toolBtnActive : ''}`}
        onClick={onToggleAudioDialog}
        data-tooltip="音频"
        aria-label="音频"
      >
        <AudioLines size={20} strokeWidth={2} />
      </button>

      {}
      <button className={styles.toolBtn} onClick={onAddTextNode} data-tooltip="添加文本" aria-label="添加文本">
        <Type size={20} strokeWidth={2} />
      </button>

      {}
      <div className={styles.divider} />

      {}
      {renderMenuTool('assets')}

      {}
      {renderMenuTool('goods')}
    </div>,
    document.body,
  );
}
