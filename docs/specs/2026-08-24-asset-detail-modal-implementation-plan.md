# 资产点击详情弹窗 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 资产库页面（`/assets`）资产卡片点击弹出详情弹窗（媒体预览 + 可读字段，不给用户看原始 JSON），后端列表接口补字段作为数据底座。

**Architecture:** 前端新增 `AssetDetailModal` 组件（对齐 `ConfirmModal` 的遮罩 + `role="dialog"` 模式），点击卡片用已全量拉取的内存数据渲染（零额外请求）；媒体预览抽离为共享 `AssetMedia` 组件（Assets 页网格与弹窗复用）；后端扩展 `AssetRepo.listByUser` 返回 `size/generation_job_id/project_id/mime`。

**Tech Stack:** React 19 + Vite（`blue-whale-ai/web`）、Prisma + vitest（`blue-whale-ai/packages/persistence`）、vitest + jsdom（web 测试）。

**设计文档:** `docs/specs/2026-08-24-asset-detail-modal-design.md`（已提交 46359d63）

---

## 文件结构

| 文件 | 动作 | 职责 |
| --- | --- | --- |
| `packages/persistence/src/asset-repo.ts` | 修改 | `AssetView` + `listByUser` 补 4 字段 |
| `packages/persistence/src/asset-repo.test.ts` | 新建 | `listByUser` 新字段断言（BigInt→number/string） |
| `web/src/api/assets.ts` | 修改 | `AssetRecord` 扩展 `size/generation_job_id/project_id/mime` |
| `web/src/components/AssetMedia/index.tsx` | 新建 | 从 Assets 页抽离的共享媒体三态组件 |
| `web/src/components/AssetMedia/index.module.css` | 新建 | 迁出的媒体样式类 |
| `web/src/pages/Assets/index.tsx` | 修改 | 删本地媒体组件导入共享版；卡片点击开弹窗；上传构造补字段 |
| `web/src/pages/Assets/index.module.css` | 修改 | 删除迁出到 AssetMedia 的样式类 |
| `web/src/components/AssetDetailModal/index.tsx` | 新建 | 详情弹窗（媒体预览 + 可读字段） |
| `web/src/components/AssetDetailModal/index.module.css` | 新建 | 弹窗样式 |
| `web/src/components/AssetDetailModal/format.ts` | 新建 | 纯格式化函数（来源/时长/大小/日期） |
| `web/src/components/AssetDetailModal/format.test.ts` | 新建 | 格式化函数单测 |
| `web/src/components/AssetDetailModal/index.test.tsx` | 新建 | 弹窗打开/关闭/字段冒烟 |

---

## Task 0: 开工入口（task worktree）

- [ ] **Step 1: 创建 task worktree**

```bash
# 从 blue-whale-ai 主 checkout 运行开工入口（唯一入口）
scripts/start-task-worktree.sh --type feature --no-issue --summary "资产点击详情弹窗"
# 若环境 bash 不可用（Windows E_ACCESSDENIED/CreateFileMapping），直接调等价 Python 入口：
# py -3 scripts/start-task-worktree.py --type feature --no-issue --summary "资产点击详情弹窗"
```

Expected: 从同步后的本地 master 精确 SHA 建中文任务分支，输出 worktree 路径；后续所有任务在 worktree 内执行（写操作禁止在主 checkout）。

- [ ] **Step 2: 确认已进入任务分支**

```bash
git branch --show-current   # 期望：中文任务分支名（非 master/main）
```

---

## Task 1: 后端 `listByUser` 补溯源字段（TDD）

**Files:**
- Modify: `packages/persistence/src/asset-repo.ts`
- Create: `packages/persistence/src/asset-repo.test.ts`

- [ ] **Step 1: 核实部署库 assets 表列（防线上查询报错）**

部署表若缺 `generation_job_id` 列，`findMany` 全列查询会运行时报错。按 ADR-0064 起隧道后执行：

