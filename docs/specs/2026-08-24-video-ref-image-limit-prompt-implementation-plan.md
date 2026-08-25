# 视频参考图超限前端提示 + 模型能力配置对齐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** web.master.xfai.cloud 视频生成入口（首页 ChatBox 视频tab + 画布 BottomDialog）在用户上传参考图超过对应模型限量时 toast「参考图最多 N 张，请减少图片」，并把三个 Seedance 2.0 视频模型 `features.max_reference_images` 配成 9（对齐官方上限）。

**Architecture:** 前端在两处上传处理函数里对超限截断补 toast（方案 A，就地改动，不动现有截断行为）；超限归因抽一个 ~15 行纯函数 `classifyRefOverflow` 作为可测接缝（满足本仓 scoped/web 的 Vitest 验证要求）。模型能力配置走测试库直接 SQL（JSON_SET 三行，可逆）。后端不改。

**Tech Stack:** React 19 + Vite（`web/`）、Vitest + jsdom、MySQL 8（测试库 115.190.244.91）。

## Global Constraints

- 范围仅限视频入口：ChatBox 视频tab + 画布 BottomDialog。**不动** AI图片tab（ChatBox `handleImageRefFiles`）、画布 ImageDialog、后端 `handle-create-generation-job.ts`、`DEFAULT_MAX_REFERENCE_IMAGES`、seedance-2.0-ep。
- 不改变现有上传/截断行为（保留前 N 张），只补超限 toast。
- toast 文案（对齐后端口径「参考图最多 N 张」）：
  - 图片超限：`参考图最多 ${N} 张，请减少图片`（N = 该模型 max_reference_images；首尾帧模式为 2）
  - 视频超限：`参考视频最多 3 个`
  - 首尾帧模式沿用现有「首尾帧模式需上传两张图片作为首帧与尾帧参考」/「首尾帧模式需要上传首帧和尾帧两张图片」，本计划不新增
- 配置 SQL 是对测试库的**写操作**，执行前必须经用户确认；还原 = `JSON_REMOVE(features, '$.max_reference_images')`。
- 可写任务先建 task worktree；master 保持干净。本计划用 `--no-issue`（无新工单号；如需挂 IKA72G 请替换）。
- 前端验证按 `scoped/web`：Web typecheck + Web Vitest `--changed`，收口与 PR 阶段走 `scripts/verify-change-scope.mjs`。

---

## Task 0: 建 task worktree

**Files:** 无（脚本生成）

- [ ] **Step 1: 从主 checkout 建工单分支工作区**

```bash
cd E:/IDEA_Programme/new/blue-whale-ai && scripts/start-task-worktree.sh --type fix --no-issue --summary "视频参考图超限前端提示"
```

Expected: 入口基于同步后的本地 master 精确 SHA 建中文任务分支并进入 worktree；输出 worktree 路径与分支名（形如 `fix/*视频参考图超限前端提示`）。

- [ ] **Step 2: 确认已进入 worktree 分支**

```bash
git branch --show-current && pwd
```

Expected: 分支名含中文简述；`pwd` 位于 `blue-whale-worktrees/` 下。后续 Task 2-5 的前端改动都在此 worktree 内进行。

---

## Task 1: 模型能力配置修正（三个 2.0 视频模型 max_reference_images = 9）

**Files:** 无（测试库数据修正，不落 git）

> 前提：前序会话已确认四个视频模型配置——三个 Seedance 2.0 模型 `max_reference_images` 均为 NULL（→兜底 10，超 Seedance 官方 9）；`seedance-2.0-ep` 已 `is_delete=1`（后台软删，不参与）。

- [ ] **Step 1: 起 SSH 隧道（CLAUDE.md 应急通道，端口 13306）**

```bash
ssh -i "C:/Users/54772/.ssh/weitian.pem" -N -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -o StrictHostKeyChecking=accept-new \
  -L 13306:127.0.0.1:3306 root@115.190.244.91
```

Run in background；确认 `netstat -ano | grep 13306` 有 LISTENING。

- [ ] **Step 2: 【用户确认】执行配置更新 SQL**

> 写操作，需用户批准后执行。只改三行 features 的 JSON，加一个键。

```sql
UPDATE blue_whale.generation_model_capability
SET features = JSON_SET(features, '$.max_reference_images', 9)
WHERE capability_type = 'video'
  AND is_delete = 0
  AND model_id IN (
    'doubao-seedance-2-0-260128',
    'doubao-seedance-2-0-fast-260128',
    'doubao-seedance-2-0-mini-260615'
  );
```

Expected: 影响 3 行（`Rows matched: 3, Changed: 3`）。

- [ ] **Step 3: 回读验证**

