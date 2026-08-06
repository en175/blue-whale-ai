---
version: alpha
name: Blue-Whale
description: 面向 AI Agent / Canvas 交互的深色工作台设计系统。黑底多层灰阶 surface，单一蓝色强调，Outfit 字体。
colors:
  # 背景层（由深到浅）
  bg-canvas: "#000000"
  background: "#0a0a0a"
  bg-surface: "#1a1a1a"
  bg-elevated: "#2a2a2a"
  bg-overlay: "rgba(0, 0, 0, 0.72)"
  # 前景文字（语义层级）
  primary: "#ffffff"
  secondary: "rgba(255, 255, 255, 0.7)"
  tertiary: "rgba(255, 255, 255, 0.55)"
  muted: "rgba(255, 255, 255, 0.4)"
  # 边框
  border: "rgba(255, 255, 255, 0.1)"
  border-subtle: "rgba(255, 255, 255, 0.08)"
  border-active: "rgba(255, 255, 255, 0.16)"
  # 强调与语义
  accent: "#3b82f6"
  ring: "rgba(59, 130, 246, 0.5)"
  success: "#22c55e"
  destructive: "#ef4444"
  on-accent: "#ffffff"
  # 登录主色（豁免：与 accent 并列的登录专用强调色，复刻 topview.ai 登录主色，仅 LoginModal 登录按钮使用，项目内孤例）
  login-primary: "#4e40f3"
  # 登录弹窗专用色
  login-modal-bg: "#141414"
  login-primary-hover: "#3d33d1"
  # Dock 组件层级（IK5JV5：VideoDockContent / config 硬编码替换）
  dock-text-strong: "rgba(255, 255, 255, 0.85)"
  dock-text: "rgba(255, 255, 255, 0.72)"
  dock-text-label: "rgba(255, 255, 255, 0.65)"
  dock-text-hint: "rgba(255, 255, 255, 0.62)"
  dock-text-caption: "rgba(255, 255, 255, 0.45)"
  dock-text-faint: "rgba(255, 255, 255, 0.35)"
  dock-text-disabled: "rgba(255, 255, 255, 0.32)"
  dock-text-placeholder: "rgba(255, 255, 255, 0.3)"
  dock-text-ghost: "rgba(255, 255, 255, 0.22)"
  dock-fill: "rgba(255, 255, 255, 0.07)"
  dock-fill-subtle: "rgba(255, 255, 255, 0.06)"
  dock-fill-ghost: "rgba(255, 255, 255, 0.043)"
  dock-fill-faint: "rgba(255, 255, 255, 0.04)"
  dock-border-ghost: "rgba(255, 255, 255, 0.02)"
  dock-divider: "rgba(255, 255, 255, 0.07)"
  dock-toggle-on: "rgba(255, 255, 255, 0.5)"
  dock-toggle-off: "rgba(255, 255, 255, 0.15)"
  dock-popover-bg: "rgba(41, 41, 41, 0.92)"
  dock-popup-bg: "rgb(30, 30, 30)"
  dock-panel-bg: "rgb(29, 29, 29)"
  icon-stroke: "rgba(255, 255, 255, 0.8)"
typography:
  body-md:
    fontFamily: Outfit
    fontSize: 1rem
    lineHeight: 1.5
  body-sm:
    fontFamily: Outfit
    fontSize: 0.75rem
    lineHeight: 1.5
  label-caps:
    fontFamily: Outfit
    fontSize: 0.6875rem
    fontWeight: "500"
    letterSpacing: 0.02em
rounded:
  none: 0px
  sm: 2px
  md: 6px
  lg: 8px
  xl: 10px
  full: 9999px
spacing:
  none: 0px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
components:
  surface-canvas:
    backgroundColor: "{colors.bg-canvas}"
    textColor: "{colors.primary}"
  surface-base:
    backgroundColor: "{colors.background}"
    textColor: "{colors.primary}"
  surface-elevated:
    backgroundColor: "{colors.bg-elevated}"
    textColor: "{colors.primary}"
    rounded: "{rounded.lg}"
  panel-floating:
    backgroundColor: "{colors.bg-surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.lg}"
  scrim-overlay:
    backgroundColor: "{colors.bg-overlay}"
    textColor: "{colors.primary}"
  text-placeholder:
    backgroundColor: "{colors.bg-canvas}"
    textColor: "{colors.muted}"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.md}"
    padding: 12px
  button-primary-hover:
    backgroundColor: "{colors.ring}"
    textColor: "{colors.on-accent}"
  toggle-pill:
    backgroundColor: "{colors.border}"
    textColor: "{colors.primary}"
    rounded: "{rounded.full}"
    height: 24px
  toggle-pill-on:
    backgroundColor: "{colors.success}"
    textColor: "{colors.primary}"
    rounded: "{rounded.full}"
  status-destructive:
    backgroundColor: "{colors.destructive}"
    textColor: "{colors.on-accent}"
  button-login-primary:
    backgroundColor: "{colors.login-primary}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.lg}"
