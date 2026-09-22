import { z } from "zod";

/* 音频调速（audio_speed，画布音频卡「调速」）跨进程任务契约（IKHW48）：
   父单 IKHVYO（滑杆编辑态+分段中点映射+火山 adjust-audio-speed 异步任务）；交互与参数
   口径 = ADR-0113（全曲变速、无格式下拉、0.05 步进、1.0 原速视觉中点、贴原速省略提交）；
   术语见根 CONTEXT.md「画布音频调速」节。一对一复刻 audio-trim 契约家族（audio-trim.ts）。
   接口契约唯一权威 = 火山引擎 AI MediaKit adjust-audio-speed 官方 CLI 参考文档
   （volcengine/mediakit-cli 仓库 skills/byted-mediakit-editing/reference/adjust-audio-speed.md，
   Cloud 模式契约；对应 REST 上游 POST /api/v1/tools/adjust-audio-speed——**异步任务**：提交返
   task_id，轮询查询取 result.audio_url（24h 临时链接，需强制转存 TOS）/ result.duration
   （输出音频时长，秒）。⚠️ 官方复核结论（2026-09-22，工单 IKHW48 落地前置）：result 两个字段名
   audio_url / duration 已对官方 CLI 参考文档**逐字证实，非视频侧示例推测**；官方另有可选
   format 参数（mp3/m4a/ogg/flac/wav，默认 m4a）——本产品不传（父单决策：无格式下拉），
   产物格式跟随官方默认输出 m4a；命名 `源名(调速{值}x).m4a` 的后缀默认 m4a（本文件
   AUDIO_SPEED_OUTPUT_FORMAT 单源，web 占位/成品命名同引），成功终态补丁按可得的真实
   格式（产物 URL 末段扩展名）校正后缀，URL 不可解析时保持 m4a 默认。
   本仓经 new-api 网关调用；参数名以官方文档为准，出处逐条标注在常量注释，禁止引用二手信息。
   跨进程字段在本文件定死后双端实现（红线：契约先行）：worker-java 侧同名常量类
   AudioSpeedContract（domain/contract）由执行票 IKHW5A 落地；backend 入队 tag 常量
   （queue.constants.ts 的 AUDIO_SPEED_TAG）与 worker-java 的 JobTypeEnum / GenerationMqRouteEnum
   注册均由接线票落地（mq-route-parity.test.ts 对枚举表一一对应断言，本票不单侧先加——
   audio_trim 契约票 IKHB6F 同款口径）。消费方接线：IKHW59（backend 路由）/ IKHW5A（worker）/
   IKHW5C+IKHW5S（web 编辑态闭环）。 */

/** 任务类型值：generation_jobs.type 与 RocketMQ tag 同值（tag=type 口径）。
 *  任务来源值同族同值：画布卡片工具条创建入口的既有落库值 dock（generation_jobs.source
 *  列默认值同值）；audio_speed 不套 claim source 白名单（audio_trim / media_extract 同款
 *  口径，claim 只按 type 过滤）。 */
export const AUDIO_SPEED_JOB_TYPE = "audio_speed";
export const AUDIO_SPEED_SOURCE = "dock";

/** 产物输出格式（文档出处：官方 CLI 参考文档 format 节「输出音频格式……默认值为 m4a」）：
 *  官方可选 format 参数（mp3/m4a/ogg/flac/wav）的默认值——本产品不传 format（父单决策：
 *  无格式下拉），产物格式跟随官方默认输出 m4a。本仓展示命名单源：web 占位卡/成品命名
 *  后缀默认取本值（audioSpeed.ts 引用不复制），成功终态补丁按可得的真实格式（产物 URL
 *  末段扩展名）校正后缀；worker-java 转存扩展名/mime 单源在 AudioSpeedContract
 *  .TRANSFER_OUTPUT_FORMAT（Java 无法 import TS，双端一致性测试读源码文本对账同值）。 */
export const AUDIO_SPEED_OUTPUT_FORMAT = "m4a";

/** input 冻结键名（创建时定死，重试原样沿用）。
 *  基础设施键 provider_credential 在业务键之上由创建侧冻结落库（同 audio-trim 先例，
 *  不进本 zod——它校验的是客户端 payload，凭证来自请求头冻结）。
 *  speed 是**可选键**：贴原速省略口径（见 buildAudioSpeedInput）下不传。 */
