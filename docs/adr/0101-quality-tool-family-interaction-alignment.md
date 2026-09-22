# 画质工具家族交互对齐：会话期模态隐藏 chrome、触发钮最近工具语义、发送钮统一 Dock 主发送钮样式

画布画质工具家族（高清/扩图/裁切/擦除/抠图，「高清 ▾」下拉承载）确立三条家族级交互规则，回应整包验收发现的三处交互断裂。菜单现序为高清/扩图/裁切/擦除/抠图（代码 `qualityMenuItems` 顺序）——ADR-0098 正文「高清/扩图/擦除/抠图/裁切」的排位记述系笔误，裁切实际位于擦除之前，以本 ADR 记录的顺序为准，ADR-0098 原文不改。其一，**会话期模态隐藏 chrome**：进入擦除/裁切/抠图/扩图任一编辑会话后，界面进入「工具状态」模态——生成 Dock 六面板（视频/图片/音频/音乐/文生文/高清）不可见不可开：进入会话的既有互斥 `dismissAllGenPanels()` 维持全量关闭，选中联动 `syncPanelVisible` 在会话期不回弹面板，会话期任何打开请求（左侧工具栏、点草稿卡、重新编辑、音频/音乐互切等八处打开入口）先按四路退出口径退出会话（未发送参数丢弃）再放行面板打开；媒体卡悬浮工具条整条不渲染，高清面板打开期间对全部图片卡同样隐藏；Dock 已建草稿与面板编辑内容静默保留（面板编辑实时写回节点 data 的既有口径不变），会话退出后按既有口径恢复。实现为派生会话态 `editSessionActive`（`eraseTargetNodeId` / `cutoutNodeId` / `cropTargetNodeId` / `outpaintNodeId` 四个目标 id state 的或运算，渲染期派生、不新增状态机），统一前置函数 `exitEditSessionForGenPanel`（依次幂等调用 `exitEraseEditing` / `exitCutoutSession` / `exitCropMode` / `endOutpaintSession`），以及 MediaNode data 上渲染期派生注入的 `soloToolbarHidden`（注入条件 `showEnhanceDialog` 或目标卡命中四会话任一）。本 ADR 与 IKGYYD 工具条钉屏幕迁移（ADR-0099）同批次合并：工具条迁出 MediaNode 后，模态显隐由 CanvasPage 钉屏幕层 `NodeFollowToolbar` 的 `show` 门（`showSoloMediaToolbar && !editSessionActive && !showEnhanceDialog`，对全部媒体卡生效）承担，`soloToolbarHidden` 注入退为集成测试可观测标记。其二，**触发钮最近工具语义**：「高清 ▾」触发钮的文案与图标显示全局记忆的最近使用画质工具，默认「高清」（enhance）；最近工具是全局单值——不分画布文档、跨卡片共享，localStorage 单 key 持久（`bw-recent-quality-tool`，`bw-` 前缀 kebab-case，同 `snapPreference.ts` 惯例）；悬浮触发钮自动展开菜单、移出延迟 120ms 关闭（容忍指针滑向菜单的间隙）；点击触发钮直启所显示工具——直启复用菜单项既有 `onSelect` handler，进入会话/打开面板而非直接发送（ADR-0098 对一键直发的否决继续有效，直启≠直发）；所显示工具对当前卡不可用时整钮置灰（复用菜单项既有置灰门槛，`aria-disabled` + 点击无效，悬停说明缺省按置灰原因/提示），hover 仍展开菜单可见原因并改选。实现为纯逻辑模块 `recentQualityTool.ts`（无 React 依赖，打法同 `imageCutout.ts`）：`readRecentQualityTool` / `persistRecentQualityTool` / `subscribeRecentQualityTool` 三入口收敛读写与订阅（`useSyncExternalStore` 形态，任一卡使用工具即同步刷新全部图片卡触发钮），写入收敛在单一入口（菜单选择与触发钮直启两条路径共用 `launch`），工具 id 集合 enhance / outpaint / crop / erase / cutout 与 `qualityMenuItems` 同源。其三，**发送钮统一**：五工具的发送/确认钮统一为 Dock 主发送钮样式（灰底圆角方形、白 ↑ 图标，色值同源 `BottomDialog` `.sendBtn` / `.sendBtnActive`：默认 `#2a2a2a` 底 `#777` 箭头、激活 `#4a4a4a` 底 `#fff` 箭头、hover `#555`、圆角 8px）；统一的是形态与色值，尺寸随各自布局（抠图/扩图横条 32×32、擦除发送条 30×30、裁切确认钮与高清面板 28.8×28.8）；各组件置灰守卫（原生 disabled + title 原因）与门槛保留，裁切恒可确认故恒激活态（「确认」文案保留在 title）；不抽共享组件——CutoutToolbar / OutpaintDialog / ImageEraseDialog / CropDialog / ImageEnhanceDialog 各自对齐（高清面板本已是同款）。ADR-0095（扩图横条修订）与 ADR-0098（抠图）对以上三项本来沉默——它们只规定各工具的参数承载形态、门槛与建卡口径，未规定会话期 chrome 显隐、触发钮记忆语义与发送钮家族样式；本 ADR 是家族级补充而非推翻，各工具 ADR 的其余结论继续有效。

