-- 测试用 V1 基线：最小 schema，含 project 表（旧库判定基准）+ 一个审计列约定表
CREATE TABLE IF NOT EXISTS project
(
    id           BIGINT PRIMARY KEY AUTO_INCREMENT,
    owner_id     BIGINT       NOT NULL,
    name         VARCHAR(128) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS canvas
(
    id         BIGINT PRIMARY KEY AUTO_INCREMENT,
    project_id BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