```bash
# 隧道（唯一应急通道）：ssh -i "C:/Users/54772/.ssh/weitian.pem" -N -o ExitOnForwardFailure=yes \
#   -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -o StrictHostKeyChecking=accept-new \
#   -L 13306:127.0.0.1:3306 root@115.190.244.91
# 然后：
"D:/Program Files/MySQL/MySQL Server 8.0/bin/mysql.exe" -h 127.0.0.1 -P 13306 \
  -u root -pb3f9b3c44dda7225a88c90903df84c5818d964ce23c56be5 \
  --default-character-set=utf8mb4 blue_whale -e "DESCRIBE assets;"
```

Expected: `size` / `mime` / `project_id` 列存在（显示必需）；`generation_job_id` 若存在 → 按本计划全量实现；若缺失 → 只补 `size/mime/project_id` 三字段并在 commit message 注明偏差（本计划其余任务不受影响，弹窗显示只用 `size`）。

- [ ] **Step 2: 写失败测试**

创建 `packages/persistence/src/asset-repo.test.ts`：

```ts
import { describe, expect, it, vi } from "vitest";

import { createAssetRepo } from "./asset-repo.js";

describe("createAssetRepo.listByUser", () => {
  it("返回 size/generation_job_id/project_id/mime 溯源字段（BigInt 转 number/string）", async () => {
    const row = {
      id: 42n,
      type: "image",
      url: "https://tos.test/a.png",
      width: 800,
      height: 600,
      duration: null,
      duration_ms: null,
      source: "generated",
      gmt_create: new Date("2026-08-01T00:00:00.000Z"),
      size: BigInt(5242880),
      generation_job_id: 7n,
      project_id: 55n,
      mime: "image/png",
    };
    const assets = {
      count: vi.fn().mockResolvedValue(1),
      findMany: vi.fn().mockResolvedValue([row]),
    };
    const repo = createAssetRepo({ assets } as never);

    const page = await repo.listByUser("9", { page: 1, size: 24 });

    expect(page.records[0]).toMatchObject({
      id: "42",
      type: "image",
      source: "generated",
      size: 5242880,
      generation_job_id: "7",
      project_id: "55",
      mime: "image/png",
    });
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

```bash
pnpm exec vitest run packages/persistence/src/asset-repo.test.ts
```

Expected: FAIL — `page.records[0].size` / `generation_job_id` / `project_id` / `mime` 为 `undefined`（接口尚未声明新字段）。

- [ ] **Step 4: 实现 `asset-repo.ts`**

`AssetView` 接口（`packages/persistence/src/asset-repo.ts:7-16`）末尾追加：

```ts
  size: number | null;
  generation_job_id: string | null;
  project_id: string | null;
  mime: string | null;
```

`listByUser` 的 records map（`asset-repo.ts:196-205`）末尾追加：

```ts
          size: a.size == null ? null : Number(a.size),
          generation_job_id:
            a.generation_job_id == null ? null : a.generation_job_id.toString(),
          project_id: a.project_id == null ? null : a.project_id.toString(),
          mime: a.mime ?? null,
```

> 说明：`size` 转 `Number`（文件上限 200MB，远低于 `Number.MAX_SAFE_INTEGER`，安全）；BigInt ID 一律 `toString()` 防 NestJS JSON 序列化 BigInt 抛错。若 Step 1 确认部署库缺 `generation_job_id` 列，则跳过该行与接口字段。

- [ ] **Step 5: 运行测试确认通过**

```bash
pnpm exec vitest run packages/persistence/src/asset-repo.test.ts
```

Expected: PASS（1 个用例）。

- [ ] **Step 6: Commit**

```bash
git add packages/persistence/src/asset-repo.ts packages/persistence/src/asset-repo.test.ts
git commit -m "feat: assets 列表接口补 size/generation_job_id/project_id/mime 溯源字段"
```

---

## Task 2: 前端 `AssetRecord` 类型扩展 + 上传构造同步

**Files:**
- Modify: `web/src/api/assets.ts`
- Modify: `web/src/pages/Assets/index.tsx`

- [ ] **Step 1: `AssetRecord` 接口扩展（`web/src/api/assets.ts:10-27`）**

在 `created_at` 之后追加：

```ts
  /** 文件大小（字节），null 表示未知 */
  size: number | null;
  /** AI 生成溯源：关联生成任务 ID，非生成资产为 null */
  generation_job_id: string | null;
  /** 所属项目 ID，非项目资产为 null */
  project_id: string | null;
  /** MIME 类型，null 表示未知 */
  mime: string | null;
