-- 失败场景：V1 成功应用
CREATE TABLE IF NOT EXISTS project
(
    id           BIGINT PRIMARY KEY AUTO_INCREMENT,
    owner_id     BIGINT       NOT NULL,
    name         VARCHAR(128) NOT NULL
);
