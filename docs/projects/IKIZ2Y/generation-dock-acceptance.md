# IKIZ2Y 八面板接入与验收清单

依据 [IKIZ2Y](https://gitee.com/hangzhou-xuanfu_1/blue-whale-ai/issues/IKIZ2Y) 的规格 `IKIZ2Y-SPEC-20261007`、评论 51464261，以及已确认的 [Q1–Q11 设计](../../specs/2026-10-07-ikiz2y-generation-dock-coordinator-design.md)和[状态分工 ADR](../../adr/0123-generation-dock-coordinator-ownership.md)。本文记录六个实施切片的最终接入、自动测试对应和未验边界，设计文档中的旧行号及只读调查属于历史设计阶段。

H5 从集成 `1043b8a2b7ddc7bd2ab5a3c8e28aa1e7018a32b4` 的文件树建立，固定继承 `cf1fb75b332e8934fd9e50e38f2967f2c08cdc28`，发布起点 `ccf1f5cc28149b9b81e03f5e556fe74da7d8efc8`。本票最终 HEAD、完整命令、实际计数和凭证登记在 IKJUH5 收口证据，不将此前子票凭证当作本票或父集成新 HEAD 的验证结果。本子票交接时，父任务同步、两轴整包审查及最终 PR 阶段验证尚待执行；后续实际状态以 IKIZ2Y 收口回执和官方精确 HEAD 凭证为准。人工浏览器与真实服务任务创建均为 NOT_RUN。

## 接入与所有权

以下源码和测试路径均相对于 `web/src/pages/CanvasPage/`。八定义在 `CanvasPage` 的同一静态 registry 注册，生产与测试使用 `createGenerationDockCoordinator` 的只读 `view/panel` 以及 `open/close/dismissAll/updateDraft/submit`。选择、参考完成、提交收尾和节点通知也通过对应公开动作接入。

| 注册 key | 唯一状态所有者与渲染 | 打开与更新入口 | 发送完成点 |
| --- | --- | --- | --- |
| image | `imageGenerationDock.ts`；`ImageGenerationDockPanel` → 原 `ImageDialog` | 工具栏、首页交接、图片草稿/成品、重编辑、类型菜单、参考完成；正文/模型/尺寸/比例写节点 | 先校验、收集引用、保存，再登记任务提交链；组件等待回调。true 仅是登记结果，随后隐藏。 |
| video | `videoGenerationDock.ts`；`VideoGenerationDockPanel` → 原 `BottomDialog` | 工具栏/右键、首页 preset、草稿/成品、重编辑、类型菜单、参考/模式、更新生成收尾 | 先 await 提示词限制，独立保存锁释放后读取部分引用，最后同步登记/清锁；组件等待回调。 |
| audio | `audioMusicGenerationDock.ts` 的 audio；`AudioGenerationDockPanel` → 原 `AudioDialog` | 工具栏/右键、草稿/成品、重编辑、类型菜单、参考、参数、更新生成收尾 | 先解析传入 refs，再写正文、保存、同步登记；组件不等待，自由音频调用后立即清正文和本地 refs。 |
| music | 同模块的 music，仅 visible；`MusicGenerationDockPanel` → 原 `MusicDialog` | 原互切回调、真实 Music→Audio 菜单、关闭；没有绑定或编辑缓存 | 页面只调用原日志处理，不建任务，submit 不关面板；关闭卸载本地表单。 |
| text | `textGenerationDock.ts`；`TextGenerationDockPanel` → 原 `TextGenDialog` | 文本点卡、onSelect 文本回调、两处 onWriteSelf、正文/模型写回 | 当前附件加正文直接写本地文本卡后关闭；没有任务、保存锁或轮询。 |
| imageEnhance | 原 `toolSessionRuntime` snapshot，经 `toolGenerationDock.ts`；原 `ImageEnhanceDialog` | source 调原 createEnhanceDraft 一次，再真实 handle.open 一次；身份卡/重编辑直接 target；高清不加实时参数事件 | 同步 handle.send 登记；启动交接后退出 UI，再 await 原创建链。 |
| videoEnhance | 原 runtime snapshot，同一 adapter；原 `VideoEnhanceDialog` | source/target；resolution 动作捕获 render 时 nodeId，原宿主写卡 | 同步 handle.send；等待原交接 Promise 结算后关闭。 |
| frameInterpolation | 原 runtime snapshot，同一 adapter；原 `FrameInterpolationDialog` | source/target；fps 捕获 render 时 nodeId，原宿主写卡 | 同步 handle.send；await 原调度结果，仅 true 关闭，accepted 后 frozenParams 与当前 lastParams 分开。 |

五普通类型各自现有的显隐、绑定、seed 和选择豁免归定义；三工具的 state/visible/hidden/submitting 继续归原运行时。节点、连线和引用来自宿主权威数据；组件菜单、上传、展开和表单编辑仍归原组件。没有新增画布镜像、工具镜像锁、音乐任务、自由内容缓存、文本模型恢复或后端契约。

`generationDock.render()` 自动消费 registry，Fragment key 使用注册 key。旧工具装配只按 registry 派生的 `renderedToolKinds` 排除三项渲染，其余 13 编辑工具的入口、装饰、连线、模态、选择和退出能力仍保留。共享工具订阅和版本函数只聚合一次；卸载释放自身订阅。页面外部点击/Esc 的 `anyGenPanelOpen` 从只读 activePanel 派生，新增注册项无需追加显隐名单或 JSX。

## 五组公开矩阵

`generationDockMatrix.test.ts` 将八个真实类型定义与真实三工具 owner 组合；可控宿主提供节点、引用和提交结果，标记 renderer 仅用于观察注册渲染与可见性，不冒充真实组件 DOM。`genPanelDismiss.test.tsx` 的 IKJUH5 注册扩展组 则在真实 CanvasPage 的同一 registry 加一份真实文本定义和原 TextGenDialog，验证无参渲染、互斥、语义动作、Esc、空白、外部点击及监听清理。没有为新增项修改公共互斥或发送分支。

| 类型 | 互斥与准入 | 选择与关闭 | 绑定与 seed | 发送与交接 | 生命周期 |
| --- | --- | --- | --- | --- | --- |
| 图片 | 八种目标切换，准入 false 保留原活动面板 | 空通知保持、异卡隐藏可恢复；参考/显式关闭豁免，手动重开 | 等值对象/key 稳定，真实变化重挂；宿主写回 | false 保留，true 隐藏；collect→save→同步登记 | 无效目标清理，有生成记录保留；不新增项目/文档全清 |
| 视频 | 同上 | 媒体规则；显式关闭另清自由 refs | 等值与真实变化，preset/样片及引用派生保持 | 保存后读部分引用；同步登记和 finally，保存载荷原断言保留 | 同图片，保留 target/seed mismatch 只解绑 |
| 音频 | 同上 | 媒体规则，音频参考选取保持原差异 | 存量 audioRefs 转边，seed refs=[]，从边派生；参数写节点 | 传入 refs 先解析；非 await 组件行为及次笔 draft/doc=null 保存原断言保留 | 同图片，不额外清自由表单 |
| 音乐 | 八种切换，原来没有独立准入门槛 | 选择只隐藏，不回弹；关闭卸载 | 仅 visible，无绑定/seed/内容缓存 | 仅原日志，不建任务，不因 submit 关面板 | 节点删除不引入绑定清理，按原组件卸载处理 |
| 文本 | 八种切换，原来没有媒体准入门槛 | 选择只隐藏；显式关保留绑定，点卡重开；onWriteSelf 一次 skip | 当前正文/附件派生，模型仍默认初始化 | 附件+正文写本地卡后关，无任务 | 目标删除或 textGen 标记失效清理，jobId 不放宽条件 |
| 高清 | source/target 拒绝保留原活动项；有效建卡后 target 拒绝不回滚 | 真实 owner 隐藏/恢复，显式 close 清会话 | 可见同卡 preserve，仍执行门槛 | 启动即退 UI，再等待；原 epoch/error 归属 | 同项目/重载/source 删除保留；target 删除或不同项目退出 |
| HD | 同高清，getter/open 各一次 | 真实 owner 区分选择恢复与显式重开 | 同卡 preserve；在途和宿主锁原规则 | 交接 Promise 结算后关闭；旧响应不清新锁 | 同高清，保留项目和旧响应守卫 |
| 插帧 | 同高清，拒绝传播原 boolean | owner 隐藏/恢复，保持模态/工具条差异 | 每次 reinitialize，从当前在途事实派生只读 | 原调度 true 后关闭，冻结参数/编辑参数分开 | 同高清，不另建工具重置或请求失效协议 |

跨类型用例遍历八种起点与八种目标，观察最多一个实际可见注册 renderer；另覆盖六类有准入门槛的拒绝路径。各类型专属准备顺序、refs 和保存载荷仍由下列原测试验证，未将所有路径统一为同一种锁或异步包装。视频和音频只对 ordinary submit 成功通知采用已红绿证明的最小通知时机，其他 close/submitted 路径没有推广该策略。

## 等价测试对应与保留处置

所有原整页和专属保障默认保留。本票新增公开组合与注册扩展证据，没有为了删行而删除已绿断言。

| 原行为保障 | 公开等价接口证据 | 保留的页面或组件证据 | 处置 |
| --- | --- | --- | --- |
| 八面板互斥、打开/关闭/全收起 | `generationDockMatrix.test.ts`、`generationDockCoordinator.test.ts` | `draftPanelSwitch.test.tsx`、`genPanelDismiss.test.tsx`、`toolSessionSwitch.test.tsx`、`toolSessionModal.test.tsx` | 新增真实定义组合，原保障保留 |
| 注册扩展、默认 renderer 与渲染去重 | Matrix 的 added 定义、`canvasToolRegistry.test.tsx` | `genPanelDismiss.test.tsx` 的 IKJUH5 注册扩展组、`canvasToolExtension.test.tsx` | 新增；Page 聚合可见性先 RED，改用 activePanel 后 GREEN |
| 图片选择、seed、引用身份与参数 | `generationDockCoordinator.test.ts`、Matrix 图片组 | `imageDraft.test.tsx`、`imageExternalPick.test.tsx`、`canvasEdges.test.tsx`、ImageDialog 单测 | 保留；旧去重/9张上限 skip 已恢复有效覆盖 |
| 视频 preset/样片、refs/角色、参数 | `videoGenerationDock.test.ts`、Matrix 视频组 | `videoDraft.test.tsx`、`videoRefPersist.test.tsx`、`canvasEdges.test.tsx`、BottomDialog 单测 | 保留；旧“空素材直接首尾帧且发送时落线”用例改为现行立即落边和角色请求，不恢复旧行为 |
| 音频 refs/参数/保存/等待差异 | `audioMusicGenerationDock.test.ts`、Matrix 音频组 | `audioDraft.test.tsx`、`audioRefPersist.test.tsx`、`mediaReEdit.test.tsx`、AudioDialog 单测 | 保留，次笔 draft/name/doc=null 与 pending 回调即清自由输入均有断言 |
| 音频/音乐互切、音乐日志/卸载 | 同模块公开接口与 Matrix 音乐组 | `audioDraft.test.tsx` 的真实 Music 菜单、发送、关闭及重开 | 回调与真实可达性分别记录，未补隐藏按钮 |
| 文本初始化、参数、本地写卡、一次 skip | `textGenerationDock.test.ts`、Matrix 文本组 | `genPanelDismiss.test.tsx` 的真实 TextGenDialog、文本回调库存 | 保留；新增模型写回和 no-task 结果，未增加模型初始化恢复 |
| 三工具准入、preserve/reinitialize、锁及关闭点 | `toolGenerationDock.test.ts`、`panelToolSessions.test.ts`、Matrix 三工具组 | `imageEnhancePanel.test.tsx`、`videoEnhancePanel.test.tsx`、`videoEnhanceSend.test.tsx`、`frameInterpolationPanel.test.tsx`、`frameInterpolationSend.test.tsx` | 保留；真实 Dialog close/send/params 记录并调用原 Dock 动作，再核原请求/节点 |
| 项目/节点/旧工具响应、错误归属 | `toolSessionRuntime.test.ts`、各定义 lifecycle 与 Matrix | `toolSessionEpochIsolation.test.tsx`、`toolSessionErrorToastOwnership.test.tsx`、`frameInterpolationRecovery.test.tsx` | 保留；来源删除与目标删除分开 |
| 13 编辑工具刷新、拖拽隐藏、退出和资源 | 原 `canvasToolSessions.test.tsx`、`dragHideSessions.test.tsx`、`toolSessionRuntime.test.ts` | `canvasToolExtension.test.tsx`、原工具页面/Modal/Switch/Epoch 测试 | 保留；不重建 runtime，不宣称全部异步卸载保护 |

真实组件单测、可控宿主接口测试、stub 画布提供的页面事件和人工浏览器是不同接缝。Matrix 的 marker renderer 与测试新增定义宿主只证明公共契约；原产品请求、canonical 节点写回、实际表单和事件顺序由保留的产品页面用例证明。

## 页面旁路库存核销

逐项来源为初始库存与当前 page 定向源码，图谱零命中不单独证明不存在。

| 原库存 | 当前接线与结论 |
| --- | --- |
| 首页图片 handoff、公共图片互关 | image.open(seed)、actionsRef.openImageDialog → Dock.open；没有活动旧显隐 setter |
| 两处 onWriteSelf | 水合文本回调与新建文生文卡均调用 Dock.writeSelf('text')，一次 skip 归定义 |
| 工具身份点卡/重编辑 `.draft.open` | openCoordinatedToolDraft 按原三种业务身份转 Dock.open(target)，其余 13 工具仍走原入口；不是共同 open/submit 分支 |
| 视频/音频/文本点卡与成品重编辑 | 对应注册 open；节点创建/程序化选中仍归宿主 |
| 四组显式关闭、全部收起、工具 deps | close 对应 key；ordinary/all scope 的 dismissAll；成功准入的真实工具 owner 按原次序 dismiss ordinary |
| 选择自动打开、恢复、隐藏 | 宿主先规范化 candidates，选取早退，再工具消费，再 open(selection) 与 Dock.selection；豁免不从页面读取 |
| 各主 open 与绑定失效 effect | open 和 reconcile 指向类型定义，无旧实际状态、seed 或兼容宿主 |
| 文本发送后隐藏 | Text 定义 submit 本地写卡后关闭 |
| ConnectTypeMenu 新卡/边 | 宿主建卡与边，再注册 open；真实菜单仍只三项 |
| 普通面板正常提交后隐藏 | image/video/audio 定义 submit 收尾；true 只表示提交链登记 |
| handleUpdateGenerate 图片/视频/音频成功收尾 | 原更新生成准备和请求顺序保留；绑定匹配时调用 Dock.submitted，没有旧 hidden/setShow 收尾 |
| 首页视频 preset、右键、工具栏 | 原 currentId/doc/preset/选取条件保留，再调用注册 open |
| 四普通 JSX、互切匿名回调 | view/actions/resources panel 边界；audio→music 和 music→audio 接线指向注册 open |
| 三工具注册/render/open/send/close | 正式 adapter 读取原 owner；真实 UI 语义动作注入；去重渲染由 registry 派生 |
| 旧 audio/music 菜单注释 | setShow*/setAudioSeed 只在原退役注释，非运行入口；不恢复、不附带清旧注释 |
| 八类 compatibility/legacy 状态 | 当前生产无 CompatibilityDock、compatibilityHost 或对应旧 actual state/setter；既有历史词句不当作运行旁路 |
| 可见面板监听开关 | 改为 Dock.view.activePanel，原参考/工具/input/mention 优先级、监听 cleanup 和全收起链保持 |

共同提交能力承担原门槛、hold/release、同步登记和适用错误反馈，类型定义保留实际准备顺序。handleUpdateGenerate 是卡片既有更新生成流程，不将它强制改成面板发送流程。

## 可达性、人工步骤与风险

| 项目 | 当前结论 |
| --- | --- |
| 音频→音乐回调接线 | 自动 PASS；callback-only。真实 AudioDialog 未消费 onSwitchToMusic，按钮 NOT_REACHABLE，按人类决定保持。 |
| 音乐→音频 | 原 MusicDialog 真实菜单自动验证；不把反向 callback 计为真实双向 UI。 |
| 文本 ConnectTypeMenu 项 | 真实菜单仅 image/video/audio；文本项 NOT_REACHABLE。onSelect('text') 分支仅 callback-only。 |
| 两个文本 onWriteSelf | 自动验证真实节点回调与一次 skip；callback-only，不冒充 TextNode 按钮点击。 |
| 三工具来源工具条 | 多数整页夹具调用真实节点 data 入口，随后真实 Dialog DOM和请求/节点断言；已有 HD NodeWrapper 链继续真实验证。 |
| 人工浏览器/真实服务创建 | NOT_RUN。自动 jsdom 组件与接口结果不替代真实浏览器或服务受理。 |
| 普通旧准备响应风险 | Q1 单列源码风险：准备中关闭、同卡重开后旧准备可能影响新 UI，尚未复现；未新增 session guard 或将它升级为本票必修。 |
| 卸载保障 | 只证明自身订阅与页面监听释放；不宣称原工具所有异步请求都在卸载时失效。 |

建议人工验收在父任务最终 HEAD、已核对服务 cwd/URL/proxy/fixture 后执行，以下均仍 NOT_RUN：

1. 通过实际可达入口打开图片、视频、音频和三工具，已有文本生成卡经点卡打开文本；点卡/重编辑/切换后只显示当前面板。音乐没有音频侧的可达打开按钮，音频→音乐仅 callback-only，不能在此列为可执行 UI 步骤。
2. 普通媒体空选中保持，异卡隐藏可恢复；显式关闭不随程序化选中回弹；参考选取先退出选取，工具事件先消费，输入框/mention 的 Esc 让位。
3. 同一草稿重开保留输入，修改节点后重开正确回填；高清/HD 同卡保留，插帧重新初始化；验证工具条/模态差异。
4. 检查实际请求与卡片结果：三个普通提交链、文本本地写卡、高清/HD/插帧各关闭点及失败重发。音乐日志和真实 Music→Audio 菜单仅在既有音乐面板已打开的条件下验证；没有该前提时保持 NOT_RUN，不编造打开入口。真实服务未受理时不写“任务已完成”。
5. 项目不同/同 ID 文档刷新、来源与目标删除、旧工具请求迟到、关闭/卸载分别验证原规则，拒绝新增统一清空。

本票按官方选择器运行当前自有差异的完整 Web 类型、lint、全部 Vitest、test/release 构建和文档规则检查，相关 skipped/pending 逐项核对。计数与通过状态只从实际 run/check 凭证读取；首次失败保留，明确基础设施或 known-flaky 仅按规则一次重试。本子票交接时，父最终集成和 PR 阶段尚待独立验证；后续以 IKIZ2Y 收口回执和精确 HEAD 凭证更新实际状态，历史子票通过不替代该步骤。
