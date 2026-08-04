-- DropIndex
DROP INDEX `uk_agent_advance_run` ON `agent_advances`;

-- DropIndex
DROP INDEX `uk_input_request_resumed_run` ON `user_input_requests`;

-- CreateIndex
CREATE UNIQUE INDEX `uk_agent_advance_run_ordinal` ON `agent_advances`(`agent_run_id`, `ordinal`);
