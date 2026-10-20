# 前端开发规范（web/）

适用范围：`web/`。目录分工见第 12 节。

本规范约束**新加和本任务改到的代码**。存量不合格处不要求立刻改，后续优化时再收。不要为遵守本规范去扩大无关改动。

---

## 1. 依赖克制

能用现有组件和模式解决的，不引入新库、新抽象。

新增依赖须说明：解决什么问题、现有方案为何不够、体积与维护成本。未经评审不得加入。

### 1.1 C 端组件与提示

- C 端新增组件必须使用已引入的 Radix 原语及其现有封装，禁止再自写一套同等交互 DOM。公共组件放 `custom/components/`；页面里新增的同类弹层、下拉、选择、标签、互斥按钮组同样走封装，不要 `createPortal` 另起一套。
- 现有封装：Dialog → `Modal`；Dropdown Menu → `DropdownMenu`；Select → `Select`；Tabs → `Tabs`；Toggle Group → `RatioGroup`。已有封装能覆盖的直接复用，不要并行再包一层。
- 提示（toast）统一使用 sonner。业务侧走 `@/custom/components/Toast`（`toast` / `showToast`）；根布局继续挂 sonner `Toaster`。禁止引入其他 toast 库，禁止页面自写提示条替代。
- 没有对应 Radix 包或现有封装的纯展示控件仍可自写。新增 `@radix-ui/*` 包仍须按第 1 节评审。存量不合格处不要求本任务顺手改。

---

## 2. 类型即契约

- 遵守 `strict`。
- 禁止 `any` 和 `as unknown as T`。例外：对接不可改的第三方类型，且收口在一个适配函数里。
- Props、API DTO、领域对象显式声明；组件 Props 命名为 `XxxProps`。
- 入参超过 3 个且含义易混时，改为对象参数。
- 名称写清含义：`userId`、`isSubmitDisabled`。禁止 `d`、`tmp`、`flag`、`data1`。
- 接口入参 / 出参与对应 `api/` 类型对齐。

类型检查跟构建走：`tsc -b`（现有 `build:*` 已包含）。

---

## 3. 命名

标识符小驼峰。例外：

| 种类 | 规则 |
| --- | --- |
| React 组件 | PascalCase |
| 自定义 Hook | `use` + PascalCase |
| 类型 / 接口 | PascalCase（`XxxProps`） |
| 页面 / 组件目录 | PascalCase（`CanvasPage`、`ConfirmModal`） |
| 模块文件 | camelCase（`videoMediaRefs.ts`） |
| CSS class | 小驼峰（`toolbar`、`primaryButton`） |

新文件跟所在目录的现有命名，不另起一套。

---

## 4. 注释

不新增普通代码注释（含行内说明、分段说明、TODO、解释性 JSDoc）。仅保留工具指令和许可证。改到已有普通注释时删除，不改写。详见 `agent-rules/code-comments.md`。

---

## 5. 样式与视觉

### 5.1 颜色

- C 端（`custom/`）：禁止蓝色底按钮、蓝色底图标。主操作、次操作、图标按钮统一灰色底（含 hover / active / disabled）。强调用字重、描边、灰阶，不用品牌蓝填充。
- B 端（`admin/`）：允许蓝色按钮与蓝底。此例外只作用于 `admin/`。

### 5.2 CSS

- class 名小驼峰；不写 `!important`（覆盖第三方时用局部覆盖层）。
- 颜色、圆角、间距优先用 CSS 变量；没有再补变量，禁止魔法数。

### 5.3 布局

- 布局壳负责导航 / 留白，页面负责内容。
- 关键工作台至少验证桌面主分辨率；弹层在小高度窗口可滚动。

毛玻璃、滚动列表、卡片网格的合成层问题，按 `frontend-styling` 技能处理，不在本文件展开。

---

## 6. API 与数据边界

- 信封 `{ code, data, msg }`。`code === 200` 才用 `data`；否则抛错并展示 `msg`。默认 toast 和 `silent` 走 `web/src/shared/api/http.ts`。不需打断用户的请求用 `silent`，由页面自己处理。
- 一领域一模块；函数名「动词 + 资源」（`listSharedAssets`）。API 文件不渲染 UI、不 toast。
- 页面不直接 `fetch`。新读写走对应端的 `api/` + Query。修存量缺陷时，不顺手把旧的 `useEffect` 拉数改成 Query。
- 预签名上传、SSE / 流式、媒体二进制等非信封传输，可在对应 `api/` 或专用工具里用 `fetch`，页面仍不直接 `fetch`。
- 401 / 登录失效走统一鉴权提示，不在各页复制跳转。
- 生成、删除、支付等变更必须有 loading，防重复提交。
- 金额、积分、权限以服务端为准，前端只做预检和展示。
- 网络错误、权限、空数据、加载中都有明确 UI，不静默吞错。

---

## 7. 状态管理

### 7.1 服务端状态（TanStack Query）

- 读：`useQuery` + `queryOptions`。`queryKey` 用资源旁的 key factory，不要手写零散字符串。
- 写：`useMutation`；成功后 `invalidateQueries` 或精确 `setQueryData`。禁止再维护一份「接口副本 state」。
- 轮询 / 聚焦刷新只在「用户正在看、数据会变」时开。
- 卸载后的请求交给 Query，不手写 `cancelled`（非 Query 长任务除外）。

