SET NAMES utf8mb4;

UPDATE `project_nodes` `n`
    JOIN `generation_canvas_node_owners` `o`
        ON `o`.`project_id` = `n`.`project_id` AND `o`.`node_id` = `n`.`node_id`
SET `n`.`owner_submission_id` = `o`.`generation_canvas_submission_id`,
    `n`.`owner_output_key` = `o`.`output_key`,
    `n`.`owner_binding_revision` = `o`.`binding_revision`;

INSERT INTO `project_nodes`
    (`project_id`, `node_id`, `type`, `source`, `is_delete`, `version`,
     `owner_submission_id`, `owner_output_key`, `owner_binding_revision`)
SELECT `o`.`project_id`, `o`.`node_id`, 'mediaNode', 'user', 1, 0,
       `o`.`generation_canvas_submission_id`, `o`.`output_key`, `o`.`binding_revision`
FROM `generation_canvas_node_owners` `o`
JOIN `project_canvas` `c`
    ON `c`.`project_id` = `o`.`project_id` AND `c`.`rows_authoritative` = 1
LEFT JOIN `project_nodes` `n`
    ON `n`.`project_id` = `o`.`project_id` AND `n`.`node_id` = `o`.`node_id`
WHERE `n`.`id` IS NULL;

DROP TABLE IF EXISTS `generation_canvas_node_owners`;