```

- [ ] **Step 2: Assets 页上传本地构造补字段（`web/src/pages/Assets/index.tsx:296-307`）**

`handleFileChange` 中 setAssets 的构造对象追加：

```ts
            size: done.size ?? null,
            generation_job_id: null,
            project_id: null,
            mime: done.mime ?? null,
```

- [ ] **Step 3: 类型检查**

```bash
cd web && npx tsc -b
```

Expected: 无类型错误（`AssetChip/useAssetLookup.ts` 只读 `AssetRecord`，不受影响）。

- [ ] **Step 4: Commit**

```bash
git add web/src/api/assets.ts web/src/pages/Assets/index.tsx
git commit -m "feat: AssetRecord 扩展 size/generation_job_id/project_id/mime 字段"
```

---

## Task 3: 抽离共享 `AssetMedia` 组件（纯重构）

**Files:**
- Create: `web/src/components/AssetMedia/index.tsx`
- Create: `web/src/components/AssetMedia/index.module.css`
- Modify: `web/src/pages/Assets/index.tsx`
- Modify: `web/src/pages/Assets/index.module.css`

- [ ] **Step 1: 创建 `web/src/components/AssetMedia/index.tsx`**

内容 = `Assets/index.tsx` 原 `AssetMedia` / `VideoThumb` / `isSafariBrowser` 三个定义的**逐字副本**，仅样式导入改为本模块、并加导出（文件全文如下）：

```tsx
/* ============================================
 * AssetMedia 共享媒体组件：统一处理 image/video/audio 的 loading/loaded/error 三态
 * （从 Assets 页抽离，资产库网格与资产详情弹窗共用）
 * ============================================ */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Play, RotateCw, AlertCircle } from 'lucide-react';
import type { AssetRecord } from '@/api/assets';
import styles from './index.module.css';

/** 媒体加载状态 */
export type MediaLoadState = 'waiting' | 'loading' | 'loaded' | 'error';

/** 单个资产媒体组件：统一处理 loading / loaded / error 三态 */
export function AssetMedia({ asset }: { asset: AssetRecord }) {
  const isSafari = isSafariBrowser();
  // Safari 视频初始为 waiting（懒加载），其余直接进入 loading
  const [state, setState] = useState<MediaLoadState>(
    asset.type === 'video' && isSafari ? 'waiting' : 'loading',
  );
  const [reloadKey, setReloadKey] = useState(0);

  // URL 或 reloadKey 变化时重置为 loading（视频通过 VideoThumb 的 onLoaded/onError 驱动状态）
  useEffect(() => {
    if (asset.type !== 'video') {
      setState('loading');
    }
  }, [asset.url, reloadKey, asset.type]);

  const handleReload = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setReloadKey((k) => k + 1);
    // Safari 视频重试需回到 waiting 让 IntersectionObserver 重新触发；其余直接 loading
    if (asset.type === 'video' && isSafari) {
      setState('waiting');
    } else {
      setState('loading');
    }
  }, [asset.type, isSafari]);

  const mediaSrc = `${asset.url}${asset.url.includes('?') ? '&' : '?'}_reload=${reloadKey}`;

  return (
    <>
      {/* loading 遮罩（图片/音频） */}
      {state === 'loading' && (
        <div className={styles.mediaLoading}>
          <Loader2 size={24} className={styles.spinner} />
        </div>
      )}

      {/* waiting 遮罩（视频未进入视口）：显示半透明背景，无 spinner，减轻视觉负担 */}
      {state === 'waiting' && (
        <div className={styles.mediaLoading} style={{ opacity: 0.3 }}>
          <Loader2 size={24} className={styles.spinner} />
        </div>
      )}

      {/* error 遮罩 + 重试按钮 */}
      {state === 'error' && (
        <div className={styles.mediaError}>
          <AlertCircle size={28} />
          <span className={styles.mediaErrorText}>加载失败</span>
          <button className={styles.mediaRetryBtn} onClick={handleReload} title="重新加载">
            <RotateCw size={14} />
            <span>点击重试</span>
          </button>
        </div>
      )}

      {/* 实际媒体元素 */}
      {asset.type === 'image' && asset.url && (
        <img
          className={styles.media}
          src={mediaSrc}
          alt=""
          loading="lazy"
          onLoad={() => setState('loaded')}
          onError={() => setState('error')}
        />
      )}
      {asset.type === 'video' && asset.url && (
        <VideoThumb
          url={mediaSrc}
          onInView={() => setState('loading')}
          onLoaded={() => setState('loaded')}
          onError={() => setState('error')}
        />
      )}
      {asset.type === 'audio' && asset.url && (
        <audio
          className={styles.audioPlayer}
          src={mediaSrc}
          controls
          preload="metadata"
          onLoadedData={() => setState('loaded')}
          onError={() => setState('error')}
        />
      )}
    </>
  );
}