---

## Overview

Blue-Whale 是一个面向 AI Agent / Canvas 交互的纯客户端工作台。设计语言为
**"Quiet Machine"**——以纯黑画布为底，用克制的灰阶层级和单一蓝色强调，
让 AI 生成的内容（节点、图像、视频）成为视觉焦点，而 UI chrome 退到背景里。
整体观感应像一台专业创作工具，而非消费应用。

## Colors

调色板围绕「黑底 + 灰阶 + 单一强调」组织，刻意避免色彩喧宾夺主。

- **bg-canvas (#000000)**：画布最底层，纯黑，承载素材节点。
- **background (#0a0a0a)**：页面默认背景。
- **bg-surface (#1a1a1a) / bg-elevated (#2a2a2a)**：浮层、面板、Dock 的两级灰阶抬升。
- **login-modal-bg (#141414)**：登录弹窗卡片背景，介于 background 与 bg-surface 之间。
- **login-primary-hover (#3d33d1)**：登录按钮 hover 态，与 login-primary 同源。
- **primary (#ffffff) → muted (rgba 0.4)**：四级文字透明度，对应主/次/三级/弱化语义。
- **accent (#3b82f6)**：全局唯一交互强调色，用于主按钮、选中态、焦点环。
- **success (#22c55e) / destructive (#ef4444)**：仅用于状态语义（开关启用、销毁动作），不作装饰。

文字与背景的对比度普遍高于 WCAG AA 4.5:1；**muted (0.4) 仅用于占位符、
禁用态、辅助元信息**，不用于主要可读内容。

## Typography

全局使用 **Outfit** 字体（无衬线，几何感），通过 Tailwind `font-outfit` 应用。
中文/系统回退到 `ui-sans-serif, system-ui`。

- **body-md (1rem)**：正文默认。
- **body-sm (0.75rem)**：面板内密集信息、参数标签。
- **label-caps (0.6875rem, weight 500, 字距 0.02em)**：标签、Tab、表头等小字。

## Layout & Spacing

Canvas 工作台采用绝对定位的三区布局：左侧工具栏、底部生成 Dock、
右侧 AgentChatPanel。关键尺寸 token 已在 `globals.css` 中以
`--tc-agent-panel-width: 468px` 等形式定义，UI 实现应直接引用这些 CSS 变量。
全局左侧导航栏（`Sidebar.tsx`，canvas 路由自隐藏）宽度 token：`--tc-sidebar-width: 76px`（对标即梦窄图标栏：图标在上、小字在下垂直排列）。

间距采用 4 的倍数尺度（4 / 8 / 12 / 16 / 24）。

## Elevation & Depth

层次由**三个互补手段**表达：背景明度差、边框透明度递进、以及 shadow token 体系（浮层投影）。前两者承载常规层级；shadow token 专供需要脱离背景的浮层（modal、dropdown、卡片态等）。

### 明度与边框层级

- 提升一级 = 背景从 `bg-canvas` → `bg-surface` → `bg-elevated`。
- 边框透明度从 `border-subtle (0.08)` → `border (0.1)` → `border-active (0.16)` 递进。

### Shadow token 体系

浮层投影统一走 `--tc-<context>-shadow` 命名模式的 CSS 变量（定义在 `globals.css` `:root`，组件以 Tailwind 任意值 `shadow-[var(--tc-xxx-shadow)]` 引用，禁止内联 rgba）。`<context>` 表语义场景，不表数值。

语义层级表（投影强度由浅到深）：

| Token                       | 语义                     | 值（`globals.css` `:root`）    | 典型用途                                 |
| --------------------------- | ------------------------ | ------------------------------ | ---------------------------------------- |
| `--tc-menu-pill-shadow`     | 顶部菜单胶囊             | `0 8px 24px rgba(0,0,0,0.4)`   | TopBar menu-pill                         |
| `--tc-brand-logo-filter`    | 品牌鲸鱼 logo 悬浮      | `drop-shadow(0 1px 3px rgb(0 0 0/42%)) drop-shadow(0 0 7px rgb(59 130 246/14%))` | 顶栏/侧边栏透明 logo，filter 引用 |
| `--tc-dropdown-shadow`      | 下拉 / 弹出菜单（向下）  | `0 12px 32px rgba(0,0,0,0.4)`  | popover、下拉菜单（AgentComposer）       |
| `--tc-dropdown-shadow-up`   | 向上弹出下拉（底部触发） | `0 -12px 32px rgba(0,0,0,0.4)` | AgentComposer 向上 popover               |
| `--tc-modal-shadow`         | 全屏遮罩浮层             | `0 24px 80px rgba(0,0,0,0.5)`  | modal、大面板（LoginModal / SkillPanel） |
| `--tc-card-hover-shadow`    | 卡片 hover 抬升          | 多层 ring + 投影               | 卡片网格 hover                           |
| `--tc-card-selected-shadow` | 卡片选中态               | 多层 ring + 投影               | 卡片网格选中                             |
| `--tc-dock-popover-shadow`  | Dock 参考模式弹出        | `0 8px 24px rgba(0,0,0,0.6)`   | VideoDockContent refMode menu            |
| `--tc-dock-popup-shadow`    | Dock 设置/数量弹出       | `0 4px 16px rgba(0,0,0,0.25)`  | VideoDockContent settings / quantity     |
| `--tc-dock-knob-shadow`     | Dock 开关旋钮            | `0 1px 3px rgba(0,0,0,0.3)`    | VideoDockContent toggle knob             |
| `--tc-chrome-float-shadow`  | 节点浮动胶囊             | `0 4px 12px rgba(0,0,0,0.4)`   | ReferenceNode product chrome pill        |

> dropdown 向上弹出（底部触发的菜单）方向相反，用独立变体 token `--tc-dropdown-shadow-up`（`0 -12px 32px ...`）；`--tc-dropdown-shadow` 仅定义向下基础值。

新增浮层 shadow：先在语义层级表登记语义名 + 值，再在 `globals.css` `:root` 注册，最后组件引用。

### Shadow 判定清单（T2/T3/T4 替换依据）

并非所有阴影都该 token 化。判定：**重复出现 + 语义可复用** → token 化；**一次性装饰、值各异、配 transform 精心调校** → 豁免。

| 簇                                              | 现状锚点                                                                                                              | 判定                                                          | 归属                     |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------ |
| 全屏 modal / 大面板                             | LoginModal / SkillPanel `0 24px 80px rgba(0,0,0,0.5)` × 2                                                             | 重复 + 语义 → token                                           | T2 → `--tc-modal-shadow` |
| 下拉 / popover                                  | AgentComposer `0 12px 32px rgba(0,0,0,0.4)` × 8 向下 → `--tc-dropdown-shadow`；1 向上变体 → `--tc-dropdown-shadow-up` | 高重复 → token                                                | T3                       |
| 卡片 hover / 选中                               | `--tc-card-hover-shadow` / `--tc-card-selected-shadow`                                                                | 已 token，纳入文档不改值                                      | —                        |
| 顶部菜单胶囊                                    | TopBar `var(--tc-menu-pill-shadow)`                                                                                   | 已 token 引用                                                 | —                        |
| 旋转图片阴影                                    | TemplateCards 多处配 `rotate`，值各异                                                                                 | 装饰性一次性 → 豁免                                           | T4                       |
| 亮色按钮发光                                    | AgentComposer send 按钮 `0 2px 8px rgba(255,255,255,0.1)` × 3 + hover                                                 | 亮色控件发光（白色按钮浅投影），语义独立于暗色浮层体系 → 豁免 | T4                       |
| slider thumb / inset 分隔线 / popover 0.32 变体 | 单次或结构独特（`inset`、负 spread）                                                                                  | 装饰性 → 豁免                                                 | T4                       |

## Shapes

圆角尺度刻意小而克制，避免童趣感：常用 `md (6px)` / `lg (8px)`。
胶囊形（`full: 9999px`）仅用于开关、标签等小控件。

## Components

- **button-primary**：accent 底 + 白字，hover 切到 ring 色。
- **toggle-pill / toggle-pill-on**：技能开关，关闭=灰阶边框，开启=success 绿。
- **surface-***：三级背景容器，文字一律 primary。

新增组件应在 `components:` 下以语义名声明 token 映射，禁止内联硬编码颜色值。

## Do's and Don'ts

- ✅ 新增颜色必须先在 `colors:` 注册为 token，再在组件里用 `{colors.xxx}` 引用。
- ✅ 强调色只用 accent；状态色只用 success/destructive。
- ✅ 主要可读文字至少用 `secondary (0.7)` 透明度，避免使用 muted。
- ✅ 浮层投影用 `--tc-<context>-shadow` token（`shadow-[var(--tc-xxx-shadow)]`），新增浮层先在 Elevation 语义层级表登记 + `globals.css` 注册。
- ❌ 不要引入第二个品牌强调色（保持单色强调）。
- ❌ 不要用纯白之外的浅色作为大块背景（破坏黑底基调）。
- ❌ 不要在组件里硬编码 hex/rgba 值，所有值走 token。
- ⚠️ 豁免：装饰性一次性阴影（旋转图片、亮色控件发光、slider thumb、inset 分隔线）值各异且精心调校，不走 token，判定见 Elevation「Shadow 判定清单」。
- ⚠️ 豁免：`login-primary (#4e40f3)` 是与 `accent` 并列的登录专用强调色，仅用于 `LoginModal` 的「登录」按钮（复刻 topview.ai 风格）。这是项目内唯一允许的第二品牌色，且仅此一处；其他场景仍坚持单色强调（accent）。
