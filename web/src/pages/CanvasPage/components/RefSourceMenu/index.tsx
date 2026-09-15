import { useRef, useState } from 'react';
import { FolderOpen, MousePointerClick, Plus } from 'lucide-react';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside';
import styles from './index.module.css';

interface RefSourceMenuProps {
  /** 从资产中选择：打开资产库选择弹窗（按面板类型过滤媒体） */
  onPickFromAssets: () => void;
  /** 从节点添加素材：进入画布节点选取模式 */
  onPickFromCanvas: () => void;
  /** 画布选取模式进行中（「+」高亮提示） */
  pickMode?: boolean;
  /** 具名槽位文字（IKFE8U 视频首尾帧：「首帧」/「尾帧」）；普通参考缺省纯「+」 */
  label?: string;
  /** 覆盖入口按钮 title（具名槽位传「添加首帧（…）」等便于定位与提示） */
  entryTitle?: string;
}

/** 统一入口按钮 title（测试定位与组件渲染共用同一来源，文案调整不散落） */
export const REF_SOURCE_ENTRY_TITLE = '从资产中选择 / 从节点添加素材';

/** 统一附件来源入口（IKFE8S/IKFE8T）：单「+」展开两项来源菜单——
 *  「从资产中选择」接资产库选择、「从节点添加素材」接画布节点选取。
 *  布局与样式遵循图片面板基准；视频/音频面板复用时由宿主在回调里
 *  对接目标槽位（首尾帧等角色），本组件不感知面板类型。 */
export default function RefSourceMenu({ onPickFromAssets, onPickFromCanvas, pickMode, label, entryTitle }: RefSourceMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useDismissOnOutside([
    { open, ref: wrapRef, dismiss: () => setOpen(false) },
  ]);

  return (
    <div className={styles.sourceWrap} ref={wrapRef}>
      <button
        className={`${styles.trigger} ${label ? styles.triggerSlotted : ''} ${pickMode ? styles.picking : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={entryTitle ?? REF_SOURCE_ENTRY_TITLE}
      >
        {label ? (
          <>
            <Plus size={16} strokeWidth={2} />
            <span className={styles.triggerLabel}>{label}</span>
          </>
        ) : (
          <Plus size={18} strokeWidth={2} />
        )}
      </button>
      {open && (
        <>
          <div className={styles.menuOverlay} onClick={() => setOpen(false)} />
          <div className={styles.sourceMenu}>
            <button
              className={styles.sourceMenuItem}
              onClick={() => { setOpen(false); onPickFromAssets(); }}
            >
              <FolderOpen size={14} strokeWidth={2} />
              <span>从资产中选择</span>
            </button>
            <button
              className={styles.sourceMenuItem}
              onClick={() => { setOpen(false); onPickFromCanvas(); }}
            >
              <MousePointerClick size={14} strokeWidth={2} />
              <span>从节点添加素材</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