/** 检测是否为 Safari 浏览器（不包含 Chrome/Chromium/Edge 等基于 Safari 的浏览器） */
export function isSafariBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // Safari 的特征：包含 Safari 但不包含 Chrome/Chromium/Edge/OPR
  return /^((?!chrome|android|edge|opr|crios).)*safari/i.test(ua);
}

/** 视频缩略图：Safari 下使用 IntersectionObserver 懒加载（避免并发请求超时），其他浏览器直接加载保持原有体验 */
export function VideoThumb({
  url,
  onLoaded,
  onError,
  onInView,
}: {
  url: string;
  onLoaded?: () => void;
  onError?: () => void;
  onInView?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [inView, setInView] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const useLazy = isSafariBrowser();

  // Safari 下：IntersectionObserver 懒加载，视频进入视口才请求
  useEffect(() => {
    if (!useLazy) {
      // 非 Safari：直接加载，跳过 IO 检测，通知父组件切换到 loading 态
      setInView(true);
      onInView?.();
      return;
    }
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          onInView?.();
          observer.disconnect();
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [useLazy, onInView]);

  // 关键修复：检测缓存视频的 readyState，避免 onLoadedData 事件因竞态丢失
  // 当视频从浏览器缓存加载时，loadeddata 事件可能在 React 合成事件绑定之前就已触发
  useEffect(() => {
    if (!inView) return;
    const video = videoRef.current;
    if (!video) return;

    const checkReady = () => {
      // readyState >= 2 表示 HAVE_CURRENT_DATA（首帧已就绪）
      if (video.readyState >= 2) {
        onLoaded?.();
      }
    };

    // 立即检查（处理缓存场景，事件可能已触发过）
    checkReady();

    // 同时绑定原生事件监听作为兜底
    video.addEventListener('loadeddata', checkReady);
    return () => video.removeEventListener('loadeddata', checkReady);
  }, [inView, onLoaded]);

  const startPlay = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
    void video.play().catch(() => setPlaying(false));
  };

  return (
    <>
      <div ref={containerRef} className={styles.videoContainer}>
        <video
          ref={videoRef}
          className={styles.media}
          src={inView ? url : undefined}
          muted
          playsInline
          preload="metadata"
          controls={playing}
          onLoadedData={() => onLoaded?.()}
          onError={() => onError?.()}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onClick={() => {
            if (!playing) startPlay();
          }}
        />
      </div>
      {!playing && inView && (
        <button type="button" className={styles.playIcon} title="播放视频" onClick={startPlay}>
          <Play size={22} fill="#fff" strokeWidth={0} />
        </button>
      )}
    </>
  );
}
```

- [ ] **Step 2: 创建 `web/src/components/AssetMedia/index.module.css`**

从 `Assets/index.module.css` 复制以下类（内容逐字复制）：`.media`、`.videoContainer`、`.audioPlayer`、`.mediaLoading`、`.spinner`（含 `@keyframes spin`）、`.mediaError`、`.mediaErrorText`、`.mediaRetryBtn`、`.playIcon`。

- [ ] **Step 3: 修改 `Assets/index.tsx`**

- 删除本地 `AssetMedia`（含 `MediaLoadState` 类型）、`VideoThumb`、`isSafariBrowser` 三个定义及其内部用到的 `Loader2`/`Play`/`RotateCw` 相关 import；保留 `Upload`、`Trash2`、`AlertCircle`。
- 顶部改为：`import { AssetMedia } from '@/components/AssetMedia';`
- 网格中 `<AssetMedia asset={asset} />` 调用不变。

- [ ] **Step 4: 修改 `Assets/index.module.css`**

删除 Step 2 中已迁出的样式类（`.media`/`.videoContainer`/`.audioPlayer`/`.mediaLoading`/`.spinner`/`.mediaError`/`.mediaErrorText`/`.mediaRetryBtn`/`.playIcon`/`@keyframes spin`），保留卡片/缩略图/标签/删除按钮/类型标签等。

- [ ] **Step 5: 验证**

```bash
cd web && npx tsc -b && npm test
```

Expected: 类型检查通过；现有测试全绿（该重构不改行为）。

- [ ] **Step 6: Commit**

```bash
git add web/src/components/AssetMedia web/src/pages/Assets/index.tsx web/src/pages/Assets/index.module.css
git commit -m "refactor: 抽离共享 AssetMedia 媒体组件供资产弹窗复用"
```

---

## Task 4: `AssetDetailModal` 组件（TDD）

**Files:**
- Create: `web/src/components/AssetDetailModal/format.ts`
- Create: `web/src/components/AssetDetailModal/format.test.ts`
- Create: `web/src/components/AssetDetailModal/index.tsx`
- Create: `web/src/components/AssetDetailModal/index.module.css`
- Create: `web/src/components/AssetDetailModal/index.test.tsx`

- [ ] **Step 1: 写失败测试 `format.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { sourceLabel, formatDuration, formatSize, formatDate } from './format';

describe('资产详情字段格式化', () => {
  it('来源映射：uploaded→用户上传 / generated→AI 生成 / 其他→未知来源', () => {
    expect(sourceLabel('uploaded')).toBe('用户上传');
    expect(sourceLabel('generated')).toBe('AI 生成');
    expect(sourceLabel('copied')).toBe('copied');
    expect(sourceLabel(null)).toBe('未知来源');
    expect(sourceLabel(undefined)).toBe('未知来源');
  });

  it('时长格式化：秒 → mm:ss；null → —', () => {
    expect(formatDuration(65)).toBe('01:05');
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(3723)).toBe('62:03'); // 小时进位为分钟，不显示小时
    expect(formatDuration(null)).toBe('—');
  });

  it('文件大小格式化：字节 → B/KB/MB；null → —', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(1024)).toBe('1.0 KB');
    expect(formatSize(5242880)).toBe('5.0 MB');
    expect(formatSize(null)).toBe('—');
  });

  it('创建时间：ISO → 本地可读；无效/空 → —', () => {
    expect(formatDate('2026-08-01T00:00:00.000Z')).toBe(
      new Date('2026-08-01T00:00:00.000Z').toLocaleString(),
    );
    expect(formatDate(null)).toBe('—');
    expect(formatDate('not-a-date')).toBe('—');
  });
});
```

> 注：`3723s` = 62 分 03 秒 → `62:03`（小时进位为分钟，不显示小时）。

- [ ] **Step 2: 运行确认失败**

```bash
cd web && npx vitest run src/components/AssetDetailModal/format.test.ts
```

Expected: FAIL — `Cannot find module './format'`。

- [ ] **Step 3: 实现 `format.ts`**

```ts
/* ============================================
 * AssetDetailModal 字段格式化纯函数（可单测）
 * ============================================ */

