/* ============================================
 * useAudioDurations（IKFCKS）：参考音频时长探测——为参考缩略图放大预览的
 * 「图标+名称+时长」卡片提供时长数据；仅 preload metadata 不拉全量音频。
 *  增量探测：每个 key 只建一次一次性 Audio 元素，列表增删不重复请求已探测项；
 *  调用方须以 useMemo 稳定 sources 引用（引用不变不重探测）。
 * ============================================ */
import { useEffect, useRef, useState } from 'react';
import { remoteImageCrossOrigin, resolveMediaSrc } from '@/utils/remoteImageCors';

/** 探测输入项：key 为面板内参考项唯一键（与渲染 key 同源），src 为音频地址 */
export interface AudioDurationSource {
  key: string;
  src: string;
}

interface AudioDurationEntry {
  src: string;
  dispose: () => void;
  duration?: number;
}

/** 批量探测音频时长（秒）：读到即增量入表；探测失败（地址失效/格式不支持）不入表，
 *  预览卡片缺省不显示时长 */
export function useAudioDurations(sources: readonly AudioDurationSource[]): Map<string, number> {
  const [durations, setDurations] = useState<Map<string, number>>(() => new Map());
  /** key 对应的探测资源或已完成缓存：重复渲染及重排不重探 */
  const entriesRef = useRef<Map<string, AudioDurationEntry>>(new Map());

  useEffect(() => {
    const sourceByKey = new Map(sources.map(({ key, src }) => [key, src]));
    const removedKeys = new Set<string>();

    for (const [key, entry] of entriesRef.current) {
      const nextSrc = sourceByKey.get(key);
      if (nextSrc === entry.src) continue;
      entry.dispose();
      entriesRef.current.delete(key);
      removedKeys.add(key);
    }

    for (const { key, src } of sources) {
      if (!src || entriesRef.current.has(key)) continue;
      const audio = new Audio();
      const cors = remoteImageCrossOrigin(src);
      if (cors) audio.crossOrigin = cors;
      audio.preload = 'metadata';
      let disposed = false;
      const entry: AudioDurationEntry = {
        src,
        dispose: () => {
          if (disposed) return;
          disposed = true;
          audio.removeEventListener('loadedmetadata', onLoaded);
          // 规范释放：置空 src 属性会以页面 URL 发起媒体加载，须移除属性并 load() 复位
          audio.removeAttribute('src');
          audio.load();
        },
      };
      const onLoaded = () => {
        if (entriesRef.current.get(key) !== entry || !Number.isFinite(audio.duration)) return;
        entry.duration = audio.duration;
        entry.dispose();
        setDurations((prev) => {
          if (prev.get(key) === entry.duration) return prev;
          const next = new Map(prev);
          next.set(key, entry.duration!);
          return next;
        });
      };
      audio.addEventListener('loadedmetadata', onLoaded, { once: true });
      audio.src = resolveMediaSrc(src);
      entriesRef.current.set(key, entry);
    }

    if (removedKeys.size > 0) {
      setDurations((prev) => {
        if (![...removedKeys].some((key) => prev.has(key))) return prev;
        const next = new Map(prev);
        for (const key of removedKeys) next.delete(key);
        return next;
      });
    }
  }, [sources]);

  useEffect(
    () => () => {
      for (const entry of entriesRef.current.values()) entry.dispose();
      entriesRef.current.clear();
    },
    [],
  );

  return durations;
}