```bash
"D:/Program Files/MySQL/MySQL Server 8.0/bin/mysql.exe" -h 127.0.0.1 -P 13306 -u root -pb3f9b3c44dda7225a88c90903df84c5818d964ce23c56be5 --default-character-set=utf8mb4 -e "SELECT model_id, JSON_EXTRACT(features,'$.max_reference_images') AS max_ref FROM blue_whale.generation_model_capability WHERE capability_type='video' AND is_delete=0;"
```

Expected: 三兄弟 `max_ref` 均为 9；`seedance-2.0-ep`（is_delete=1）不出现。

- [ ] **Step 4: 断隧道（用完即断，ADR-0064）**

```bash
# 杀 ssh 进程，netstat 确认 13306 无 LISTENING
```

---

## Task 2: 参考图超限归因纯函数（TDD）

**Files:**
- Create: `web/src/utils/ref-overflow.ts`
- Test: `web/src/utils/ref-overflow.test.ts`

**Interfaces:**
- Produces: `classifyRefOverflow(params: { selectedImages: number; selectedVideos: number; acceptedImages: number; acceptedVideos: number }) => 'image' | 'video' | null` — 图片/视频各自按「选中数 − 接受数」计算丢弃数；丢弃图片>0 返回 `'image'`，否则丢弃视频>0 返回 `'video'`，均未丢弃返回 `null`。两处 handler 与 Task 3/4 依赖此签名。

- [ ] **Step 1: 写失败测试**

```ts
// web/src/utils/ref-overflow.test.ts
import { describe, expect, it } from 'vitest';
import { classifyRefOverflow } from './ref-overflow';

describe('classifyRefOverflow', () => {
  it('图片超限返回 image', () => {
    expect(
      classifyRefOverflow({ selectedImages: 4, selectedVideos: 0, acceptedImages: 2, acceptedVideos: 0 }),
    ).toBe('image');
  });

  it('视频超限返回 video', () => {
    expect(
      classifyRefOverflow({ selectedImages: 0, selectedVideos: 4, acceptedImages: 0, acceptedVideos: 3 }),
    ).toBe('video');
  });

  it('未超限返回 null', () => {
    expect(
      classifyRefOverflow({ selectedImages: 2, selectedVideos: 1, acceptedImages: 2, acceptedVideos: 1 }),
    ).toBe(null);
  });

  it('图片与视频同时超限优先 image', () => {
    expect(
      classifyRefOverflow({ selectedImages: 10, selectedVideos: 4, acceptedImages: 9, acceptedVideos: 3 }),
    ).toBe('image');
  });

  it('图片未超限但视频超限才报 video', () => {
    expect(
      classifyRefOverflow({ selectedImages: 1, selectedVideos: 5, acceptedImages: 1, acceptedVideos: 3 }),
    ).toBe('video');
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd E:/IDEA_Programme/new/blue-whale-ai/web && npx vitest run src/utils/ref-overflow.test.ts
```

Expected: FAIL，报 `classifyRefOverflow` 未导出/未定义。

- [ ] **Step 3: 写最小实现**

```ts
// web/src/utils/ref-overflow.ts
/** 参考素材超限归因：图片/视频各自按「选中数 − 接受数」判丢弃，供上传处理复用（toast 文案分层）。 */
export type RefOverflowType = 'image' | 'video';

export function classifyRefOverflow(params: {
  selectedImages: number;
  selectedVideos: number;
  acceptedImages: number;
  acceptedVideos: number;
}): RefOverflowType | null {
  const droppedImages = params.selectedImages - params.acceptedImages;
  const droppedVideos = params.selectedVideos - params.acceptedVideos;
  if (droppedImages > 0) return 'image';
  if (droppedVideos > 0) return 'video';
  return null;
}
```

- [ ] **Step 4: 运行确认通过**

```bash
cd E:/IDEA_Programme/new/blue-whale-ai/web && npx vitest run src/utils/ref-overflow.test.ts
```

Expected: 5 个用例全 PASS。

- [ ] **Step 5: Commit**

```bash
cd E:/IDEA_Programme/new/blue-whale-ai/web && git add src/utils/ref-overflow.ts src/utils/ref-overflow.test.ts && git commit -m "feat(web): 参考素材超限归因纯函数（图片/视频分层）"
```

---

## Task 3: 首页 ChatBox 视频tab 补超限 toast

**Files:**
- Modify: `web/src/pages/Home/components/ChatBox/index.tsx:504-527`（`handleRefFiles`）
- Import: `web/src/pages/Home/components/ChatBox/index.tsx` 顶部 `@/utils/ref-overflow`

