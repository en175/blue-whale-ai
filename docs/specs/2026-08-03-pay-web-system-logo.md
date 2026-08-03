# pay_web 系统 Logo 品牌规范（PRD）

日期：2026-08-03
关联工单：IK63NU
状态：首版

## 背景

`blue_whale_pay_web` 是从 Jeepay 搬运改造的支付前端套件，含三个子应用：
运营平台（`bluewhalepay-ui-manager`）、商户平台（`bluewhalepay-ui-merchant`）、
收银台（`bluewhalepay-ui-cashier`），统一品牌为 BlueWhalePay 蓝鲸支付。
改造前首屏加载页与登录页仍展示旧 Jeepay 横版字标（198×44 含文字），
侧边栏暂用品牌 favicon.ico 充当图标，需统一为蓝鲸图标。

## 品牌资源权威源

| 用途 | 资源 | 说明 |
| --- | --- | --- |
| **系统 logo（唯一）** | `https://bluewhale-assets.tos-cn-beijing.volces.com/blue-whale-api/blue_whale.svg` | 384×384 方形蓝鲸图标（SVG 包 base64 PNG，不含文字） |
| favicon | `https://bluewhale-assets.tos-cn-beijing.volces.com/blue-whale-api/favicon.ico` | 三个应用 `<link rel="icon">` 已应用，不在本 PRD 范围 |

资源托管于火山引擎 TOS 桶 `bluewhale-assets` 的 `blue-whale-api/` 前缀下（见 ADR-0057）。

## 应用矩阵

| 应用 | 位置 | 文件 | 展示规格 |
| --- | --- | --- | --- |
| manager | 首屏加载页 | `index.html` | `height: 50px`（方形渲染 50×50），下方配「蓝鲸支付」文字 |
| manager | 登录页头部 | `src/layouts/UserLayout.vue`、`src/views/user/Login.vue` | CSS `.logo { height: 44px }` |
| manager | 侧边栏（展开/收起两态） | `src/layouts/BasicLayout.vue` | 40×40，展开态配「BlueWhalePay」文字 |
| merchant | 首屏加载页 | `index.html` | 同 manager |
| merchant | 登录页头部 | `src/layouts/UserLayout.vue`、`src/views/user/Login.vue` | 同 manager（子系统名分别为「商户系统」「商户平台」） |
| merchant | 侧边栏（两态） | `src/layouts/BasicLayout.vue` | 同 manager |
| cashier | 无页面内 logo | — | 仅 `<title>` 与 favicon |

共 8 处引用（manager / merchant 各 4 处：index.html×1、BasicLayout.vue×2、登录页×2 文件各 1）。

## 规则

1. **引用方式**：一律硬编码绝对 CDN URL，不留本地副本、不进构建产物——与既有 favicon / 侧边栏引用模式一致。
2. **唯一性**：所有新增 logo 位必须引用同一 URL；禁止各应用自带 logo 文件。
3. **伴随文字**：侧边栏「BlueWhalePay」、首屏「蓝鲸支付」、登录页子系统名；logo 本体不含文字，文字独立维护。
4. 方形图标沿用各槽位既有高度/尺寸，不为换标重排布局。

## 以后怎么改

- **换 logo 图**：全局搜索当前 URL 整体替换为新 URL（当前 8 处，见应用矩阵）；新资源仍上传到同桶 `blue-whale-api/` 前缀，favicon 同步更换。
- **新增 logo 位**：直接引用权威源 URL，按本 PRD 规则登记到应用矩阵。
- 若未来换标频率变高，可考虑抽公共常量/运行时配置；当前无此需要（YAGNI），不做。

## 不涉及 / 既有遗留

- cashier 收银台（页面无 logo）。
- `logo-j.svg`（manager、merchant 各一份孤儿文件）与 merchant `public/index.html`
  （vue-cli 遗留死代码，引用 `public/imgs/`）未在本次清理，后续可另行提单。
- `jeepay_index_logo_img` / `jeepay_index_logo_text` 两个 id 为 Jeepay 遗留命名，
  无 JS 引用，保留不改（纯命名清理不值得混入本单）。

## 验收标准

- manager / merchant 全部可见品牌标识为蓝鲸图标，无旧 Jeepay 字标残留。
- 首屏加载页（50px）、登录页（44px）、侧边栏（40×40，展开/收起）显示正常。
- 全局 grep 旧 `logo.svg` 本地引用为 0。

## 记录

- 2026-08-03 首版：8 处引用切换为远端蓝鲸 SVG，删除 4 个失去引用的旧字标文件
  （manager `imgs/logo.svg`、manager `src/assets/logo.svg`、merchant `indexImgs/logo.svg`、merchant `src/assets/logo.svg`）。
