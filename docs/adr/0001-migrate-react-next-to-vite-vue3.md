# 将前端从 Next.js + React 整体重写为 Vite + Vue3

## Status

accepted

## Context

Blue-Whale 前端当前基于 Next.js 16 + React 19，约 6316 行代码，集中在
`app/canvas/page.tsx`（3474 行）与 `components/AgentComposer.tsx`（1584 行）两个
巨石文件。经代码审计确认：所有组件均为 `"use client"` 客户端组件，项目**没有使用任何
Next.js 的服务端能力**——无 API 路由、无 Server Actions、无 SSR 数据获取、无
`generateMetadata` 等。Next.js 在本项目中仅充当路由壳与 `next/image`。

## Decision

将前端**整体重写为 Vite + Vue3**（Vite + Vue Router + Pinia 按需），彻底移除 Next.js。

## Rationale

经 grilling 会话确认，决策的唯一拍板标准是：**维护者最熟悉 Vue3，React 存在较高学习
成本**。这是长期可维护性诉求，而非性能或架构诉求。在该标准下：

- Next.js 在本项目无不可替代能力 → 保留它只增加心智负担，应移除。
- 维护者愿意承担完整重写成本 → 形态定为整体重写而非渐进混用。
- React 的 Hooks（73 个 useState / 27 个 useEffect / 35 个 useRef）依赖数组心智模型，
  迁移到 Vue 响应式后可降低维护者的日常认知负担。

性能与生态成熟度**不构成**决策依据——对本项目类型（纯客户端 SPA），两者性能差异可忽略，
且只有维护者个人效率这一项真正重要。

## Considered Options

- **整体重写为 Vite + Vue3**（采纳）—— 最干净，与"纯 SPA"实际用法匹配。
- **Next.js 壳内混用 Vue（veaury 等）**（否决）—— 双框架混用复杂度高，违背"减负"初衷。
- **保留 React，克服学习成本**（否决）—— 与"我最熟 Vue"的拍板标准直接冲突。

## Consequences

- **样式**：保留 Tailwind CSS（零迁移成本）；移除 `@emotion/styled`，改用 Vue
  `<style scoped>` / CSS 变量。原本就是冗余双栈，借此收敛。
- **动画（最大单点风险）**：`framer-motion` 为 React 专属，迁移到 `motion-v` 或
  `@vueuse/motion`，API 不完全对等。开工前须先做动画可行性 spike，确认 `layout`
  动画 / `AnimatePresence` / 手势等高级特性能否平移；若不能，需接受重写动画的成本。
- **图标**：`lucide-react` → `lucide-vue-next`，API 同名，近乎零成本。
- **逻辑复用**：React Custom Hooks → Vue Composables，形态相近，迁移友好。注意
  `useEffect` 不要机械翻译——用 `watchEffect` 自动收集依赖，可省去依赖数组维护。
- **迁移顺序**：骨架 → 简单组件 → 动画 spike（关键决策点）→ 中等组件 → 最后啃
  canvas 巨石。

## 拆分策略：边重写边拆，不在 React 里预拆（重要）

**决策**：屎山的拆分与 Vue 重写**合并为同一动作**——先在 Vue 里设计模块边界，重写时按此
边界逐块翻译，天然完成拆分。**不**先在 React 代码库里做预拆分。

**为什么不预拆**（这个反直觉的判断必须记录，否则中途会有人想回去拆）：

1. **碰两次巨石**：先拆（产出 .tsx + Hooks）再重写（翻译成 .vue + Composables），
   等于对 3474 行 canvas 做两遍重活，且第一遍产出的 React 文件**注定全部丢弃**，
   是纯废料。
2. **翻译腔污染**：在 React 里拆出的边界（useEffect→useXxx、useState 状态提升、props
   透传）会固化思维。重写时下意识照搬到 Vue，产出一个"骨子里是 React"的 Vue 项目，
   既失去 Vue 简洁性，又白花拆分成本。正确顺序是**先用 Vue 思维设计边界，再写代码**。
3. **React 版已无维护价值**：迁移决策已 accepted，React 代码不再接需求，预拆只服务
   于一个即将废弃的代码库，ROI 为负。

**但有一个真实需求要接住**：维护者尚未完全读懂 3474 行 canvas 的业务逻辑。这不能靠
"预拆"解决，而应靠**重写前的"阅读 + 模块设计"阶段**解决——在动 Vue 手之前，先把 canvas
的业务职责（输入/输出/状态/副作用）列成清单，画出目标 Vue 模块结构，再逐块翻译。这是
"读懂"，不是"拆代码"。

### 修正后的迁移顺序

1. 搭 Vite + Vue3 + Tailwind 骨架
2. 迁简单组件（QuickTags / PromoCapsule）验证流水线
3. **动画 spike**（关键决策点）
4. 迁中等组件（SkillPanel / AgentComposer）
5. **canvas 阅读与模块设计**（产出 Vue 模块清单，不写 React）
6. 按模块清单逐块重写 canvas（边写边拆，一次成型）
