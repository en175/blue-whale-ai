# 034-context — 网页打不开 / 生产构建因 Google 字体下载失败

## 问题现象
点击弹窗功能做完后，访问网页出现：

- `npm start`（生产模式）启动时报：
  ```
  Error: Could not find a production build in the '.next' directory.
  ```
- `npm run build` 报：
  ```
  Error while requesting resource
  https://fonts.gstatic.com/s/outfit/v15/...
  Module not found: Can't resolve '@vercel/turbopack-next/internal/font/google/font'
  ```
- 结果：`.next` 没有产物，`npm start` 起不来，网页 404/无法访问。

## 根因
`app/layout.tsx` 使用了 `next/font/google` 的 `Outfit`：

```ts
import { Outfit } from "next/font/google";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});
```

`next/font/google` 在**生产构建**时会去 `fonts.gstatic.com` 下载字体文件。当前环境无法访问该地址，构建失败，导致 `.next` 没有可用产物，`npm start` 自然起不来。

> 开发模式 `npm run dev` 不强制下载，所以之前 dev 下网页是能打开的。

## 解决方案
移除对 `next/font/google` 的依赖，改用系统字体栈，保证构建在离线/受限网络下也能通过：

### 1. `app/layout.tsx`
- 删除 `import { Outfit } from "next/font/google"`。
- 删除 `outfit` 字体实例。
- `<html>` 上不再挂 `outfit.variable`。

### 2. `tailwind.config.ts`
- `fontFamily.outfit` 去掉 `var(--font-outfit)`，改为：
  ```ts
  outfit: ["Outfit", "ui-sans-serif", "system-ui", "sans-serif"]
  ```
- 这样原来用到 `font-outfit`（如 `app/page.tsx` 的标题）和 `--font-outfit` 的地方仍能正常回退到系统字体，视觉差异极小。

## 验证
```bash
rm -rf .next
npm run build   # 通过，不再请求 Google 字体
npm run start   # Ready，/ 与 /canvas 均 HTTP 200
```

并用 Playwright 在生产模式下验证图像 Dock 弹窗：点击设置 Pill 后弹窗正常打开，控制台无 error / warning。

## 关键文件
- `app/layout.tsx`
- `tailwind.config.ts`

## 备注
- 如果以后需要恢复 Outfit 网络字体，可以换成 `next/font/local` 自托管字体文件，避免构建期联网。
- 该修复与图像模型弹窗（见 `docs/033-context.md`）是独立的，但都是在排查「打不开」时一起发现并修复的。
