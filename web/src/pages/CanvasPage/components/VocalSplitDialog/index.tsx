/* ============================================
 * VocalSplitDialog 人声背景分离编辑态单条（IKHA2W）：源视频卡下方浮出唯一一条，
 * X 关闭在最左（先例同抠图 CutoutToolbar 与音视频分离单条化——上方仅 X 退出的
 * 独立工具条随单条化退役；本工具无画布操作）：X | 分隔线 | 场景下拉四档 +
 * 分离格式下拉五档 + 「本期免费」标注 + 发送按钮。两个下拉点击展开、菜单向上弹、
 * 点外与选择即收起、互斥展开（对齐音视频分离格式下拉与抠图场景下拉形态，与入口的悬停式是并存的两种
 * 既定形态）；场景项 title 携带产出轨数说明（通用/音乐=人声+背景音两轨、短剧/口播=
 * 人声/音乐/音效三轨，轨集合由契约 VOCAL_SPLIT_SCENE_TRACKS 派生）。
 * 场景与格式均为受控（状态提升在 CanvasPage；通用/audio + aac 默认、不跨会话记忆——
 * 进入编辑态重置、退出复位）。编辑会话状态提升在 CanvasPage，本组件受控；发送按当前
 * 所选场景与格式建任务（发送闭环由父级承担）。视频暂停在当前帧与播放控制锁定由
 * MediaNode 的 splitEditing 注入承担（透明锁定层接管指针）。data-gen-panel-territory
 * 豁免点外关闭误杀；Esc/X/点其他卡/点空白退出由 CanvasPage 承载，未发送退出不建任务
 * 不建卡。容器视觉 = 浮层容器三令牌 + 24px 胶囊圆角（对齐音视频分离家族形态）。
 * ============================================ */
import { useRef, useState } from 'react';
import { ArrowUp, ChevronDown, X } from 'lucide-react';
import type { FollowDialogAnchor } from '../../followDialog';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside';
import {
  VOCAL_SPLIT_FORMATS,
  VOCAL_SPLIT_SCENE_OPTIONS,
  vocalSplitSceneHint,
  vocalSplitSceneLabel,
  type VocalSplitFormat,
  type VocalSplitScene,
} from '../../vocalSplit';
import styles from './index.module.css';

interface VocalSplitDialogProps {
  /** X 关闭（四退出之一，未发送退出不建任务不建卡由父级处理） */
  onClose: () => void;
  /** 当前所选分离场景（受控：通用默认，切换即派发父级） */
  scene: VocalSplitScene;
  onSceneChange: (scene: VocalSplitScene) => void;
  /** 当前所选分离格式（受控：aac 默认，切换即派发父级；展示用大写） */
  format: VocalSplitFormat;
  onFormatChange: (format: VocalSplitFormat) => void;
  /** 发送：父级按当前所选场景与格式建任务（发送即退编辑态再建卡） */
  onSend: () => void;
  /** 发送中（创建请求飞行期防重复提交） */
  submitting?: boolean;
  /** 源视频卡下方单条跟随锚（IKH25A 中心点锚：left=源卡中心 x，缺省锚定底部） */
  sendBarAnchor: FollowDialogAnchor | null;
}

