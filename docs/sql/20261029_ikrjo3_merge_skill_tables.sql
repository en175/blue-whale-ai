SET NAMES utf8mb4;
ALTER TABLE `catalog_skills`
    ADD COLUMN `creative_skill_id` VARCHAR(80) NULL AFTER `id`,
    ADD COLUMN `owner_user_id` BIGINT NOT NULL DEFAULT 0 AFTER `creative_skill_id`,
    ADD COLUMN `asset_domain` VARCHAR(16) NOT NULL DEFAULT 'official' AFTER `owner_user_id`,
    ADD COLUMN `body` LONGTEXT NULL AFTER `content`,
    ADD COLUMN `content_digest` VARCHAR(71) NULL AFTER `body`,
    ADD COLUMN `auto_match` TINYINT NOT NULL DEFAULT 0 AFTER `content_digest`,
    ADD COLUMN `name_key` VARCHAR(255) NULL AFTER `name_zh`,
    ADD UNIQUE INDEX `uk_catalog_skills__creative_skill_id`(`creative_skill_id`),
    ADD INDEX `idx_catalog_skills__owner_name_key`(`owner_user_id`, `name_key`),
    ADD INDEX `idx_catalog_skills__owner_domain`(`owner_user_id`, `asset_domain`),
    DROP INDEX `uk_name`;
UPDATE `catalog_skills` s
    JOIN `catalog_creative_skills` cs ON cs.source_skill_id = s.id AND cs.asset_domain = 'official'
    SET s.creative_skill_id = cs.creative_skill_id,
        s.name_key = cs.name_key,
        s.body = (SELECT v.body FROM `catalog_creative_skill_versions` v WHERE v.creative_skill_id = cs.creative_skill_id ORDER BY (v.creative_skill_version_id = cs.active_version_id) DESC, v.id DESC LIMIT 1);
INSERT INTO `catalog_skills` (`creative_skill_id`, `owner_user_id`, `asset_domain`, `name`, `description`, `name_key`, `body`, `source`, `category`, `sort_order`, `is_delete`, `gmt_create`, `gmt_modified`)
    SELECT cs.creative_skill_id, cs.owner_user_id, cs.asset_domain, cs.name, cs.description, cs.name_key,
           (SELECT v.body FROM `catalog_creative_skill_versions` v WHERE v.creative_skill_id = cs.creative_skill_id ORDER BY (v.creative_skill_version_id = cs.active_version_id) DESC, v.id DESC LIMIT 1),
           CASE WHEN cs.asset_domain = 'personal' THEN 'personal' ELSE 'official' END,
           'other', 0, 0, cs.gmt_create, cs.gmt_modified
      FROM `catalog_creative_skills` cs
     WHERE cs.creative_skill_id NOT IN (
           SELECT creative_skill_id FROM (SELECT `creative_skill_id` FROM `catalog_skills` WHERE `creative_skill_id` IS NOT NULL) t);
UPDATE `catalog_skills` SET `body` = `content` WHERE `body` IS NULL AND `content` IS NOT NULL;
UPDATE `catalog_skills` SET `content_digest` = CONCAT('sha256:', SHA2(`body`, 256)) WHERE `body` IS NOT NULL AND `content_digest` IS NULL;
SELECT COUNT(*) AS `skills_without_body` FROM `catalog_skills` WHERE `body` IS NULL;
ALTER TABLE `catalog_skills` DROP COLUMN `content`;
DROP TABLE IF EXISTS `catalog_creative_skill_versions`;
DROP TABLE IF EXISTS `catalog_creative_skills`;