/** 资产来源可读映射；未知/空值显示原始值或「未知来源」 */
export function sourceLabel(source: string | null | undefined): string {
  switch (source) {
    case 'uploaded':
      return '用户上传';
    case 'generated':
      return 'AI 生成';
    default:
      return source || '未知来源';
  }
}

/** 时长（秒）→ mm:ss；null/NaN → — */
export function formatDuration(duration: number | null | undefined): string {
  if (duration == null || Number.isNaN(duration)) return '—';
  const total = Math.max(0, Math.floor(duration));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** 字节 → 可读大小（B/KB/MB/GB）；null/NaN → — */
export function formatSize(size: number | null | undefined): string {
  if (size == null || Number.isNaN(size)) return '—';
  if (size < 1024) return `${size} B`;
  const kb = size / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

/** 创建时间 ISO → 本地可读；空/无效 → — */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}
```

- [ ] **Step 4: 运行确认通过**

```bash
cd web && npx vitest run src/components/AssetDetailModal/format.test.ts
```

Expected: PASS（4 个用例）。

- [ ] **Step 5: 写组件冒烟测试 `index.test.tsx`**

```tsx
// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AssetDetailModal from './index';
import type { AssetRecord } from '@/api/assets';

let root: Root;
let container: HTMLDivElement;

function makeAsset(overrides: Partial<AssetRecord> = {}): AssetRecord {
  return {
    id: 1,
    type: 'image',
    url: 'https://tos.test/a.png',
    width: 1024,
    height: 768,
    duration: null,
    source: 'uploaded',
    created_at: '2026-08-01T00:00:00.000Z',
    size: 1048576,
    generation_job_id: null,
    project_id: null,
    mime: 'image/png',
    ...overrides,
  };
}

async function render(asset: AssetRecord | null, onClose = () => {}) {
  container = document.createElement('div');
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(AssetDetailModal, { asset, onClose }));
  });
  return container;
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
});

