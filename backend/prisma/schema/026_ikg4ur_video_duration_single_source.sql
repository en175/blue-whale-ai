-- IKG4UR：视频/音频时长统一——**形态唯一（对象）且来源唯一（基础行）**。
--
-- 问题：同一个时长此前被三层管着，且读法不一致——
--   1. 基础行 supported_durations：**数组**会被 durationInRange 当**档位列表**（includes）、
--      被 toDurationRange 与前端滑杆当**区间**（min=json[0], max=json[1]）；
--   2. features.task_types[*].allowed_durations：把**连续区间错写成若干档枚举**，
--      而官方口径是连续区间（Seedance 2.0 系 4–15 整数秒；2.5 4–30 整数秒，
--      上游报错形如 `duration 30 out of range [4, 15]`）。命中该枚举时校验取枚举，
--      于是滑杆给得出的 6–9（2.0）/ 7·9·11…（2.5）提交必被 400；
--   3. 写侧闸门只收数字数组或 null，后台把对象行读成空后写回 null，把整列清空。
--
-- 本迁移做三件事：
--   (1) 移除 task_types 里的 allowed_durations（保留同项的 allowed_ratios）；
--   (2) **把全表残留的数组形态统一转成对象**——通用规则，不枚举 model_id，
--       这样线上任何我没见过的数组行也一并收敛；
--   (3) 核正 Seedance 2.0 的区间为官方 4–15。
--
-- ⚠️ 不按 provider_id 过滤：本仓 seed 写的是 'new-api'，但线上/本地存量行的
--    provider_id 实为 'volcengine'（早期导入），按 'new-api' 过滤会静默漏改。
--    注：唯一键是 (provider_id, model_id)，model_id 本身不唯一——同 model_id 的重复行会一并订正，
--    这对本例是正确的（同一模型同一真值）。
--
-- 说明：`-1`（智能时长）本轮不接——它需要「区间 + 额外允许值」的表达，当前数据形态给不了；
-- 待接入时再单独设计。因此 edit / prolong 现按基础行区间校验。
--
-- ⚠️ 上线前必跑（pre-flight）：列出**所有不会被 step 2 改写**的数组行，人工处置后再上线。
--    下面五种形态都会被守卫挡下（机器无法安全推断语义，宁可留给人）：
--      ① 长度 <2（含 []）        ② 元素非数字 / 含 null
--      ③ 任一元素为负（-1 是本仓「智能时长」哨兵）   ④ min > max
--      ⑤ step <= 0
--    把它们原样留在库里会违反「形态唯一」，且 ①④ 会让该模型的滑杆消失、任何时长都被 400 拒。
--      SELECT id, provider_id, model_id, capability_type,
--             CAST(supported_durations AS CHAR)                                              AS 原值,
--             JSON_LENGTH(supported_durations)                                               AS 长度,
--             CAST(supported_durations ->> '$[0]' AS SIGNED)                                 AS min_,
--             CAST(supported_durations ->> '$[1]' AS SIGNED)                                 AS max_,
--             CAST(supported_durations ->> '$[2]' AS SIGNED)                                 AS step_
--      FROM generation_model_capability
--      WHERE is_delete = 0 AND JSON_TYPE(supported_durations) = 'ARRAY';
--
-- 双轨：本文件与 backend/prisma/migrations/20260916120000_ikg4ur_video_duration_single_source/migration.sql
--       内容需逐字一致（有 parity 测试断言）。

SET NAMES utf8mb4;

-- 1) 移除按任务类型的时长枚举（只对确实配了 task_types 的行动手，避免误伤）
UPDATE `generation_model_capability`
SET `features` = JSON_REMOVE(
      `features`,
      '$.task_types.default.allowed_durations',
      '$.task_types.first_frame.allowed_durations',
      '$.task_types.first_last_frame.allowed_durations',
      '$.task_types.edit.allowed_durations',
      '$.task_types.prolong.allowed_durations'
    )
WHERE `is_delete` = 0
  AND JSON_TYPE(`features`) = 'OBJECT'
  AND JSON_CONTAINS_PATH(`features`, 'one', '$.task_types');

-- 2) 全表数组形态 → 对象形态：`[min, max]` / `[min, max, step]` 一律归一
--    ⚠️ 四组守卫，任一不满足即**不放行**（见顶部 pre-flight，交人工）：
--    - 元素非数字 / 长度 <2：无法表达区间；`[]` 会让该模型所有时长被拒。
--    - 负值：CAST(... AS UNSIGNED) 会把 -1 回绕成 18446744073709551615。
--    - min > max：`toDurationRange` 判 max<min 返回 null（滑杆消失），
--      `durationInRange` 恒 false（任何时长 400）——与负值同一条死路。
--    - step <= 0：滑杆会被钉死在 min（snapDuration 对超大/非正 step 退化）。
--    这些行的正确语义机器猜不出来，且后台因 min>max 被写侧闸门拦下也修不回，只能人工。
UPDATE `generation_model_capability`
SET `supported_durations` = JSON_OBJECT(
      'min',  CAST(`supported_durations` ->> '$[0]' AS UNSIGNED),
      'max',  CAST(`supported_durations` ->> '$[1]' AS UNSIGNED),
      'step', CAST(COALESCE(`supported_durations` ->> '$[2]', '1') AS UNSIGNED)
    )
WHERE `is_delete` = 0
  AND JSON_TYPE(`supported_durations`) = 'ARRAY'
  AND JSON_LENGTH(`supported_durations`) >= 2
  AND JSON_TYPE(JSON_EXTRACT(`supported_durations`, '$[0]')) IN ('INTEGER', 'DOUBLE', 'DECIMAL')
  AND JSON_TYPE(JSON_EXTRACT(`supported_durations`, '$[1]')) IN ('INTEGER', 'DOUBLE', 'DECIMAL')
  AND CAST(`supported_durations` ->> '$[0]' AS SIGNED) >= 0
  AND CAST(`supported_durations` ->> '$[1]' AS SIGNED) >= 0
  AND CAST(`supported_durations` ->> '$[0]' AS SIGNED) <= CAST(`supported_durations` ->> '$[1]' AS SIGNED)
  AND (
        `supported_durations` ->> '$[2]' IS NULL
        OR CAST(`supported_durations` ->> '$[2]' AS SIGNED) > 0
      );

-- 3) Seedance 2.0 基础行核正为官方区间 4–15
UPDATE `generation_model_capability`
SET `supported_durations` = CAST('{"min":4,"max":15,"step":1}' AS JSON)
WHERE `model_id` = 'doubao-seedance-2-0-260128' AND `is_delete` = 0;

-- 4) 音频没有可配时长：上游 Seed Audio 是 TTS 式接口（text_prompt + audio_config），
--    时长由文案决定、请求里没有 duration 参数。原先那行 1–120 只是「区间提示」，
--    前端不读、后端不校验、出站不带——是死配置。置 NULL 以维持
--    「supported_durations 非空 ⟺ 该模型时长可配」这条不变式（与图片/文生文行一致）。
UPDATE `generation_model_capability`
SET `supported_durations` = NULL
WHERE `capability_type` = 'audio' AND `is_delete` = 0;
