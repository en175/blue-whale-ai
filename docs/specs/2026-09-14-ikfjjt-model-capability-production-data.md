# IKFJJT 生产模型能力数据更新清单

> ⚠️ **2026-09-16（IKG4UR）起，本清单里 `allowed_durations`（按任务类型的时长约束）一栏作废——不要再按它配数据。**
> 官方口径是**连续区间**（Seedance 2.0 系 4–15 整数秒、2.5 4–30），当初写成枚举导致滑杆给得出的
> 6–9 / 7·9·11… 提交必被 400。时长唯一来源现为**基础行 `supported_durations`**（对象 `{min,max,step}`；
> 非空 ⟺ 该模型时长可配，音频上游无 duration 参数故置 NULL）。见 ADR-0086 修订段。
> `task_types[*].allowed_ratios`（比例）**不受影响，照本清单执行**。

> 后台模型配置页 `https://web.master.xfai.cloud/admin/models`，逐行按下表补齐/核正。代码已配好读侧缺省（旧行不配置行为不变），但**生产要真正生效必须改后台数据**。种子 `002_seed.sql` 已同步（新建库自洽）。

## 通用说明（能力键，features JSON）

> ⚠️ **2026-09-21（IKHEXG）起，参考上限键按「素材媒介」命名，作用域由行的类型决定。**
> 原 `max_reference_images` 已并入 `image_reference_max` 并从代码中删除；存量值由
> `029_ikhexg_reference_key_rename` 迁移自动搬入（按行类型判定原本生效的那把，行为不变）。
> 下表及下方各表里的 `max_reference_images` 一律改读作 **`image_reference_max`**；
> 配置时**图片行也要填 `image_reference_max`**（旧键在后台已不再渲染）。

| 键 | 语义 | 适用生成类型 | 未配置缺省 |
|---|---|---|---|
| `video_reference` | 视频生成是否接受**视频素材**作普通参考 | 视频 | false |
| `video_reference_max` | 普通参考中视频素材上限 | 视频 | 3 |
| `audio_reference` | 视频生成是否接受**音频素材**作参考 | 视频 | false |
| `audio_reference_max` | 音频素材参考上限 | 视频 / 音频 | 3 |
| `image_reference_max` | **图参考上限**（IKHEXG 合并了原 `max_reference_images`） | 图片 / 视频 / 音频 | 图片·视频 **10**、音频 **1** |
| `max_reference_duration_sec` | 输入参考素材**总时长**上限（秒） | 视频 / 音频 | null（不限）|
| `task_types` | 按任务类型的比例/时长约束（JSON 对象） | — | 空 |

> **`image_reference_max` 的缺省按行类型分**（官方值本就不同）：图片/视频行 10
> （网关 `maxImageEditImages` / 方舟 Seedream 复合编辑），音频行 1（官方音频接口只收 1 张）。
> 两键同现时以**本行类型原本被读的那把**为准——迁移即按此搬值，无需人工判。

> **补缺（Q10）**：下方「视频」表的图参考一栏此前缺失。据
> `2026-08-24-video-ref-image-limit-prompt-design.md` 记载，三条 Seedance 2.0 行在测试库留 NULL、
> 后手工置 **9**（官方参考图上限）。请运营按 9 核正 2.0 / 2.0 Fast / 2.0 Mini 三行的
> `image_reference_max`。

## 逐模型应填值

### 图片

| 模型 | image_reference_max | quantity_max | 档位（supported_sizes） | 备注 |
|---|---|---|---|---|
| Seedream 5.0 Lite | **14**（现 10）| 15 | 2K/3K/4K | 官方参考图最多 14，且**输入图+输出图≤15** |
| Seedream 4.5 | **14**（现 10）| 15 | 2K/4K | 同上联动校验 |
| Seedream 5.0 Pro | 10 | 1 | **1K/1.5K/2K**（现含 4K 需删）| 官方档位核正 |
| GPT Image 2 | **16**（现 10）| **10**（现 1）| 1K/2K/4K | 官方编辑输入最多 16、单次输出最多 10 |
| Banana 2 | 按供应商实配 | 按供应商实配 | 按供应商实配 | 不能套 Gemini 上限，先确认供应商与模型映射 |

### 视频

| 模型 | video_reference | video_reference_max | audio_reference | audio_reference_max | max_reference_duration_sec | 时长档 | 档位 | task_types |
|---|---|---|---|---|---|---|---|---|
| Seedance 2.0 | false | 3 | **false** | 3 | **15** | 4–15 | 720p/1080p/**4K**（现缺 4K 补）| default/allowed_ratios=[16:9,9:16,1:1]（**不含 adaptive**，见下）, allowed_durations=[4..15] |
| Seedance 2.0 Fast | false | 3 | false | 3 | 15 | 4–15 | 按官方 | default 同上 |
| Seedance 2.0 Mini | false | 3 | false | 3 | 15 | 4–15 | 按官方 | default 同上 |
| Seedance 2.5 | `doubao-seedance-2-5-260628` | **30** | 1 | **480p/720p/1080p**（无 4K）| **21:9/16:9/4:3/1:1/3:4/9:16/adaptive** | **4–30（含 -1 自动）** | mp4/mov | 默认（参考生视频/文生视频）ratio/duration 无特殊限制；首帧/首尾帧/edit/prolong 仅 `adaptive` 比例；edit 另需 duration=-1 | 视频参考 **10**（`video_reference=true`）、音频参考 **10**（`audio_reference=true`）、图参考 **30**、素材总时长 **≤30s**、支持纯音频参考 | 新增行（本地库已配，生产按此后台加）|

> **`adaptive` 是 2.5 的档，2.0 系列不支持（IKFQ5S 订正）**：官方 [Seedance **2.5** 教程](https://ark.volcengine.com/region:cn-beijing/docs/82379/2607688)
> 的「首帧/首尾帧 ratio 必须为 adaptive」是 **2.5 专属规则**；该教程能力表虽在 2.0 列也列了 adaptive，但**实测 2.0 上游拒绝**
> （`HTTP 400 unsupported ratio: adaptive`，job 2069）。**2.0/2.0 fast/2.0 mini 不得配置 adaptive**，首尾帧走固定比例。

### 音频

| 模型 | audio_reference_max | image_reference_max | 备注 |
|---|---|---|---|
| seed-audio-1.0 | 3 | 1 | 不可混用音频与图片参考（已有） |

## 注意

- `task_types` 是 JSON 对象：`{ "<task>": { "allowed_ratios": [...], "allowed_durations": [...] } }`，缺省键由前端回落 default。
- 改完后在生成面板实际发一次「恰好上限 / 超上限 / 切换模型」三类用例验收（工单验收第五条）。
- 生产库属运营数据，此处仅给出应填值；后台改完不回写种子。