## Considered Options

- Dock 折叠成细条/图标的中间态（会话期留半截可点回的 UI）：工具状态是全屏工作态，中间态徒增视觉噪音与双份显隐逻辑，且「打开请求先退会话再放行」已保证回 Dock 路径始终可达，否决；只取完全隐藏。
- 每卡各记一份最近工具（触发钮显示本卡最近使用的工具）：最近工具是用户操作习惯而非卡片属性，分卡记忆导致触发钮文案无常、无法建立肌肉记忆，且画质工具使用习惯跨卡高度一致，否决；全局单值是唯一口径。
- 触发钮做成分裂按钮直发（点触发钮以默认参数直接发送）：ADR-0098 已否决一键直发（抠图 scene 决定效果、零界面剥夺选择权），否决；点击直启进入会话/打开面板，不自动发送。
- 横条加「当前工具」标题字（进入会话后横条左侧显示工具名）：ADR-0095/0098 横条无标题字的口径不变，工具身份由触发钮与会话形态自明，验收拍板维持无标题，否决。
- 会话期销毁 Dock 草稿/面板状态以强化模态：面板编辑实时写回节点 data 的既有口径已保证内容不丢，销毁会造成退出会话后内容意外丢失，否决；静默保留。

## Consequences

- 悬浮工具条渲染门原位于 `MediaNode/index.tsx`（`showSoloToolbar` × `soloToolbarHidden` × 数据门）；IKGYYD 钉屏幕迁移（ADR-0099，与本 ADR 同批次合并）后已随迁至 CanvasPage 钉屏幕层 `NodeFollowToolbar` 的 `show` 门，「高清面板打开期间对全部图片卡隐藏」的语义由全局布尔 `!editSessionActive && !showEnhanceDialog` 保持。
- localStorage 键名 `bw-recent-quality-tool` 与默认值「高清」是产品口径的一部分：换键等于全体用户最近工具记忆重置；读取对无 localStorage / 坏值回退默认，不拦截渲染。
- 触发钮置灰是「整钮置灰但 hover 仍展开」的口径（`aria-disabled` 而非原生 disabled，正是为保留 hover 展开改选）；与菜单项「单项置灰」并存。
- ADR-0098 的菜单排位记述以本 ADR 记录的正确顺序（高清/扩图/裁切/擦除/抠图）为准，原文不改。
- 发送钮五处独立实现有意为之（同构不共享，同 ADR-0098 对抠图/扩图工具栏的口径）；后续如需收敛为共享发送钮组件，另行评估。
