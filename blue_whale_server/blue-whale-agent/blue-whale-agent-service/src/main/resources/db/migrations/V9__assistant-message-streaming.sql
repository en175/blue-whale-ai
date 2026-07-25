-- Assistant 文本先私有持久化，经 OutputReleaseGate 放行后才进入 Conversation 与 Project SSE。
ALTER TABLE conversation_messages
    ADD COLUMN stream_id VARCHAR(128) NULL AFTER client_message_id,
    ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'completed' AFTER content,
    ADD COLUMN last_chunk_sequence INT NOT NULL DEFAULT 0 AFTER status,
    ADD UNIQUE KEY uk_conversation_stream (stream_id);

CREATE TABLE IF NOT EXISTS assistant_message_streams
(
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    stream_id VARCHAR(128) NOT NULL,
    agent_run_id BIGINT NOT NULL,
    project_id BIGINT NOT NULL,
    conversation_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    message_id BIGINT NOT NULL,
    status VARCHAR(16) NOT NULL,
    last_sequence_no INT NOT NULL DEFAULT 0,
    released_sequence_no INT NOT NULL DEFAULT 0,
    start_idempotency_key VARCHAR(128) NOT NULL,
    complete_idempotency_key VARCHAR(128) NULL,
    content_digest VARCHAR(64) NULL,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    version INT NOT NULL DEFAULT 0,
    is_delete TINYINT NOT NULL DEFAULT 0,
    UNIQUE KEY uk_assistant_stream_id (stream_id),
    UNIQUE KEY uk_assistant_stream_run (agent_run_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT ='Assistant 私有输出流状态';

CREATE TABLE IF NOT EXISTS assistant_message_chunks
(
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    assistant_message_stream_id BIGINT NOT NULL,
    sequence_no INT NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL,
    content TEXT NOT NULL,
    content_digest VARCHAR(64) NOT NULL,
    released TINYINT NOT NULL DEFAULT 0,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    version INT NOT NULL DEFAULT 0,
    is_delete TINYINT NOT NULL DEFAULT 0,
    UNIQUE KEY uk_assistant_chunk_sequence (assistant_message_stream_id, sequence_no),
    UNIQUE KEY uk_assistant_chunk_idempotency (assistant_message_stream_id, idempotency_key)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT ='Assistant 原始私有文本分块';