细则见 frontend-delivery 的 `references/request.md`。其中过时的 `web/src/api/` 路径以本文件第 6、12 节为准。

### 7.2 客户端状态

- 仅登录会话、全局弹窗门面、跨路由草稿用 Zustand；单表单 / 单弹层用 `useState` / `useReducer`。
- Store 方法表达意图：`openLoginModal`。禁止到处 `setX(true)`。
- 不把服务端列表全量塞进 Zustand。

### 7.3 派生数据

能算出来的不存第二份（选中 id → 对象、过滤列表）。

---

## 8. 性能（按需）

- 重页面走路由级代码分割，不绑进首屏公共包。
- 大列表用现有虚拟列表（masonic），不要新引入同类库。
- 图片 / 视频给明确尺寸或容器，避免布局抖动。
- 媒体 URL 注意缓存与鉴权；不在 render 里反复 `new` 对象。

`memo` / `useMemo` / `useCallback` 仅在实测卡顿时加。

---

## 9. 安全与内容

- 用户 HTML / Markdown 必须经现有 DOMPurify；禁止把接口字段直接灌进 `dangerouslySetInnerHTML`。
- token 只走现有 `shared/api/sessionToken`，不新增存储通道；密钥不写进前端代码。
- 外链 `target="_blank"` 带 `rel="noopener noreferrer"`。
- 上传校验类型与大小，与后端一致。

---

## 10. 无障碍与交互

- 弹层打开聚焦、关闭还原；Esc 关闭与现有 Dialog 一致。
- 不只用颜色表达状态（失败 / 成功要有文字）。
- 可点击区域足够大；禁用态不可点，并说明原因。

---

## 11. 数字、构建

- 数字、时长、积分带明确单位。展示精度与提交精度分开，避免浮点直接比较。
- Vite 环境：`dev` / `test` / `release`（及 `production`）。

---

## 12. 目录与分层

| 目录 | 放什么 |
| --- | --- |
| `custom/` | C 端页面与组件 |
| `admin/` | B 端管理后台 |
| `shared/` | 两端共用：http 封装、router、seo、stores、utils、assets、两端通用枚举 |

各端内部按需使用：`api/` `components/` `layouts/` `pages/` `stores/` `styles/` `utils/`。C 端 API 放 `custom/api/`，B 端放 `admin/api/`，共享传输层放 `shared/api/`。

- C 端组件只放 `custom/components/`，B 端只放 `admin/components/`（及 `admin/ui/`）。两端组件不互相引用，不抽到 `shared/`。
- 新增枚举先搜 `shared/enums/`、`admin/enums/`、`custom/enums/`，能复用则复用。两端通用放 `shared/enums/`，仅 B / 仅 C 放对应端，不跨模块的留在原地。单模块内联 `as const` 不动。
- 同一作用域已有 `utils/` 时不要再加 `lib/`。
- 页面私有组件不进 `custom/components/` / `admin/components/`，除非至少两个页面真实复用。页面自己的 `components/` 仍放该页私有 UI。
- 单文件约超 1000 行，或职责超过展示 / 逻辑 / 纯函数中的两类，再拆。

### 12.1 CanvasPage

路径：`web/src/custom/pages/CanvasPage/`。根目录只保留入口（`index.tsx`、入口样式、入口测试）。新逻辑按表落子目录，禁止写入根 `index.tsx`。

| 目录 | 放什么 |
| --- | --- |
| `components/` | 页面私有 UI（节点、Dock、弹层、工具条） |
| `hooks/` | 页面 hook。再按 `agent` / `chrome` / `document` / `generation` / `shared` / `tools` 分 |
| `tools/` | 工具会话与面板逻辑。再按 `audio` / `image` / `video` / `compound` 分 |
| `generation/` | 生成运行时、Dock 协调、任务定义 |
| `graph/` | 节点、连线、对齐、草稿落点 |
| `media/` | 媒体引用、提取、远程拉取 |
| `assets/` | 资产库、角色库、打包下载 |
| `agent/` | Agent 侧纯逻辑（非 hook） |
| `tool-runtime/` | 工具注册与会话协调。存量 kebab 名，新目录不要再 kebab |
| `testing/`、`__fixtures__/` | 跨模块的页面级测试与夹具。单模块测试跟源码放一起 |

对不上上表时，跟职责最近的现有目录，不要在根上再摊文件。

---

## 13. 路由与权限

- 路由表集中定义，路径用常量，禁止字符串散落。
- 需登录的页面在布局 / 守卫处理；页面内只处理「已登录但缺权限」。
- 跳转带必要 query（项目 id、资产 id）；可恢复的状态不只放内存。
- React Router 7，页面级路由，不在业务组件硬拼 URL。

---

## 14. 交付自检

- 主路径可走通（打开、操作、成功 / 失败反馈）。
- 空数据、加载、错误一眼能懂。
- 共享同一份数据的相关页面，改完都看过。
- oxlint 通过；`tsc -b` 能过。