**Interfaces:**
- Consumes: `classifyRefOverflow`（Task 2 签名）；本组件已有 `showToast`（:170）、`videoMaxImages`（:492-495）、`MAX_VIDEOS`（:36 附近常量）。

- [ ] **Step 1: 加 import**

```ts
// ChatBox/index.tsx 顶部 import 区追加
import { classifyRefOverflow } from '@/utils/ref-overflow';
```

- [ ] **Step 2: 改 handleRefFiles，截断后按归因 toast**

将 `:504-527` 的 `handleRefFiles` 替换为（保留原有 filter/截断逻辑，仅追加归因与 toast）：

```tsx
  const handleRefFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    let imgRoom = Math.max(0, videoMaxImages - videoRefImageCount);
    let vidRoom = Math.max(0, MAX_VIDEOS - videoRefVideoCount);
    const newFiles = files
      .filter((f) => {
        if (f.type.startsWith('video/')) {
          if (vidRoom <= 0) return false;
          vidRoom -= 1;
          return true;
        }
        if (imgRoom <= 0) return false;
        imgRoom -= 1;
        return true;
      })
      .map((file) => ({
        file,
        preview: URL.createObjectURL(file),
      }));
    const overflow = classifyRefOverflow({
      selectedImages: files.filter((f) => f.type.startsWith('image/')).length,
      selectedVideos: files.filter((f) => f.type.startsWith('video/')).length,
      acceptedImages: newFiles.filter((f) => f.file.type.startsWith('image/')).length,
      acceptedVideos: newFiles.filter((f) => f.file.type.startsWith('video/')).length,
    });
    if (overflow === 'image') showToast(`参考图最多 ${videoMaxImages} 张，请减少图片`);
    else if (overflow === 'video') showToast('参考视频最多 3 个');
    setRefFiles((prev) => [...prev, ...newFiles]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };
```

- [ ] **Step 3: 类型检查**

```bash
cd E:/IDEA_Programme/new/blue-whale-ai/web && npx tsc -b
```

Expected: 无类型错误。

- [ ] **Step 4: 跑 Vitest（含 Task 2 单测，确认改动不破坏）**

```bash
cd E:/IDEA_Programme/new/blue-whale-ai/web && npx vitest run --changed
```

Expected: PASS。

- [ ] **Step 5: 手测（dev 起前端指测试站后端）**

- 首页视频tab 全能参考模式：一次选 >N 张图 → 只保留前 N 张，toast「参考图最多 N 张，请减少图片」
- 一次选 >3 个视频 → 保留前 3 个，toast「参考视频最多 3 个」
- 未超限多选正常加入、无 toast
- 首尾帧模式行为不变（沿用现有校验）

- [ ] **Step 6: Commit**

```bash
cd E:/IDEA_Programme/new/blue-whale-ai/web && git add src/pages/Home/components/ChatBox/index.tsx && git commit -m "feat(web): 首页视频参考图超限 toast 提示减少图片"
```

---

## Task 4: 画布 BottomDialog 补超限 toast

**Files:**
- Modify: `web/src/pages/CanvasPage/components/BottomDialog/index.tsx`
  - `:227-236`（`handleImageClick` / `handleVideoClick`）
  - `:300-333`（`addFiles`）
  - `:195-205`（`externalImagePick` effect）
- Import: 顶部 `@/utils/ref-overflow`

**Interfaces:**
- Consumes: `classifyRefOverflow`（Task 2）；组件已有 `showToast`（:117-121）、`maxImages`（:143，keyframe 为 2 否则 max_reference_images）、`MAX_VIDEOS`（:35）、`isKeyframe`（:137）、`refFiles`/`imageCount`/`videoCount`。

- [ ] **Step 1: 加 import**

```ts
// BottomDialog/index.tsx 顶部 import 区追加
import { classifyRefOverflow } from '@/utils/ref-overflow';
```

- [ ] **Step 2: addFiles 截断后按归因 toast**

在 `addFiles` 内 `list` 计算完成后、`if (!list.length) return;` 之前插入：

```tsx
    const acceptedImgs = list.filter((f) => f.type === 'image').length;
    const acceptedVids = list.filter((f) => f.type === 'video').length;
    const overflow = classifyRefOverflow({
      selectedImages: all.filter((f) => f.type.startsWith('image/')).length,
      selectedVideos: all.filter((f) => f.type.startsWith('video/')).length,
      acceptedImages: acceptedImgs,
      acceptedVideos: acceptedVids,
    });
    if (overflow === 'image') showToast(`参考图最多 ${maxImages} 张，请减少图片`);
    else if (overflow === 'video') showToast('参考视频最多 3 个');
```

> 注：`list` 项为 `BottomRefItem`（`type` 已归一化为 `'image'|'video'`），`all` 为原生 `File[]`（用 `file.type.startsWith`）。`maxImages` 在 keyframe 模式为 2，文案自然对齐。

