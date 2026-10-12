ALTER TABLE billing_credit_lots
  DROP CHECK ck_lots__bounds;

ALTER TABLE billing_credit_lots
  DROP COLUMN frozen;

ALTER TABLE billing_credit_lots
  MODIFY COLUMN remaining BIGINT NOT NULL COMMENT '剩余总量（积分）';

ALTER TABLE billing_credit_lots
  ADD CONSTRAINT ck_lots__bounds CHECK (
    remaining >= 0 AND remaining <= amount
  );