export const AUDIO_SPEED_INPUT_KEYS = {
  /** 源素材身份（被调速的音频 Asset id）。 */
  sourceAssetId: "source_asset_id",
  /** 播放倍速（范围 [0.1, 4.0]、最多两位小数；可选——恰为 1.0 原速时省略，走官方默认 1。
   *  出站映射官方 speed 参数，同名同值）。 */
  speed: "speed",
} as const;

/** 倍速域常量（文档出处：官方 CLI 参考文档 speed 节「播放速度……取值范围 [0.1, 4]」；
 *  产品步进口径 = 父单 IKHVYO / ADR-0113 滑杆步进 0.05——两位小数天然满足）。 */
export const AUDIO_SPEED_MIN_SPEED = 0.1;
export const AUDIO_SPEED_MAX_SPEED = 4.0;
export const AUDIO_SPEED_STEP = 0.05;

/** 网关异步提交路由（对客）：POST {AUDIO_SPEED_SUBMIT_PATH}，网关按路径末段决定工具。
 *  火山上游侧对应官方文档「提交音频调速任务」节 POST /api/v1/tools/adjust-audio-speed，
 *  由网关内部转发，本仓不直连上游。本常量按家族规律（/v1/mediakit/{与上游同名的工具段}，
 *  trim-audio / extract-audio / segment-scenes 等先例一致）取值，网关配置票定稿后回填
 *  （IKH28Y / IKH8BK 先例，ADR-0113）。
 *  ⚠️ 网关路径 ≠ 火山上游路径（IKH67T 实测：混用即 404 Invalid URL，任务卡在提交相）。 */
export const AUDIO_SPEED_SUBMIT_PATH = "/v1/mediakit/adjust-audio-speed";

/** 网关异步任务查询路由前缀（拼 taskId）：GET {前缀}{task_id}。MediaKit 异步工具共用
 *  同一条查询路由，路径**不含 async 段**。 */
export const AUDIO_SPEED_POLL_PATH_PREFIX = "/v1/mediakit/tasks/";

/** 滑杆位置域常量（ADR-0113 / 父单 IKHVYO 实现决策 3）：滑杆 0~1000 整数位置分段线性，
 *  1.0 原速在视觉中点 500——慢放 0.1~1.0 占左半、快放 1.0~4.0 占右半（线性铺开时慢放区
 *  仅 23% 宽度且原速凹槽偏离中点，故分段）。web 滑杆 min/max/midpoint 与刻度定位共用本组。 */
export const AUDIO_SPEED_SLIDER_MIN_POS = 0;
export const AUDIO_SPEED_SLIDER_MID_POS = 500;
export const AUDIO_SPEED_SLIDER_MAX_POS = 1000;

/** 提交精度收口（纯函数）：最多两位小数（产品契约口径，父单实现决策 2——0.05 步进天然
 *  满足；官方 speed 为 number 未约束小数位，本仓收口两位保证跨端一致）。全精度浮点只在
 *  内部流转（滑杆拖拽、播放中实时改 rate）；出站 speed 值必经本函数，web/backend 不各自
 *  实现舍入。toFixed(2) 按值的双精度近似做最近舍入（同 audio-trim roundAudioTrimSeconds
 *  口径），量化结果恒合法。 */
export function roundAudioSpeed(speed: number): number {
  return Number(speed.toFixed(2));
}

/** 滑杆位置 → 倍速（纯函数，照抄父单 IKHVYO 实现决策 3 原型定稿代码，数值勿改）：
 *  分段线性 + 0.05 网格量化 + 范围夹紧；parseFloat(toFixed(2)) 吸收乘法尾差。
 *  契约层单源（本文件），web 滑杆 / backend 复核不各自换算。 */
export function posToSpeed(pos: number): number {
  // 滑杆 0~1000 分段线性，1.0 原速在视觉中点 500；步进 0.05；范围 [0.1, 4.0]
  const raw = pos <= 500 ? 0.1 + (pos / 500) * 0.9 : 1.0 + ((pos - 500) / 500) * 3.0;
  const q = Math.round(raw / 0.05) * 0.05;
  return Math.min(4.0, Math.max(0.1, parseFloat(q.toFixed(2))));
}

