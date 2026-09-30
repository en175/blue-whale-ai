-- IKIZQ8：文生视频样片两阶段交付——generation_jobs 的阶段身份列。
--
-- 契约事实源 backend/libs/contracts/video-sample-mode.ts（IKIZQ5 冻结）：
--   · video_stage           阶段枚举（video/sample/final；NULL = 旧任务，投影缺省 video）
--   · upstream_created_at   可信上游 Draft created_at（IKIZKG：网关 SubmitTime 晚于它，
--                           不能当 7 天起算点；本地建行时间同理）
--   · finalize_deadline     实际转成片截止 = created_at + 7 天 − 1 小时安全余量
--   · charge_state / actual_credits  阶段费用状态与实结积分（Hold/Settle/Release 分阶段）
--   · source_sample_job_id / final_job_id  样片⇄成片互指（投影契约 §7 要求）
--
-- ── 刻意不建的东西 ──────────────────────────────────────────────────────────────
-- source_sample_job_id 的唯一约束（FINALIZE_SOURCE_UNIQUE_KEY）属后续成片子票：
-- 本票只有样片创建/交付，成片行不存在，约束此刻没有可约束的对象，提前建只会
-- 让「无成片」与「约束命中」两种状态在测试里纠缠。
--
-- ── 刻意用 NULL 而不是默认值 ────────────────────────────────────────────────────
-- 全部新列可空、无默认：存量行（普通视频/旧任务）保持 NULL = 按普通视频处理
-- （契约 §7「旧任务缺阶段字段按普通视频处理」），不给默认值就不会让存量行
-- 凭空长出「video」或「held」这类从未发生过的状态。
--
-- ── 刻意用 BIGINT 毫秒而不是 DATETIME ─────────────────────────────────────────
-- 截止公式以 epoch 毫秒为输入（契约 finalizeDeadlineFromUpstreamCreatedAt），
-- TS/Java 两端按同一公式金标对账（ADR-0084）：存毫秒整数消掉时区与秒以下精度
-- 两个漂移源，投影层再折 RFC3339 字符串。
SET NAMES utf8mb4;

ALTER TABLE `generation_jobs`
  ADD COLUMN `video_stage` VARCHAR(16) NULL
    COMMENT '两阶段视频阶段：sample=样片(480p Draft)；final=成片(后续票)；NULL=旧任务/普通视频（投影缺省 video）',
  ADD COLUMN `source_sample_job_id` BIGINT NULL
    COMMENT '成片指向来源样片任务（仅 final 非空；唯一约束随 finalize 票落地）',
  ADD COLUMN `final_job_id` BIGINT NULL
    COMMENT '样片指向其唯一成片任务（仅 sample 可非空；由 finalize 票回写）',
  ADD COLUMN `upstream_created_at_ms` BIGINT NULL
    COMMENT '可信上游 Draft created_at（epoch 毫秒，网关轮询回传；NULL=缺可信时间→禁成片但保留样片）',
  ADD COLUMN `finalize_deadline_ms` BIGINT NULL
    COMMENT '实际转成片截止（created_at+7天−1小时，契约同一公式跨语言对账；普通视频 NULL）',
  ADD COLUMN `charge_state` VARCHAR(16) NULL
    COMMENT '阶段费用状态 held/settled/released（创建 held、Worker 终态按 video_stage 条件写 settled/released）；旧任务 NULL',
  ADD COLUMN `actual_credits` INT NULL
    COMMENT '成功按真实用量结算后的整数积分（billing 异步回填；结算前 NULL）';