describe('AssetDetailModal', () => {
  it('asset 为 null 时不渲染', async () => {
    const el = await render(null);
    expect(el.childElementCount).toBe(0);
  });

  it('展示可读字段，不出现原始 JSON 键名', async () => {
    const el = await render(makeAsset());
    expect(el.textContent).toContain('资产详情');
    expect(el.textContent).toContain('用户上传');
    expect(el.textContent).toContain('1024 × 768 px');
    expect(el.textContent).toContain('1.0 MB');
    expect(el.textContent).not.toContain('"source"');
    expect(el.textContent).not.toContain('"created_at"');
  });

  it('generated 来源显示「AI 生成」', async () => {
    const el = await render(makeAsset({ source: 'generated' }));
    expect(el.textContent).toContain('AI 生成');
  });

  it('点击遮罩触发 onClose', async () => {
    const onClose = vi.fn();
    const el = await render(makeAsset(), onClose);
    const overlay = el.querySelector('[class*="overlay"]');
    expect(overlay).not.toBeNull();
    await act(async () => {
      overlay!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击弹窗内部不触发 onClose', async () => {
    const onClose = vi.fn();
    const el = await render(makeAsset(), onClose);
    const dialog = el.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    await act(async () => {
      dialog!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: 运行确认失败**

```bash
cd web && npx vitest run src/components/AssetDetailModal/index.test.tsx
```

Expected: FAIL — `Cannot find module './index'`。

- [ ] **Step 7: 实现 `index.tsx`**

```tsx
/* ============================================
 * AssetDetailModal 资产详情弹窗：媒体预览 + 可读字段
 * （数据以 JSON 结构携带，但展示给用户的是可读信息，不渲染原始 JSON）
 * ============================================ */
import { useMemo } from 'react';
import type { AssetRecord, AssetType } from '@/api/assets';
import { AssetMedia } from '@/components/AssetMedia';
import { sourceLabel, formatDuration, formatSize, formatDate } from './format';
import styles from './index.module.css';

const typeLabel: Record<AssetType, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
};

interface AssetDetailModalProps {
  asset: AssetRecord | null;
  onClose: () => void;
}

export default function AssetDetailModal({ asset, onClose }: AssetDetailModalProps) {
  const rows = useMemo(() => {
    if (!asset) return [];
    return [
      { label: '类型', value: typeLabel[asset.type] ?? asset.type },
      { label: '来源', value: sourceLabel(asset.source) },
      {
        label: '尺寸',
        value:
          asset.width != null && asset.height != null
            ? `${asset.width} × ${asset.height} px`
            : '—',
      },
      {
        label: '时长',
        value:
          asset.type === 'audio' || asset.type === 'video'
            ? formatDuration(asset.duration)
            : '—',
      },
      { label: '创建时间', value: formatDate(asset.created_at) },
      { label: '文件大小', value: formatSize(asset.size) },
    ];
  }, [asset]);

  if (!asset) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <h3 className={styles.title}>资产详情</h3>
          <button className={styles.closeBtn} onClick={onClose} title="关闭" aria-label="关闭">
            ✕
          </button>
        </div>

        <div className={styles.preview}>
          {asset.url ? (
            <AssetMedia asset={asset} />
          ) : (
            <div className={styles.previewEmpty}>资源不可用</div>
          )}
        </div>

        <dl className={styles.fields}>
          {rows.map((r) => (
            <div key={r.label} className={styles.fieldRow}>
              <dt className={styles.fieldLabel}>{r.label}</dt>
              <dd className={styles.fieldValue}>{r.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: 实现 `index.module.css`**

```css
/* ============================================
 * AssetDetailModal 资产详情弹窗样式（对齐 ConfirmModal 遮罩模式）
 * ============================================ */
.overlay {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--z-modal);
  animation: overlayFadeIn 0.2s ease;
}

@keyframes overlayFadeIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}

.modal {
  width: 560px;
  max-width: 92vw;
  max-height: 85vh;
  background-color: #1a1a1a;
  border: 1px solid var(--color-border-primary);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  padding: var(--spacing-xl);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: modalSlideIn 0.25s ease;
}

@keyframes modalSlideIn {
  from {
    opacity: 0;
    transform: translateY(12px) scale(0.97);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacing-md);
}

.title {
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--color-text-primary);
}

.closeBtn {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-full);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  background: transparent;
  transition: all var(--transition-fast);
}

.closeBtn:hover {
  color: var(--color-text-primary);
  background-color: var(--color-bg-hover);
}

.preview {
  width: 100%;
  height: 320px;
  flex-shrink: 0;
  border-radius: var(--radius-md);
  overflow: hidden;
  background-color: var(--color-bg-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 弹窗预览用 contain（Assets 网格缩略图是 cover），优先级高于 AssetMedia 内部 .media */
.preview :global(img),
.preview :global(video) {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.previewEmpty {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-md);
}

.fields {
  margin: var(--spacing-lg) 0 0;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  overflow-y: auto;
}

.fieldRow {
  display: flex;
  align-items: baseline;
  gap: var(--spacing-md);
}

.fieldLabel {
  flex: 0 0 72px;
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
}

.fieldValue {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  word-break: break-all;
}
```

- [ ] **Step 9: 运行确认通过**

```bash
cd web && npx vitest run src/components/AssetDetailModal
```

Expected: PASS（format 4 个 + modal 5 个用例）。

- [ ] **Step 10: Commit**

```bash
git add web/src/components/AssetDetailModal
git commit -m "feat: 新增资产详情弹窗（媒体预览 + 可读字段，不展示原始 JSON）"
```

---

## Task 5: Assets 页接入弹窗

**Files:**
- Modify: `web/src/pages/Assets/index.tsx`

- [ ] **Step 1: 加状态与卡片点击**

`Assets/index.tsx` 中：

1. import 追加：`import AssetDetailModal from '@/components/AssetDetailModal';`
2. state 区（`deleteTarget` 旁）追加：

```ts
  const [detailTarget, setDetailTarget] = useState<AssetRecord | null>(null);
```

3. 卡片 `div`（`<div key={String(asset.id)} className={styles.card}>`）加点击：

```tsx
              <div
                key={String(asset.id)}
                className={styles.card}
                onClick={() => setDetailTarget(asset)}
              >
```

（右上删除按钮已有 `e.stopPropagation()`，点击删除不会误开弹窗。）

4. 页面底部（`ConfirmModal` 之后）挂载：

```tsx
      {/* 资产详情弹窗 */}
      <AssetDetailModal asset={detailTarget} onClose={() => setDetailTarget(null)} />
```

- [ ] **Step 2: 验证**

```bash
cd web && npx tsc -b && npm test
```

Expected: 类型检查通过；全部现有测试 + 新增测试全绿。

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/Assets/index.tsx
git commit -m "feat: 资产库卡片点击打开详情弹窗"
```

---

## Task 6: 收口验证

- [ ] **Step 1: 全量单测**

```bash
# 仓库根（persistence 等 packages）
pnpm exec vitest run packages/persistence/src/asset-repo.test.ts
# web
cd web && npm test
```

Expected: 全绿。

- [ ] **Step 2: 类型检查**

```bash
cd web && npx tsc -b
```

Expected: 无错误。

- [ ] **Step 3: lint（web）**

```bash
cd web && npm run lint
```

Expected: 无错误（或仅存量告警）。

- [ ] **Step 4: 手测清单（dev 连测试站）**

```bash
# 起 SSH 隧道（见 CLAUDE.md 步骤 2）后：
cd E:/IDEA_Programme/new/blue-whale-ai && \
  CI=true DATABASE_URL="mysql://root:b3f9b3c44dda7225a88c90903df84c5818d964ce23c56be5@127.0.0.1:13306/blue_whale" \
  pnpm --dir blue_whale_web dev
```

验证：
1. 资产库点图片卡片 → 弹窗显示媒体 + 类型/来源/尺寸/时长/创建时间/文件大小
2. 点视频/音频卡片 → 预览可播放
3. 点右上删除按钮 → 不误开弹窗，删除确认正常
4. 遮罩点击 / ✕ / 关闭后再次点击可重开
5. AI 生成资产（source=generated）→ 来源显示「AI 生成」
6. 弹窗内不出现任何原始 JSON 键名

- [ ] **Step 5: PR 前验证（按 testing-strategy.md 分层）**

```bash
# 按影响面分层验证；PR 前跑对应 --stage pr 门禁（具体命令按 docs/agents/testing-strategy.md）
```

- [ ] **Step 6: 提交收口 + 走 PR 流程**

```bash
# worktree 内全部任务已提交；按 docs/agents/git-workflow.md 走 PR → merge（禁 squash/rebase）
```

---

## 自检记录

**1. Spec 覆盖**（对照 `2026-08-24-asset-detail-modal-design.md`）：
- 架构（内存数据、零额外请求）→ Task 5 用已拉取 records，Task 1 扩展列表接口 ✓
- 新组件 AssetDetailModal + 可读字段 → Task 4 ✓
- 卡片点击 + 挂载 → Task 5 ✓
- AssetRecord 类型扩展 → Task 2 ✓
- 后端 AssetView/listByUser 补字段 → Task 1 ✓
- 部署库列缺失核实 → Task 1 Step 1 ✓
- 错误处理（null → —、媒体三态、未知来源原始值）→ Task 4 format.ts + 组件 ✓
- 测试（前端格式化单测 + 弹窗冒烟 + 后端断言 + 手测）→ Task 1/4/6 ✓
- YAGNI 边界（不展示 JSON、仅资产库入口、不新增详情接口）→ 全计划无越界项 ✓

**2. 占位符扫描**：无 TBD/TODO/"适当处理"类占位；每个代码步骤含完整代码 ✓

**3. 类型一致性**：
- `AssetRecord` 新字段名 `size/generation_job_id/project_id/mime` 在 Task 2（前端类型）、Task 1（后端返回）、Task 4（formatSize 消费 size）、Task 5（无消费）全程一致 ✓
- `AssetView`（后端）与 `AssetRecord`（前端）字段名一致，类型：后端 `size: number | null` → 前端 `size: number | null`；后端 `generation_job_id/project_id: string | null` → 前端一致 ✓
- 组件 props：`AssetDetailModal({ asset, onClose })` 在 Task 4 定义与 Task 5 使用一致 ✓
- `AssetMedia` 导出名在 Task 3 定义与 Task 4/5 导入一致 ✓
