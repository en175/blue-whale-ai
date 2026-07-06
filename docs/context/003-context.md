# 项目上下文 003

## 时间
2026-06-30

## 本次任务
修复 AgentComposer 输入框 placeholder 重叠问题，并通过 Playwright 截图验证页面效果。

## 问题描述
在 `docs/preview.png` 截图中发现输入框同时显示了两个 placeholder：
1. 通过 CSS `content: attr(data-placeholder)` 显示的底层提示
2. 绝对定位 div 中显示的 `让 Topview 设计一条 UGC 风格带货视频▏`

两者叠加导致文字混乱。

## 修复方案
- 移除 `components/AgentComposer.tsx` 中 `contenteditable` 的 `data-placeholder` 属性
- 移除 `app/globals.css` 中 `.tc-agent-composer-editor:empty::before` 的 CSS 规则
- 保留绝对定位的 placeholder div，与原 HTML 行为一致

## 验证结果
- `npm run build` 成功
- Playwright 全页截图显示 placeholder 已正常显示为单行文字
- 预览截图保存于 `docs/preview.png`

## 新增依赖
- `playwright` (devDependency) — 用于自动化截图验证

## Git 提交
待提交
