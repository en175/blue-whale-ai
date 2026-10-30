SET NAMES utf8mb4;
ALTER TABLE `catalog_skills`
    ADD COLUMN `creative_skill_id` VARCHAR(80) NULL AFTER `id`,
    ADD COLUMN `owner_user_id` BIGINT NOT NULL DEFAULT 0 AFTER `creative_skill_id`,
    ADD COLUMN `name_key` VARCHAR(255) NULL AFTER `name_zh`,
    ADD UNIQUE INDEX `uk_catalog_skills__creative_skill_id`(`creative_skill_id`),
    ADD INDEX `idx_catalog_skills__owner_active_sort`(`owner_user_id`, `is_delete`, `sort_order`),
    DROP INDEX `uk_name`;
UPDATE `catalog_skills` s
    JOIN `catalog_creative_skills` cs ON cs.source_skill_id = s.id AND cs.asset_domain = 'official'
    SET s.creative_skill_id = cs.creative_skill_id,
        s.name_key = cs.name_key,
        s.content = COALESCE(NULLIF(s.content, ''), (SELECT v.body FROM `catalog_creative_skill_versions` v WHERE v.creative_skill_id = cs.creative_skill_id ORDER BY (v.creative_skill_version_id = cs.active_version_id) DESC, v.id DESC LIMIT 1));
INSERT INTO `catalog_skills` (`creative_skill_id`, `owner_user_id`, `name`, `name_key`, `description`, `content`, `source`, `category`, `sort_order`, `is_delete`, `gmt_create`, `gmt_modified`)
    SELECT cs.creative_skill_id, cs.owner_user_id, cs.name, cs.name_key, cs.description,
           (SELECT v.body FROM `catalog_creative_skill_versions` v WHERE v.creative_skill_id = cs.creative_skill_id ORDER BY (v.creative_skill_version_id = cs.active_version_id) DESC, v.id DESC LIMIT 1),
           CASE WHEN cs.asset_domain = 'personal' THEN 'personal' ELSE 'official' END,
           'other', 0, 0, cs.gmt_create, cs.gmt_modified
      FROM `catalog_creative_skills` cs
     WHERE cs.creative_skill_id NOT IN (
           SELECT creative_skill_id FROM (SELECT `creative_skill_id` FROM `catalog_skills` WHERE `creative_skill_id` IS NOT NULL) t);
UPDATE `catalog_skills`
   SET `name_key` = LOWER(TRIM(REGEXP_REPLACE(`name`, '[[:space:]]+', ' ')))
 WHERE `name_key` IS NULL;
ALTER TABLE `catalog_skills`
    ADD UNIQUE INDEX `uk_catalog_skills__owner_name`(`owner_user_id`, `name_key`);
SELECT COUNT(*) AS `skills_without_content` FROM `catalog_skills` WHERE `content` IS NULL;
DROP TABLE IF EXISTS `catalog_creative_skill_versions`;
DROP TABLE IF EXISTS `catalog_creative_skills`;
