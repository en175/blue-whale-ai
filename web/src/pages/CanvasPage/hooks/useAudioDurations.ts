/* ============================================
 * useAudioDurations（IKFCKS）：参考音频时长探测——为参考缩略图放大预览的
 * 「图标+名称+时长」卡片提供时长数据；仅 preload metadata 不拉全量音频。
 *  增量探测：每个 key 只建一次一次性 Audio 元素，列表增删不重复请求已探测项；
 *  调用方须以 useMemo 稳定 sources 引用（引用不变不重探测）。
 * ============================================ */
import { useEffect, useRef, useState } from 'react';

/** 探测输入项：key 为面板内参考项唯一键（与渲染 key 同源），src 为音频地址 */
export interface AudioDurationSource {
  key: string;
  src: string;
}

/** 批量探测音频时长（秒）：读到即增量入表；探测失败（地址失效/格式不支持）不入表，
 *  预览卡片缺省不显示时长 */
export function useAudioDurations(sources: readonly AudioDurationSource[]): Map<string, number> {
  const [durations, setDurations] = useState<Map<string, number>>(() => new Map());
  /** 已建过探测元素/已入表的 key：重复渲染或列表增删不重探 */
  const probedKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const cleanups: Array<() => void> = [];
    for (const { key, src } of sources) {
      if (!src || probedKeysRef.current.has(key)) continue;
      probedKeysRef.current.add(key);
      const audio = new Audio();
      audio.preload = 'metadata';
      const onLoaded = () => {
        if (Number.isFinite(audio.duration)) {
          setDurations((prev) => {
            if (prev.get(key) === audio.duration) return prev;
            const next = new Map(prev);
            next.set(key, audio.duration);
            return next;
          });
        }
      };
      audio.addEventListener('loadedmetadata', onLoaded, { once: true });
      audio.src = src;
      cleanups.push(() => {
        audio.removeEventListener('loadedmetadata', onLoaded);
        // 规范卸载：置空 src 属性会以页面 URL 发起一次媒体加载，须移除属性并 load() 复位
        audio.removeAttribute('src');
        audio.load();
      });
    }
    return () => cleanups.forEach((fn) => fn());
  }, [sources]);

  return durations;
}
