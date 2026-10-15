# 视频生成模式即能力行配置：键域统一、显式传递、约束按模型分叉

**状态**：accepted（2026-10-08，IKK1SZ / IKK1T4）

规则一句话：**能力行 `features.task_types` 的键 = 该模型开放的视频模式（键在即开放）；模式由前端显式传递到后端与上游，后端不再从参考素材角色 + 提示词关键词推断。**

这条不是新通则，是 [ADR-0110](0110-model-capability-config-is-authoritative.md)「配置永远第一」在**视频模式**这一处的落地——模式此前是唯一一处还在靠**猜**决定行为的地方。

## 动因

1. **模式不出前端，后端靠猜。** 模式是前端硬编码的 4 个键（`web/src/pages/CanvasPage/followDialog.ts`、`BottomPanel` 自由态 `dockModeOptions`、首页 `Home/components/ChatBox/index.tsx`），请求里只有参考素材的 `role`；后端 `resolveVideoTaskType`（`backend/libs/contracts/capability-param-validation.ts`，TS 与 worker Java 两份同源实现）从「role + 提示词关键词」推断任务类型。**猜已经在生产上出过事故**：IKJ78C 不得不给关键词判定加「否定防护」（用户写「不要修改背景」被误判成 `edit`，触发编辑单的 `adaptive` 约束而被拒单）。
2. **键名三处对不上。** 前端 4 键（`prompt` / `all` / `text2video` / `keyframe`）与后端任务类型 5 键（`default` / `first_frame` / `first_last_frame` / `edit` / `prolong`）不同域；首页又是第三套（`omni` / `firstlast` / `text2video`）。其中 `text2video` **字面意思是「文生视频」、标签是「图生视频」、实际干的是图片参考**——三个全对不上，且它已随画布快照持久化（`data.draftMode`）。
3. **`edit` 的上游硬约束由 worker 静默改写用户入参。** `server/blue-whale-worker/.../NewApiVideoClient.java` 里 `if (input.model().startsWith("doubao-seedance-2-5") && hasVideoReference(...))` 按**模型名前缀**特判，把用户的 `ratio` / `duration` 替换成 `adaptive` / `-1`。前缀硬编码换了名字就漏，静默替换让用户提交的值石沉大海——两条都撞 ADR-0110。
4. **2.0 与 2.5 的约束本身不同。** 官方《创建视频生成任务》的「不同模型的取值限制和 adaptive 适配规则」表：视频编辑 / 视频延长一行，Seedance 2.0 系列 = 「支持 adaptive 或指定宽高比」，2.5 = 「默认且仅支持 adaptive」。**把 2.5 的约束素推到 2.0 是错的**——批次分支 `capability-param-validation.ts` 的注释已经为此写过警告。
5. **IKG4UR 误伤了 `-1`。** 该单退役 `allowed_durations` 的理由是「把连续区间错写成若干档枚举，导致 6–9 秒被误拒」——理由成立，但 `edit: [-1]` 是**哨兵值不是档位**，被一刀切删掉后，`-1` 只能由 worker 的模型名前缀特判兜底，即动因 3。`model-capability-repo.ts` 里「读侧分支暂留未删（待 `-1` 接入时一并处置）」就是留的这个口子。

## Considered Options

- **保留推断，模式只作提示。** 两套来源并存，误判照旧发生，只是多了一个可能与前缀特判打架的输入。否决。
- **`allowed_durations` 恢复完整的枚举语义。** 重演 IKG4UR 的坑（滑杆给得出的值提交必被 400）。否决；只恢复 `-1` 这一个哨兵值。
- **各模式的上游约束写死在代码里（前后端各一份 + 一致性测试）。** 动因 4 已证明约束**按模型分叉**，写死等于把 2.5 的规则套到 2.0。否决——批次上为此写过的注释原文是「按模型分叉的约束走能力行配置（`features.task_types`），不要写进这里」。
- **新增一个独立的模式白名单字段，与 `task_types` 并存。** 两个字段表达同一组模式，迟早不一致：白名单里有 `omni` 而 `task_types` 没这个词条 → 该模式的约束静默消失；反之则是没人发现的死配置。否决。

## Decisions

1. **键域统一为 7 个，键在即开放。** 能力行 `features.task_types` 的键集就是该模型开放的模式集：

   | 键 | 中文 | 上游表达 |
   | --- | --- | --- |
   | `text2video` | 文生视频 | content 无素材 |
   | `omni` | 全能参考 | `role = reference_image / reference_video / reference_audio` |
   | `image_reference` | 图片参考 | `role = reference_image`（仅图） |
   | `first_frame` | 图生视频（单首帧） | `role = first_frame` |
   | `first_last_frame` | 首尾帧 | `role = first_frame` + `last_frame` |
   | `edit` | 视频编辑 | `role = reference_video` + `omni_reference_task_type=edit` |
   | `extend` | 视频延长 | `role = reference_video` + `omni_reference_task_type=extend` |

   键下的 `allowed_ratios` 保留现状语义（该模式的比例白名单）。**空对象 = 开放且无额外约束。**
