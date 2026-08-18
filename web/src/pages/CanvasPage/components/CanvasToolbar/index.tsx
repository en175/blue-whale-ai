/* ============================================
 * CanvasToolbar 画布左侧工具栏：节点创建、对话窗口与扩展工具菜单入口
 * ============================================ */
import { useRef, useState } from 'react';
import {
  Hand,
  MousePointer2,
  Plus,
  ImagePlus,
  Video,
  Type,
  AudioLines,
  Music,
  Library,
  ShoppingBag,
  BarChart3,
  Palette,
  UserRound,
  Box,
  Mountain,
  PenLine,
  SquarePlus,
  Download,
  type LucideIcon,
} from 'lucide-react';
import styles from './index.module.css';

type ToolMode = 'drag' | 'select';

/** 扩展工具菜单 key */
export type ToolMenuKey = 'audio' | 'assets' | 'goods';

interface ToolMenuItem {
  key: string;
  label: string;
  icon: LucideIcon;
}

/** 三个扩展工具：音频 / 资产库 / 商品，点击在工具栏旁弹出选择 */
const TOOL_MENUS: Record<ToolMenuKey, { title: string; icon: LucideIcon; items: ToolMenuItem[] }> = {
  audio: {
    title: '音频',
    icon: AudioLines,
    items: [
      { key: 'generate', label: '音频生成', icon: AudioLines },
      { key: 'music', label: 'AI 音乐', icon: Music },
    ],
  },
  assets: {
    title: '资产库',
    icon: Library,
    items: [
      { key: 'shared', label: '共享资产', icon: BarChart3 },
      { key: 'style', label: '风格卡', icon: Palette },
      { key: 'character', label: '角色卡', icon: UserRound },
      { key: 'object', label: '物体卡', icon: Box },
      { key: 'environment', label: '环境卡', icon: Mountain },
      { key: 'custom', label: '自定义卡', icon: PenLine },
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
  onToggleVideoDialog: () => void;
  onToggleImageDialog: () => void;
  onAddTextNode: () => void;
  showVideoDialog: boolean;
  showImageDialog: boolean;
  /** 扩展工具菜单项选择（预留联调入口） */
  onMenuSelect?: (menu: ToolMenuKey, item: string) => void;
}

export default function CanvasToolbar({
  mode,
  onModeChange,
  onUploadFile,
  onToggleVideoDialog,
  onToggleImageDialog,
  onAddTextNode,
  showVideoDialog,
  showImageDialog,
  onMenuSelect,
}: CanvasToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [openMenu, setOpenMenu] = useState<ToolMenuKey | null>(null);

  /** 点击加号上传 */
  const handleAddClick = () => {
    fileInputRef.current?.click();
  };

  /** 文件选择 */
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      onUploadFile(Array.from(files));
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  /** 扩展工具按钮：切换弹出菜单 */
  const toggleMenu = (key: ToolMenuKey) => {
    setOpenMenu((prev) => (prev === key ? null : key));
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
          title={def.title}
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
    <div className={styles.toolbar}>
      {/* 菜单打开时点击外部收起 */}
      {openMenu && <div className={styles.menuOverlay} onClick={() => setOpenMenu(null)} />}

      {/* 拖动/选择切换 */}
      <button
        className={`${styles.toolBtn} ${mode === 'drag' ? styles.toolBtnActive : ''}`}
        onClick={() => onModeChange(mode === 'drag' ? 'select' : 'drag')}
        title={mode === 'drag' ? '切换为选择' : '切换为拖动'}
      >
        {mode === 'drag' ? (
          <Hand size={20} strokeWidth={2} />
        ) : (
          <MousePointer2 size={20} strokeWidth={2} />
        )}
      </button>

      {/* 加号上传 */}
      <button className={styles.toolBtn} onClick={handleAddClick} title="上传素材">
        <Plus size={20} strokeWidth={2} />
      </button>
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

      {/* 图片对话 */}
      <button
        className={`${styles.toolBtn} ${showImageDialog ? styles.toolBtnActive : ''}`}
        onClick={onToggleImageDialog}
        title="图片对话"
      >
        <ImagePlus size={20} strokeWidth={2} />
      </button>

      {/* 视频对话 */}
      <button
        className={`${styles.toolBtn} ${showVideoDialog ? styles.toolBtnActive : ''}`}
        onClick={onToggleVideoDialog}
        title="视频对话"
      >
        <Video size={20} strokeWidth={2} />
      </button>

      {/* 音频（弹出：音频生成 / AI 音乐） */}
      {renderMenuTool('audio')}

      {/* 文本 */}
      <button className={styles.toolBtn} onClick={onAddTextNode} title="添加文本">
        <Type size={20} strokeWidth={2} />
      </button>

      {/* 分隔线 */}
      <div className={styles.divider} />

      {/* 资产库（弹出：共享资产 / 风格卡 / 角色卡 / 物体卡 / 环境卡 / 自定义卡） */}
      {renderMenuTool('assets')}

      {/* 商品（弹出：新建商品 / 导入商品） */}
      {renderMenuTool('goods')}
    </div>
  );
}