- [ ] **Step 3: handleImageClick / handleVideoClick 达上限 toast**

替换 `:227-236` 为：

```tsx
  /** 上传图片（首尾帧模式限 2 张；达上限 toast） */
  const handleImageClick = () => {
    if (imageCount < maxImages) imageInputRef.current?.click();
    else showToast(`参考图最多 ${maxImages} 张，请减少图片`);
  };

  /** 上传视频（首尾帧模式禁用；达上限 toast） */
  const handleVideoClick = () => {
    if (isKeyframe) return;
    if (videoCount < MAX_VIDEOS) videoInputRef.current?.click();
    else showToast('参考视频最多 3 个');
  };
```

- [ ] **Step 4: externalImagePick（画布节点带入图片）达上限 toast**

替换 `:195-205` effect 为：

```tsx
  // 画布节点选取结果注入参考图片（去重 + 上限保护；首尾帧模式同样适用）
  useEffect(() => {
    if (!externalImagePick) return;
    const item = externalImagePick.item;
    const imgCount = refFiles.filter((f) => f.type === 'image').length;
    if (imgCount >= maxImages) {
      showToast(`参考图最多 ${maxImages} 张，请减少图片`);
      return;
    }
    setRefFiles((prev) => {
      const imgCnt = prev.filter((f) => f.type === 'image').length;
      if (imgCnt >= maxImages) return prev;
      if (prev.some((f) => (item.assetId != null && f.assetId === item.assetId) || f.preview === item.preview)) return prev;
      return [...prev, item];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalImagePick]);
```

- [ ] **Step 5: 类型检查 + Vitest**

```bash
cd E:/IDEA_Programme/new/blue-whale-ai/web && npx tsc -b && npx vitest run --changed
```

Expected: 无类型错误，PASS。

- [ ] **Step 6: 手测（画布视频弹窗）**

- 全能参考上传 >N 张图 → toast；上传 >3 个视频 → toast
- 已达上限点图片/视频上传按钮 → toast，不再静默
- 从画布节点带入图片达上限 → toast
- 首尾帧模式：上传第 3 张图 → toast「参考图最多 2 张，请减少图片」；发送校验沿用现有文案

- [ ] **Step 7: Commit**

```bash
cd E:/IDEA_Programme/new/blue-whale-ai/web && git add src/pages/CanvasPage/components/BottomDialog/index.tsx && git commit -m "feat(web): 画布视频弹窗参考图超限 toast 提示减少图片"
```

---

## Task 5: 收口验证 + PR

**Files:** 无新增代码

- [ ] **Step 1: 收口阶段验证（verify-change-scope）**

```bash
cd E:/IDEA_Programme/new/blue-whale-ai && node scripts/verify-change-scope.mjs run
node scripts/verify-change-scope.mjs check --json
```

Expected: 分层为 `scoped/web`（若识别为 web 影响面）；`check` 输出 `VERIFIED`。

> 若识别为其他层级按 `docs/agents/testing-strategy.md` 执行对应最低验证。

- [ ] **Step 2: PR 阶段验证 + 发布门禁**

```bash
node scripts/verify-change-scope.mjs run --stage pr
node scripts/verify-change-scope.mjs check --stage pr --json
```

Expected: PR 阶段凭证 `passed`；`check --stage pr` 通过。

- [ ] **Step 3: 提交任务 diff 并建 PR**

```bash
# 用仓库标准入口提交（在 worktree 内）：
scripts/commit-task-for-review.sh -m "feat(web): 视频参考图超限前端提示 + 配置对齐说明"
```

> 若收口脚本已提交，则跳过。PR 由 `finishing-a-development-branch` / `requesting-code-review` 技能引导；PR 前把配置 SQL（Task 1 已执行）在 PR 描述中注明，供 reviewer 核对。

- [ ] **Step 4: 上线后复核**

- 部署后 `GET /api/generation/models?capability=video` 三兄弟 `max_reference_images=9`
- 首页/画布视频入口超限 toast 生效

---

## Self-Review 结论（写计划时已核对）

1. **Spec 覆盖**：前端提示（ChatBox + BottomDialog）→ Task 3/4；配置对齐三兄弟=9 → Task 1；toast 文案 / 范围边界 / 不做的事 → Global Constraints 全覆盖。
2. **占位符**：所有代码步均含可执行代码与精确路径，无 TBD。
3. **类型一致**：`classifyRefOverflow` 签名在 Task 2 定义、Task 3/4 消费一致；`maxImages`/`videoMaxImages`/`MAX_VIDEOS` 均为两组件既有变量，命名与现状一致。
