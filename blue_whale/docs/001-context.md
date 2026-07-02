# 项目上下文 001

## 时间
2026-06-30

## 核心框架
- Next.js 14+ (App Router) — React Server Components + 客户端组件混合渲染
- Turbopack — Rust 原生打包器，替代 Webpack
- React 18+ — RSC 架构最低要求

## 样式方案
- Tailwind CSS v3.4 — 原子化 CSS，class 策略暗色模式
- Emotion — CSS-in-JS，处理动态/主题化样式

## 关键依赖
| 用途     | 依赖                         |
|----------|------------------------------|
| 图标     | Lucide React                 |
| 动画     | Framer Motion                |
| 图表     | D3.js                        |
| 表单校验 | Joi                          |
| 组件库   | 自研（非 shadcn/ui / Radix） |

## 部署 & 基础设施
- Vercel 部署（server: Vercel）
- AWS CloudFront CDN 分发静态资源
- WebP 图片优化
- 安全头：X-Frame-Options: DENY / HSTS / strict-origin

## 其他
- 要求全程 git
- 要求全程以 .md 格式保存上下文，文件序号降序

## 当前状态
- Git 仓库已初始化
- docs 目录已创建
- 本文件为第 1 份上下文记录
