SET NAMES utf8mb4;

ALTER TABLE `project_nodes`
    ADD COLUMN `owner_submission_id` BIGINT NULL AFTER `is_delete`,
    ADD COLUMN `owner_output_key` VARCHAR(128) NULL AFTER `owner_submission_id`,
    ADD COLUMN `owner_binding_revision` INT NOT NULL DEFAULT 0 AFTER `owner_output_key`;

UPDATE `project_nodes` `n`
    JOIN `generation_canvas_node_owners` `o`
        ON `o`.`project_id` = `n`.`project_id` AND `o`.`node_id` = `n`.`node_id`
SET `n`.`owner_submission_id` = `o`.`generation_canvas_submission_id`,
    `n`.`owner_output_key` = `o`.`output_key`,
    `n`.`owner_binding_revision` = `o`.`binding_revision`;
