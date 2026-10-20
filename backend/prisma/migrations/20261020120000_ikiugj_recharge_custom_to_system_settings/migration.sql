SET NAMES utf8mb4;

INSERT INTO `system_settings`
  (`setting_key`, `setting_value`, `is_secret`, `gmt_create`, `gmt_modified`, `version`)
SELECT
  'rechargeCustom',
  JSON_OBJECT(
    'minCredits',           `min_credits`,
    'maxCredits',           `max_credits`,
    'defaultCredits',       `default_credits`,
    'creditsPerYuan',       `credits_per_yuan`,
    'stepCredits',          `step_credits`,
    'enabled',              IF(`enabled` = 1, CAST('true' AS JSON), CAST('false' AS JSON)),
    'permission',           `permission`,
    'permissionAllowlist',  `permission_allowlist`,
    'permissionDeniedHint', `permission_denied_hint`,
    'creditsValidMonths',   `credits_valid_months`
  ),
  0,
  `gmt_create`,
  `gmt_modified`,
  0
FROM `recharge_custom_config`
WHERE `id` = 1
ON DUPLICATE KEY UPDATE
  `setting_key` = 'rechargeCustom';
