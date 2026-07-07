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

间距采用 4 的倍数尺度（4 / 8 / 12 / 16 / 24）。

## Elevation & Depth

无传统阴影系统；**层次靠背景明度差与边框透明度表达**：

- 提升一级 = 背景从 `bg-canvas` → `bg-surface` → `bg-elevated`。
- 边框透明度从 `border-subtle (0.08)` → `border (0.1)` → `border-active (0.16)` 递进。
- 选中态用 `ring` 描边 + 多层 box-shadow（见 `--tc-card-selected-shadow`）。

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
- ❌ 不要引入第二个品牌强调色（保持单色强调）。
- ❌ 不要用纯白之外的浅色作为大块背景（破坏黑底基调）。
- ❌ 不要在组件里硬编码 hex/rgba 值，所有值走 token。
- ⚠️ 豁免：`login-primary (#4e40f3)` 是与 `accent` 并列的登录专用强调色，仅用于 `LoginModal` 的「登录」按钮（复刻 topview.ai 风格）。这是项目内唯一允许的第二品牌色，且仅此一处；其他场景仍坚持单色强调（accent）。
