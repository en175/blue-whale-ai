-- IKI697 | 2026-09-23 | 音频混合结果卡持久状态：区分任务已受理未落卡、画布已落卡与用户主动删除。
ALTER TABLE `generation_jobs`
  ADD COLUMN `canvas_card_state` VARCHAR(16) NOT NULL DEFAULT 'pending';
