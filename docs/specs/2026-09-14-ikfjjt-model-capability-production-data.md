# IKFJJT 生产模型能力数据更新清单

> 后台模型配置页 `https://web.master.xfai.cloud/admin/models`，逐行按下表补齐/核正。代码已配好读侧缺省（旧行不配置行为不变），但**生产要真正生效必须改后台数据**。种子 `002_seed.sql` 已同步（新建库自洽）。

## 通用说明（能力键，features JSON）

| 键 | 语义 | 未配置缺省 |
|---|---|---|
| `video_reference` | 视频生成是否接受**视频素材**作普通参考 | false |
| `video_reference_max` | 普通参考中视频素材上限 | 3 |
| `audio_reference` | 视频生成是否接受**音频素材**作参考 | false |
| `audio_reference_max` | 音频生成中音频参考上限 | 3 |
| `image_reference_max` | 音频生成中图片参考上限 | 1 |
| `max_reference_duration_sec` | 输入参考素材**总时长**上限（秒） | null（不限） |
| `max_reference_images` | 图片参考图上限 | 10 |
| `task_types` | 按任务类型的比例/时长约束（JSON 对象） | 空 |

## 逐模型应填值

### 图片

| 模型 | max_reference_images | quantity_max | 档位（supported_sizes） | 备注 |
|---|---|---|---|---|
| Seedream 5.0 Lite | **14**（现 10）| 15 | 2K/3K/4K | 官方参考图最多 14，且**输入图+输出图≤15** |
| Seedream 4.5 | **14**（现 10）| 15 | 2K/4K | 同上联动校验 |
| Seedream 5.0 Pro | 10 | 1 | **1K/1.5K/2K**（现含 4K 需删）| 官方档位核正 |
| GPT Image 2 | **16**（现 10）| **10**（现 1）| 1K/2K/4K | 官方编辑输入最多 16、单次输出最多 10 |
| Banana 2 | 按供应商实配 | 按供应商实配 | 按供应商实配 | 不能套 Gemini 上限，先确认供应商与模型映射 |

### 视频

| 模型 | video_reference | video_reference_max | audio_reference | audio_reference_max | max_reference_duration_sec | 时长档 | 档位 | task_types |
|---|---|---|---|---|---|---|---|---|
| Seedance 2.0 | false | 3 | **false** | 3 | **15** | 4–15 | 720p/1080p/**4K**（现缺 4K 补）| default/allowed_ratios=[16:9,9:16,1:1,**adaptive**], allowed_durations=[4..15] |
| Seedance 2.0 Fast | false | 3 | false | 3 | 15 | 4–15 | 按官方 | default 同上 |
| Seedance 2.0 Mini | false | 3 | false | 3 | 15 | 4–15 | 按官方 | default 同上 |
| Seedance 2.5 | `doubao-seedance-2-5-260628` | **30** | 1 | **480p/720p/1080p**（无 4K）| **21:9/16:9/4:3/1:1/3:4/9:16/adaptive** | **4–30（含 -1 自动）** | mp4/mov | 默认（参考生视频/文生视频）ratio/duration 无特殊限制；首帧/首尾帧/edit/prolong 仅 `adaptive` 比例；edit 另需 duration=-1 | 视频参考 **10**（`video_reference=true`）、音频参考 **10**（`audio_reference=true`）、图参考 **30**、素材总时长 **≤30s**、支持纯音频参考 | 新增行（本地库已配，生产按此后台加）|

> **`adaptive` 是首尾帧的必需档**：官方要求首帧/首尾帧生视频 `ratio` 必须为 adaptive（输出宽高比跟随首帧图）。
> 2.0/2.0 fast/2.0 mini 的**官方输出宽高比同样含 `adaptive`**（另支持 21:9/4:3/3:4，本次仅补 adaptive 保证首尾帧可用，
> 其余官方档位可后续核正）。未补 adaptive 时，首尾帧任务会 400「当前模型不支持 比例 adaptive」。

### 音频

| 模型 | audio_reference_max | image_reference_max | 备注 |
|---|---|---|---|
| seed-audio-1.0 | 3 | 1 | 不可混用音频与图片参考（已有） |

## 注意

- `task_types` 是 JSON 对象：`{ "<task>": { "allowed_ratios": [...], "allowed_durations": [...] } }`，缺省键由前端回落 default。
- 改完后在生成面板实际发一次「恰好上限 / 超上限 / 切换模型」三类用例验收（工单验收第五条）。
- 生产库属运营数据，此处仅给出应填值；后台改完不回写种子。
