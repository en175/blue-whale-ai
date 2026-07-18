-- 测试用 V2 seed：幂等 INSERT
INSERT IGNORE INTO project (id, owner_id, name) VALUES (1, 100, 'seed-project');