/** 倍速 → 滑杆位置（纯函数，照抄父单 IKHVYO 实现决策 3 原型定稿代码，数值勿改）：
 *  posToSpeed 的逆映射（分段区间内各自线性反解 + 四舍五入取整位置）；与 posToSpeed 在
 *  0.05 网格点上往返一致（见 audio-speed.test.ts 断言）。 */
export function speedToPos(speed: number): number {
  return speed <= 1 ? Math.round((speed - 0.1) / 0.9 * 500) : Math.round(500 + (speed - 1) / 3 * 500);
}

/** input 冻结结构（创建入口复核与重试沿用都用本 schema；strict 防多余键）。
 *  这是**冻结后**形态：speed 可选（贴原速省略口径，undefined = 走官方默认 1.0），范围
 *  [0.1, 4.0]（文档出处：官方 CLI 参考文档 speed 节取值范围）、最多两位小数（提交精度在
 *  契约层收口，超精度在创建入口即拒）。 */
const twoDecimalSpeed = z
  .number()
  .min(AUDIO_SPEED_MIN_SPEED)
  .max(AUDIO_SPEED_MAX_SPEED)
  .refine((value) => roundAudioSpeed(value) === value, {
    message: "最多两位小数（产品契约精度口径，0.05 步进天然满足）",
  });

export const audioSpeedInputSchema = z
  .object({
    [AUDIO_SPEED_INPUT_KEYS.sourceAssetId]: z.string().regex(/^[1-9][0-9]*$/),
    [AUDIO_SPEED_INPUT_KEYS.speed]: twoDecimalSpeed.optional(),
  })
  .strict();
export type AudioSpeedInput = z.infer<typeof audioSpeedInputSchema>;

/** 冻结 input 构造（纯工厂，web 发送条唯一构造口径）：源素材 id + 倍速 → 提交 payload。
 *  贴原速省略口径（同截取贴边省略）：speed 恰为 1.0（= 官方默认值，文档出处：官方 CLI
 *  参考文档 speed 节「默认 1」）时省略 speed 键走官方默认——产品发送守卫（滑离 1.0 才
 *  点亮）正常流程不产出 1.0，本口径为重试 lastInput 等极端路径的防御性收口。判定在先、
 *  量化在后（同截取：贴边判定用精确相等，未省略值再经 roundAudioSpeed 收口两位小数）。
 *  消费方不再手拼键名；产物恒过 audioSpeedInputSchema。 */
export function buildAudioSpeedInput({
  sourceAssetId,
  speed,
}: {
  sourceAssetId: string;
  speed: number;
}): AudioSpeedInput {
  const input: AudioSpeedInput = { [AUDIO_SPEED_INPUT_KEYS.sourceAssetId]: sourceAssetId };
  if (speed !== 1) {
    input[AUDIO_SPEED_INPUT_KEYS.speed] = roundAudioSpeed(speed);
  }
  return input;
}

/** 执行面错误码归并口径（数值码注册在 error-codes.ts ERROR_AUDIO_SPEED_FAILED=1051，
 *  TS 侧常量单源在 error-codes.ts，本文件不重复定义——audio-trim / media-extract 同款）：
 *  三类映射——① 网关错误（HTTP 非 2xx / 成功态 error 信封 / 提交 SocketTimeout）复用既有
 *  通用码分类链（额度 1001 / 内容 1018 / 版权 1038 / provider_failed 1011 / 提交超时
 *  provider_timeout 1012，NewApiErrorClassifier 同款，不新码）；② 火山任务失败（轮询
 *  status=failed——含 speed 越界等供应商侧官方约束拒绝）与 ③ 转存失败（result.audio_url
 *  24h 临时链接 → 自家 TOS）统一归并本工具兜底码 audio_speed_failed（1051），无 worker 级
 *  自动重试，上游可读原因随 message 透传前端投影，用户手动重试沿用冻结 input。
 *  入队失败不走本码，落 ERROR_ENQUEUE_FAILED（同家族口径）。 */
