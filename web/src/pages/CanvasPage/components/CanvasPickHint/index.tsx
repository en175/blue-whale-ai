import styles from './index.module.css';
import type { PickChannel } from '../../hooks/useCanvasPickers';
import type { VideoRefRole } from '../../videoMediaRefs';

interface CanvasPickHintProps {
  pickMode: PickChannel | null;
  pickTarget: PickChannel | null;
  pickRefRole: VideoRefRole | null;
  imagePickSessionActive: boolean;
  videoPickSessionActive: boolean;
  audioPickSessionActive: boolean;
  showImageDialog: boolean;
  showBottomDialog: boolean;
  showAudioDialog: boolean;
  onEndImagePick: () => void;
  onEndVideoPick: () => void;
  onEndAudioPick: () => void;
}

export default function CanvasPickHint({
  pickMode,
  pickTarget,
  pickRefRole,
  imagePickSessionActive,
  videoPickSessionActive,
  audioPickSessionActive,
  showImageDialog,
  showBottomDialog,
  showAudioDialog,
  onEndImagePick,
  onEndVideoPick,
  onEndAudioPick,
}: CanvasPickHintProps) {
  if (!(pickMode && pickTarget && (showImageDialog || showBottomDialog || showAudioDialog || pickMode === 'product' || pickMode === 'asset'))) {
    return null;
  }
  return (
    <>
      {imagePickSessionActive ? (
        <div className={`${styles.pickHint} ${styles.pickHintSession}`} data-gen-panel-territory>
          <span>从节点添加素材：连续点击画布中的图片节点带入参考；点击空白、按 Esc 或点「完成选取」结束选取</span>
          <button type="button" className={styles.pickHintFinish} onClick={onEndImagePick}>完成选取</button>
        </div>
      ) : videoPickSessionActive ? (
        <div className={`${styles.pickHint} ${styles.pickHintSession}`} data-gen-panel-territory>
          <span>{(pickRefRole === 'first' || pickRefRole === 'last')
            ? '从节点添加素材：连续点击画布中的图片节点替换当前首帧/尾帧槽位；点击空白、按 Esc 或点「完成选取」结束选取'
            : '从节点添加素材：连续点击画布中的图片、视频或音频节点带入参考；点击空白、按 Esc 或点「完成选取」结束选取'}</span>
          <button type="button" className={styles.pickHintFinish} onClick={onEndVideoPick}>完成选取</button>
        </div>
      ) : audioPickSessionActive ? (
        <div className={`${styles.pickHint} ${styles.pickHintSession}`} data-gen-panel-territory>
          <span>从节点添加素材：连续点击画布中的图片或音频节点带入参考，点击文本卡带入创作上下文；点击空白、按 Esc 或点「完成选取」结束选取</span>
          <button type="button" className={styles.pickHintFinish} onClick={onEndAudioPick}>完成选取</button>
        </div>
      ) : (
      <div className={styles.pickHint} data-gen-panel-territory>
        {pickMode === 'image' && ((pickRefRole === 'first' || pickRefRole === 'last')
          ? '从节点添加素材：点击画布中的图片节点带入首帧/尾帧，点击空白处取消'
          : '从节点添加素材：点击画布中的图片节点或方案节点，带入完整参考，点击空白处取消')}
        {pickMode === 'video' && '从节点添加素材：点击画布中的图片、视频或音频节点带入参考，点击空白处取消'}
        {pickMode === 'audio' && '到节点选择：点击画布中的图片或音频节点带入参考，点击文本卡带入创作上下文，点击空白处取消'}
        {pickMode === 'product' && '到节点选择：点击画布中的图片节点带入商品图，点击空白处取消'}
        {pickMode === 'asset' && '到节点选择：点击画布中的图片节点或方案节点，带入完整参考，点击空白处取消'}
      </div>
      )}
    </>
  );
}