2. **不新增字段，白名单与 `task_types` 合并。** 「这座模型有哪些模式」与「每个模式什么约束」是同一张表。
3. **`allowed_durations` 只放行 `[-1]`。** 它是「该模式下时长由上游决定、用户不可选」的表达。写侧闸门**强制只允许 `[-1]`**，正数枚举一律拒绝（堵住重演 IKG4UR）。它同时是「编辑单的时长只能跟随」这一唯一事实源。
   IKLUVP 修订，2026-10-15：`edit`、`extend` 模式可以额外声明 `allow_auto_duration: true`，表示在基础 `supported_durations` 范围与步长之外接受自动时长 `-1`。缺失、null 或 false 不开放自动时长。基础范围的步长由接纳侧与前端共同校验，指定值须满足 `(duration - min) % step === 0`，未配置步长时只校验范围。`allowed_durations: [-1]` 仍表示只能自动，优先于范围与自动可选标记；管理端写入只能自动时移除可选标记。禁止用正数枚举表达范围。

   | 模式配置 | 接受的时长 | 界面 |
   | --- | --- | --- |
   | 两个字段均缺失 | 基础范围及步长 | 指定秒数 |
   | `allow_auto_duration: true`，无 `allowed_durations` | `-1` 或基础范围及步长 | 自动与指定秒数可选 |
   | `allowed_durations: [-1]` | 仅 `-1` | 自动锁定 |

   当前 worker 的自动时长只支持 edit / extend。写侧拒绝其他模式的 `allow_auto_duration: true`，管理端只在这两个模式提供该选项；本单不扩展执行侧模式能力。

   模式内字段使用 snake_case。外层 `taskTypes` 历史别名归一为 `task_types` 时，保留模式内字段。Seedance 2.5 的 `extend` 补入 `allow_auto_duration: true`，保留 adaptive 比例与 4–30 秒基础范围；`edit` 继续使用 `allowed_durations: [-1]`。旧配置不会由模型名前缀或模式名自动扩权，须执行本单提供的定向配置 SQL。先部署支持新字段的 backend 与 web，再经人工审批更新存量配置并刷新目录缓存。

   自动可选表示由模型选择时长；编辑自动表示跟随原视频。快照中的 `duration` 保留用户的 `-1` 或正数，`video_mode` 保留显式模式，worker 按既有字段消费，不增加执行期能力字段。

4. **模式显式传递，执行侧只读快照。** 前端传模式 → 接纳侧按能力行校验并**冻结进 job 快照**（复用 IKJ795 的 `video_task_type` 机制，把「推出来的值」换成「传进来的值」）→ worker 按快照下发 `omni_reference_task_type` 与 `ratio` / `duration`。**worker 不得改写任何用户入参**，也不得含模型名前缀判定。
5. **`omni_reference_task_type` 只在 Seedance 2.5 下发**（官方该参数的模型支持仅 2.5）。2.0 靠 `content[].role` 表达，payload 逐位不变。new-api 侧**零改动**——2.5 专用渠道 `volcengine-25`（type 66）已支持该字段。
6. **推断退役，但误判兜底保留。** 官方明文「显式指定不保证按该类型生成，上游仍会结合提示词语义复判」——所以模式只解决「用户想做什么」，不保证上游照办。IKJ795 的**结构化拒单 + 前端一键修复**路径（`task_type_param_constraint` 码）必须保留，它是误判时的唯一出口。
7. **草稿兼容走读侧映射，不做数据迁移。** 画布 `data.draftMode` 的旧值（`prompt` / `all` / `keyframe` / `text2video`）在读取时映射到新键，存量草稿照常恢复。
8. **门控与配置叠加，不是二选一。** 配置答「这个模型**有哪些**模式」，素材答「**现在能不能点**」。撤掉素材门控等于让用户先选一个必然失败的模式。

## Consequences

- **空 `task_types` = 该模型没有任何视频模式**（不兜底）。这是「键在即开放」的直接推论，也意味着上线前必须按各模型现有能力位**逐行补齐** `task_types`——补不齐，那批模型的视频功能全废。这是本决定的已知代价，用一次性的存量补齐换取「配置是唯一事实源」。
- `backend/libs/contracts/ikg4ur-duration-same-source.test.ts` 的防回流断言从「种子里不含 `allowed_durations`」收窄为「只能出现 `[-1]`」；`model-capability-repo.ts` 与 ADR-0110 Decision 2 末段那句「不要再往数据里配 `allowed_durations`」按本 ADR 修订。
- `docs/specs/2026-09-13-ikfc1t-video-prompt-mode-contract.md` 里「**不得**重定义 `'text2video'`（其语义保持图生视频：仅图片普通参考）」一条被本 ADR 取代——该键语义**就是**图片参考，现在归位到 `image_reference`。
- 管理端「任务类型比例约束」区块的文案语义变更：「留空 = 沿用基础比例选项」→「键在 = 该模式对模型开放」。
- 排查「某个模型少了一个模式」的固定顺序：① 该键在不在 `task_types` 里（不再是代码里有没有分支）；② 素材门控是否把它按当前素材灰掉了。
