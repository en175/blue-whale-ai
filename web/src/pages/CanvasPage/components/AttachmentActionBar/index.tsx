/* ============================================
 * AttachmentActionBar 附件操作条（IKGB1X 契约，三面板共用）
 * ============================================ */
import type { ReactNode } from 'react';
import { FolderOpen, Plus } from 'lucide-react';
import type { VideoRefRole } from '../../videoMediaRefs';
import styles from './index.module.css';

/** 「+ 参考」按钮 title（测试定位与组件渲染共用同一来源，文案调整不散落） */
export const ATTACHMENT_ACTION_PICK_CANVAS_TITLE = '从节点添加素材';
/** 「资产库」按钮 title */
export const ATTACHMENT_ACTION_PICK_ASSETS_TITLE = '从资产中选择';

/** 操作条发起添加的媒体类型边界（与三面板现有回调的 kind 参数同构） */
export type AttachmentActionKind = 'image' | 'video' | 'audio';

interface AttachmentActionBarProps {
  /** 「+ 参考」：进入画布点选模式（等价退役菜单项「从节点添加素材」）；kind/role 透传宿主分派 */
  onPickFromCanvas?: (kind: AttachmentActionKind, role?: VideoRefRole) => void;
  /** 「资产库」：打开资产库选择弹窗（等价退役菜单项「从资产中选择」） */
  onPickFromAssets?: (kind: AttachmentActionKind, role?: VideoRefRole) => void;
  /** 媒体类型边界：图片面板 'image'、音频面板 'audio'；视频面板按目标槽位边界传（首尾帧槽 'image'）。
   *  必传：三面板调用方均显式给值，不设缺省（避免隐含假灵活边界） */
  kind: AttachmentActionKind;
  /** 视频草稿目标参考角色（首帧/尾帧）：IKGB7W 接入时由宿主按首个空槽计算；图片/音频面板不传 */
  role?: VideoRefRole;
  /** 画布点选模式进行中（「+ 参考」高亮提示） */
  pickMode?: boolean;
  /** 禁用原因：按钮常显置灰 + 悬停说明（替代旧「入口消失」口径），缺省可用。
   *  与现有能力门控一一对应：模型参考能力位不支持 / 附件达数量上限 / 生成中只读。
   *  采用 aria-disabled + 点击守卫而非原生 disabled：禁用时仍须悬停展示原因（原生 disabled 抑制 tooltip）。 */
  disabledReason?: string | null;
  /** 右侧并入的宿主操作（面板现有展开/关闭按钮），保持在第一行右侧原位 */
  trailing?: ReactNode;
}

/** 附件操作条（IKGB1X）：输入框上方第一行，左「+ 参考」「资产库」pill 按钮、右侧并入宿主操作。
 *  图片/视频/音频三面板同源使用；两条添加链路的行为由各面板既有回调承载，本组件只换入口形态。
 *  视觉定义单一来源 = index.module.css（CSS 锁见 actionBarVisualSource.test.ts）。 */
export default function AttachmentActionBar({
  onPickFromCanvas,
  onPickFromAssets,
  kind,
  role,
  pickMode,
  disabledReason,
  trailing,
}: AttachmentActionBarProps) {
  const disabled = disabledReason != null && disabledReason !== '';
  const guard = (dispatch?: (kind: AttachmentActionKind, role?: VideoRefRole) => void) => () => {
    if (disabled) return;
    dispatch?.(kind, role);
  };
  return (
    <div className={styles.actionBar}>
      <div className={styles.actions}>
        <button
          className={`${styles.pill} ${pickMode ? styles.picking : ''}`}
          aria-disabled={disabled || undefined}
          title={disabled ? disabledReason : ATTACHMENT_ACTION_PICK_CANVAS_TITLE}
          onClick={guard(onPickFromCanvas)}
        >
          <Plus size={14} strokeWidth={2} />
          <span>参考</span>
        </button>
        <button
          className={styles.pill}
          aria-disabled={disabled || undefined}
          title={disabled ? disabledReason : ATTACHMENT_ACTION_PICK_ASSETS_TITLE}
          onClick={guard(onPickFromAssets)}
        >
          <FolderOpen size={14} strokeWidth={2} />
          <span>资产库</span>
        </button>
      </div>
      {trailing ? <div className={styles.trailing}>{trailing}</div> : null}
    </div>
  );
}
