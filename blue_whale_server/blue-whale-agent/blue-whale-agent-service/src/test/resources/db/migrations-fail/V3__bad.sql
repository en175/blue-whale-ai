-- 失败场景：V3 引用不存在的列，应触发 fail-closed
INSERT INTO project (id, nonexistent_column) VALUES (999, 1);
