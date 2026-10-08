SET NAMES utf8mb4;

UPDATE `generation_jobs`
SET `input` = JSON_REMOVE(`input`, '$.provider_credential')
WHERE JSON_CONTAINS_PATH(`input`, 'one', '$.provider_credential');

UPDATE `generation_job_logs`
SET `payload` = JSON_REMOVE(`payload`, '$.input.provider_credential')
WHERE JSON_CONTAINS_PATH(`payload`, 'one', '$.input.provider_credential');