export default function VocalSplitDialog({
  onClose,
  scene,
  onSceneChange,
  format,
  onFormatChange,
  onSend,
  submitting,
  sendBarAnchor,
}: VocalSplitDialogProps) {
  const readOnly = submitting === true;

  /** 两个下拉展开态（本地 UI 态：选择/点外关闭即收起，随浮条卸载丢弃；互斥展开） */
  const [sceneMenuOpen, setSceneMenuOpen] = useState(false);
  const [formatMenuOpen, setFormatMenuOpen] = useState(false);
  const sceneWrapRef = useRef<HTMLDivElement>(null);
  const formatWrapRef = useRef<HTMLDivElement>(null);
  useDismissOnOutside([
    { open: sceneMenuOpen, ref: sceneWrapRef, dismiss: () => setSceneMenuOpen(false) },
    { open: formatMenuOpen, ref: formatWrapRef, dismiss: () => setFormatMenuOpen(false) },
  ]);

  /** 置灰守卫（口径同 VideoAudioSplitDialog：aria-disabled 由 disabled 承担，title 保留悬停原因） */
  const guarded = (disabled: boolean, dispatch: () => void) => () => {
    if (disabled) return;
    dispatch();
  };

  const anchorStyle = (anchor: FollowDialogAnchor | null) =>
    anchor ? { left: anchor.left, top: anchor.top } : undefined;

  return (
    /* 源视频卡下方单条（跟随锚定时 inline left/top 生效，需解除默认 bottom 定位）。
       X 关闭在最左（对齐抠图/音视频分离单条先例），后接分隔线与场景/格式双下拉。 */
    <div
      className={`${styles.sendBar} ${sendBarAnchor ? styles.sendBarFollow : ''}`}
      style={anchorStyle(sendBarAnchor)}
      data-gen-panel-territory
      data-testid="vocal-split-send-bar"
    >
      <button
        type="button"
        className={styles.toolBtn}
        data-testid="vocal-split-close"
        title="退出人声背景分离（未发送不建任务不建卡）"
        onClick={onClose}
      >
        <X size={14} strokeWidth={2} />
      </button>
      <span className={styles.divider} aria-hidden />

      {/* 分离场景下拉（触发钮显当前场景；发送条在卡下方，菜单向上弹出） */}
      <div className={styles.formatWrap} ref={sceneWrapRef}>
        <button
          type="button"
          className={styles.formatTrigger}
          data-testid="vocal-split-scene-trigger"
          aria-haspopup="menu"
          aria-expanded={sceneMenuOpen || undefined}
          disabled={readOnly}
          title="选择分离场景（决定产出音轨）"
          onClick={guarded(readOnly, () => {
            setFormatMenuOpen(false);
            setSceneMenuOpen((open) => !open);
          })}
        >
          <span>{vocalSplitSceneLabel(scene)}</span>
          <ChevronDown size={12} strokeWidth={2} />
        </button>
        {sceneMenuOpen && (
          <div
            className={styles.formatMenu}
            role="menu"
            data-testid="vocal-split-scene-menu"
          >
            {VOCAL_SPLIT_SCENE_OPTIONS.map((item) => (
              <button
                key={item}
                type="button"
                role="menuitemradio"
                aria-checked={item === scene}
                title={vocalSplitSceneHint(item)}
                className={`${styles.formatMenuItem} ${item === scene ? styles.formatMenuItemActive : ''}`}
                data-testid={`vocal-split-scene-item-${item}`}
                onClick={() => {
                  onSceneChange(item);
                  setSceneMenuOpen(false);
                }}
              >
                {vocalSplitSceneLabel(item)}
              </button>
            ))}
          </div>
        )}
      </div>
      {/* 分离格式下拉（触发钮显当前格式；菜单向上弹出避开发送条下方视口边缘） */}
      <div className={styles.formatWrap} ref={formatWrapRef}>
        <button
          type="button"
          className={styles.formatTrigger}
          data-testid="vocal-split-format-trigger"
          aria-haspopup="menu"
          aria-expanded={formatMenuOpen || undefined}
          disabled={readOnly}
          title="选择音频输出格式"
          onClick={guarded(readOnly, () => {
            setSceneMenuOpen(false);
            setFormatMenuOpen((open) => !open);
          })}
        >
          <span>{format.toUpperCase()}</span>
          <ChevronDown size={12} strokeWidth={2} />
        </button>
        {formatMenuOpen && (
          <div
            className={styles.formatMenu}
            role="menu"
            data-testid="vocal-split-format-menu"
          >
            {VOCAL_SPLIT_FORMATS.map((item) => (
              <button
                key={item}
                type="button"
                role="menuitemradio"
                aria-checked={item === format}
                className={`${styles.formatMenuItem} ${item === format ? styles.formatMenuItemActive : ''}`}
                data-testid={`vocal-split-format-item-${item}`}
                onClick={() => {
                  onFormatChange(item);
                  setFormatMenuOpen(false);
                }}
              >
                {item.toUpperCase()}
              </button>
            ))}
          </div>
        )}
      </div>
      <span className={styles.freeHint}>本期免费</span>
      <button
        type="button"
        className={`${styles.sendBtn} ${!readOnly ? styles.sendBtnActive : ''}`}
        data-testid="vocal-split-send-btn"
        disabled={readOnly}
        title={readOnly ? '正在发送，请稍候' : '发送人声背景分离任务'}
        onClick={guarded(readOnly, onSend)}
      >
        <ArrowUp size={12.8} fill="currentColor" strokeWidth={0} />
      </button>
    </div>
  );
}
