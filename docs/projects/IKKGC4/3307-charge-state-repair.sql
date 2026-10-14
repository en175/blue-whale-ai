SET NAMES utf8mb4;
SET time_zone = '+08:00';
START TRANSACTION;

UPDATE blue_whale.generation_job_extras AS extra
JOIN blue_whale.generation_jobs AS job
  ON job.id = extra.generation_job_id
JOIN bw_billing.billing_cost_reservations AS reservation
  ON reservation.generation_job_id = job.id
SET extra.value_text = 'refunded', extra.gmt_modified = NOW()
WHERE job.id = 3307
  AND job.user_id = 68
  AND job.project_id = 434
  AND job.status = 'cancelled'
  AND job.provider_task_id IS NULL
  AND extra.extra_key = 'charge_state'
  AND extra.value_type = 'string'
  AND extra.value_text = 'held'
  AND reservation.user_id = job.user_id
  AND reservation.status = 'released'
  AND reservation.reserved_credits = 52
  AND reservation.actual_credits = 0
  AND EXISTS (
    SELECT 1 FROM bw_billing.billing_ledger_entries
    WHERE user_id = job.user_id AND biz_type = 'refund' AND biz_id = '3307'
      AND idempotency_key = 'refund:3307:wallet'
      AND account = 'wallet' AND direction = 'credit' AND amount = 52
  )
  AND EXISTS (
    SELECT 1 FROM bw_billing.billing_ledger_entries
    WHERE user_id = job.user_id AND biz_type = 'refund' AND biz_id = '3307'
      AND idempotency_key = 'refund:3307:frozen'
      AND account = 'frozen' AND direction = 'debit' AND amount = 52
  );

SELECT ROW_COUNT() AS updated_rows;
SELECT generation_job_id, extra_key, value_text, gmt_modified
FROM blue_whale.generation_job_extras
WHERE generation_job_id = 3307 AND extra_key = 'charge_state';

COMMIT;
