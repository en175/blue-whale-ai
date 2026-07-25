-- 迁移版本 V5：模板表公共持久化字段统一 + 幂等模板种子（IK1W1K）
--
-- 背景：template_card / template_card_image 的 V1 基线仍用旧审计列
-- （create_time/update_time/deleted，缺 version），而实体继承 BaseEntity，
-- ORM 按 gmt_create/gmt_modified/version/is_delete 访问 → 分页 count 查询
-- 稳定触发 MySQL 1054（未知列 is_delete），模板推荐链路整体不可用。
--
-- 本版本做的事（不改动已应用的 V1/V2/V3/V4；V3 = 游标去保留字 IK1W1M，V4 = 生成任务资产 IK1W1L）：
--   0. 表级守卫先行：任一表不存在时（补记 V1 不执行 V1 SQL 的生成域旧库，IK1Z51）
--      直接建出最终形态（公共字段 + 唯一键 + V1 普通索引），随后的列级守卫
--      与搬移全部幂等跳过，终态与空库路径一致，不再 fail-closed 误报 1146
--   1. 两表原地升级为 BaseEntity 公共持久化字段：新增 gmt_create/gmt_modified/
--      version/is_delete，旧列值搬入新列后删除旧列。主键 id 与 card_id 关联不动，
--      既有模板记录与图片关系全部保留，不删除、不替换数据卷。
--   2. 建立模板逻辑身份唯一键：template_card(tag_code,title)、
--      template_card_image(card_id,sort_order)，作为种子去重身份。
--      若旧库同一 (tag_code,title) 存在重复卡片（历史上重复手动执行旧 data.sql
--      导致），唯一键创建会失败——按 fail-closed 约定迁移明确报错，需人工按
--      「保留最小 id、重映射图片后删除重复行」处理后再重跑，不在迁移里静默删数据。
--   3. 导入模板种子（32 卡片 + 96 图片，内容与 db/data.sql 一致，INSERT IGNORE
--      靠上述唯一键幂等）：空库获得完整非空种子；缺模板数据的旧库补齐种子；
--      已有种子的旧库逐条跳过，数量与逻辑身份不变；重复执行/重复启动不产生重复。
--
-- 幂等约定：全部 DDL 经 information_schema 守卫（MySQL 8 无 ADD COLUMN IF NOT EXISTS），
-- 任意语句失败重跑安全；已应用版本由 schema_migrations 记账本跳过。

-- ============ template_card：字段统一 ============

-- 0) 表级守卫（IK1Z51）：表不存在直接建最终形态，随后 1)~4) 幂等跳过
SET @tc_create := (SELECT IF(COUNT(*) = 0,
  'CREATE TABLE template_card (id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT ''主键'', tag_code VARCHAR(64) NOT NULL COMMENT ''所属标签'', title VARCHAR(255) NOT NULL COMMENT ''卡片标题'', video_url VARCHAR(512) NULL COMMENT ''视频地址'', layout VARCHAR(32) NOT NULL COMMENT ''布局：wide/portrait/social/image'', sort_order INT NOT NULL DEFAULT 0 COMMENT ''排序'', gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT ''创建时间'', gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT ''更新时间'', version INT NOT NULL DEFAULT 0 COMMENT ''乐观锁版本'', is_delete TINYINT NOT NULL DEFAULT 0 COMMENT ''逻辑删除：0未删 1已删'', UNIQUE KEY uk_template_card_tag_title (tag_code, title), INDEX idx_tag_code (tag_code), INDEX idx_tag_sort (tag_code, sort_order)) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT =''模板卡片''',
  'SELECT 1')
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'template_card');
PREPARE stmt FROM @tc_create;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 1) 新增公共持久化字段（仅当 gmt_create 不存在）
SET @tc_add := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE template_card ADD COLUMN gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT ''创建时间'', ADD COLUMN gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT ''更新时间'', ADD COLUMN version INT NOT NULL DEFAULT 0 COMMENT ''乐观锁版本'', ADD COLUMN is_delete TINYINT NOT NULL DEFAULT 0 COMMENT ''逻辑删除：0未删 1已删''',
  'SELECT 1')
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'template_card' AND COLUMN_NAME = 'gmt_create');
PREPARE stmt FROM @tc_add;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2) 旧列值搬入新列（仅当旧列 create_time 仍存在；既有行保留原时间戳与删除标记）
SET @tc_backfill := (SELECT IF(COUNT(*) > 0,
  'UPDATE template_card SET gmt_create = create_time, gmt_modified = update_time, is_delete = deleted',
  'SELECT 1')
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'template_card' AND COLUMN_NAME = 'create_time');
PREPARE stmt FROM @tc_backfill;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3) 删除旧审计列（仅当仍存在）
SET @tc_drop := (SELECT IF(COUNT(*) > 0,
  'ALTER TABLE template_card DROP COLUMN create_time, DROP COLUMN update_time, DROP COLUMN deleted',
  'SELECT 1')
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'template_card' AND COLUMN_NAME = 'create_time');
PREPARE stmt FROM @tc_drop;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 4) 模板逻辑身份唯一键（仅当不存在）
SET @tc_uk := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE template_card ADD UNIQUE KEY uk_template_card_tag_title (tag_code, title)',
  'SELECT 1')
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'template_card' AND INDEX_NAME = 'uk_template_card_tag_title');
PREPARE stmt FROM @tc_uk;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============ template_card_image：字段统一 ============

-- 0) 表级守卫（IK1Z51）：表不存在直接建最终形态，随后 1)~4) 幂等跳过
SET @tci_create := (SELECT IF(COUNT(*) = 0,
  'CREATE TABLE template_card_image (id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT ''主键'', card_id BIGINT NOT NULL COMMENT ''卡片ID'', image_url VARCHAR(512) NOT NULL COMMENT ''图片地址'', sort_order INT NOT NULL DEFAULT 0 COMMENT ''排序'', gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT ''创建时间'', gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT ''更新时间'', version INT NOT NULL DEFAULT 0 COMMENT ''乐观锁版本'', is_delete TINYINT NOT NULL DEFAULT 0 COMMENT ''逻辑删除：0未删 1已删'', UNIQUE KEY uk_template_card_image_card_sort (card_id, sort_order), INDEX idx_card_id (card_id), INDEX idx_card_sort (card_id, sort_order)) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT =''卡片图片''',
  'SELECT 1')
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'template_card_image');
PREPARE stmt FROM @tci_create;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 1) 新增公共持久化字段
SET @tci_add := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE template_card_image ADD COLUMN gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT ''创建时间'', ADD COLUMN gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT ''更新时间'', ADD COLUMN version INT NOT NULL DEFAULT 0 COMMENT ''乐观锁版本'', ADD COLUMN is_delete TINYINT NOT NULL DEFAULT 0 COMMENT ''逻辑删除：0未删 1已删''',
  'SELECT 1')
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'template_card_image' AND COLUMN_NAME = 'gmt_create');
PREPARE stmt FROM @tci_add;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2) 旧列值搬入新列
SET @tci_backfill := (SELECT IF(COUNT(*) > 0,
  'UPDATE template_card_image SET gmt_create = create_time, gmt_modified = update_time, is_delete = deleted',
  'SELECT 1')
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'template_card_image' AND COLUMN_NAME = 'create_time');
PREPARE stmt FROM @tci_backfill;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3) 删除旧审计列
SET @tci_drop := (SELECT IF(COUNT(*) > 0,
  'ALTER TABLE template_card_image DROP COLUMN create_time, DROP COLUMN update_time, DROP COLUMN deleted',
  'SELECT 1')
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'template_card_image' AND COLUMN_NAME = 'create_time');
PREPARE stmt FROM @tci_drop;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 4) 图片逻辑身份唯一键（卡片内位置即身份；同一图片可在不同位置复用，故不用 image_url）
SET @tci_uk := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE template_card_image ADD UNIQUE KEY uk_template_card_image_card_sort (card_id, sort_order)',
  'SELECT 1')
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'template_card_image' AND INDEX_NAME = 'uk_template_card_image_card_sort');
PREPARE stmt FROM @tci_uk;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============ 模板种子（32 卡片 + 96 图片，内容与 db/data.sql 一致） ============
-- 幂等：卡片靠 uk_template_card_tag_title 去重；图片靠 uk_template_card_image_card_sort 去重，
-- 且经 (tag_code,title) 定位已存在卡片，重复执行不产生重复模板或图片关系。
-- 卡片
INSERT IGNORE INTO template_card (tag_code, title, video_url, layout, sort_order) VALUES
('marketing','为这款产品创作一条 UGC 广告','https://dj5nb01yl89hl.cloudfront.net/media/videos/-mpzxI3neDx6RPHe.mp4','wide',0),
('marketing','批量制作 10 条 UGC 带货广告','https://dj5nb01yl89hl.cloudfront.net/media/videos/nsycXrxRW2m5mMlT.mp4','wide',1),
('marketing','复刻这条爆款产品广告','https://dj5nb01yl89hl.cloudfront.net/media/videos/h-X9dnFvhDTTDBkP.mp4','wide',2),
('marketing','将商品链接制作成宣传视频','https://dj5nb01yl89hl.cloudfront.net/media/videos/mLXY1VGSVMZNrH9Q.mp4','wide',3),
('marketing','制作一条电影感 TVC 品牌广告','https://dj5nb01yl89hl.cloudfront.net/media/videos/LjhhcvHLHgA-MVYf.mp4','wide',4),
('marketing','为这套穿搭创作虚拟试穿视频','https://dj5nb01yl89hl.cloudfront.net/media/videos/ceFVpO2BdXf2lwHk.mp4','wide',5),
('marketing','为我的餐厅制作一条介绍视频','https://dj5nb01yl89hl.cloudfront.net/media/videos/rcZ2ANm3UZ-pIjbZ.mp4','wide',6),
('marketing','围绕我的产品讲述创意迷你故事','https://dj5nb01yl89hl.cloudfront.net/media/videos/_9_KDNonFOJHeGXC.mp4','wide',7);

INSERT IGNORE INTO template_card (tag_code, title, video_url, layout, sort_order) VALUES
('short','创作一条科幻微短片','https://dj5nb01yl89hl.cloudfront.net/media/videos/SUhCgSY7gkCnASIb.mp4','wide',0),
('short','写一个复仇戏剧场景','https://dj5nb01yl89hl.cloudfront.net/media/videos/xb5YzCSguqTuh6mv.mp4','wide',1),
('short','制作一段电影感打斗镜头','https://dj5nb01yl89hl.cloudfront.net/media/videos/G0-IA_s5rcnfnQWm.mp4','wide',2),
('short','创作一个动漫故事场景','https://dj5nb01yl89hl.cloudfront.net/media/videos/etuKTal_Ap5LZxAp.mp4','wide',3),
('short','制作睡前故事卡通片','https://dj5nb01yl89hl.cloudfront.net/media/videos/FwgACxWJV8rKzH5C.mp4','wide',4),
('short','创作游戏概念 CG 预告片','https://dj5nb01yl89hl.cloudfront.net/media/videos/MuDl8MaS470FRK1g.mp4','wide',5);

INSERT IGNORE INTO template_card (tag_code, title, video_url, layout, sort_order) VALUES
('replicate','复刻这条爆款产品广告','https://dj5nb01yl89hl.cloudfront.net/media/videos/h-X9dnFvhDTTDBkP.mp4','portrait',0),
('replicate','匹配这条视频的画面风格','https://dj5nb01yl89hl.cloudfront.net/media/videos/HLGLWgAHa1iB32mA.mp4','portrait',1),
('replicate','复用这条视频的脚本结构','https://dj5nb01yl89hl.cloudfront.net/media/videos/4wVEAaW2mHt-HAB2.mp4','portrait',2),
('replicate','制作日语版本','https://dj5nb01yl89hl.cloudfront.net/media/videos/UMj9H3kjcdsAKI_z.mp4','portrait',3),
('replicate','替换视频中的人物','https://dj5nb01yl89hl.cloudfront.net/media/videos/rsO3wYxttdXIPaZR.mp4','portrait',4),
('replicate','将卡通转为真人实拍','https://dj5nb01yl89hl.cloudfront.net/media/videos/JbC_kdA6Vi3y98Tt.mp4','portrait',5);

INSERT IGNORE INTO template_card (tag_code, title, video_url, layout, sort_order) VALUES
('social','制作魔法变装过渡视频','https://dj5nb01yl89hl.cloudfront.net/media/videos/6GL-uzfBX964bCGL.mp4','social',0),
('social','创作精致生活 vlog','https://dj5nb01yl89hl.cloudfront.net/media/videos/SKIHQUzxA5j4GXAw.mp4','social',1),
('social','生成播客讨论片段','https://dj5nb01yl89hl.cloudfront.net/media/videos/MMsWQ3wk1T5MkPCg.mp4','social',2),
('social','用视觉方式讲解概念','https://dj5nb01yl89hl.cloudfront.net/media/videos/gKEPjwIurn7zaxDT.mp4','social',3),
('social','让我的宠物表演技能','https://dj5nb01yl89hl.cloudfront.net/media/videos/BSObfzWakPHAufBw.mp4','social',4),
('social','制作搞笑短视频','https://dj5nb01yl89hl.cloudfront.net/media/videos/6P2l5OiSxdVt6ZNg.mp4','social',5);

INSERT IGNORE INTO template_card (tag_code, title, video_url, layout, sort_order) VALUES
('image','设计高级产品主图',NULL,'image',0),
('image','制作商品详情页',NULL,'image',1),
('image','设计营销活动海报',NULL,'image',2),
('image','设计 YouTube 缩略图',NULL,'image',3),
('image','为这款产品设计包装',NULL,'image',4),
('image','创作现代品牌 logo',NULL,'image',5);

-- 卡片图片
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/FE_KPAFDu3_1pSmz.webp', 0 FROM template_card WHERE tag_code = 'marketing' AND title = '为这款产品创作一条 UGC 广告';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/5xZj1ipYwfJ2Jqc_.webp', 1 FROM template_card WHERE tag_code = 'marketing' AND title = '为这款产品创作一条 UGC 广告';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/G_FZ4A6ZT9P22LMm.webp', 2 FROM template_card WHERE tag_code = 'marketing' AND title = '为这款产品创作一条 UGC 广告';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/9kFOn0lb6hS6iaXh.webp', 0 FROM template_card WHERE tag_code = 'marketing' AND title = '批量制作 10 条 UGC 带货广告';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/DLgyrYhQzEOEOlub.webp', 1 FROM template_card WHERE tag_code = 'marketing' AND title = '批量制作 10 条 UGC 带货广告';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/uYejUwXFI6kXmyw-.webp', 2 FROM template_card WHERE tag_code = 'marketing' AND title = '批量制作 10 条 UGC 带货广告';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/9uePP4nYY3AgCGv_.webp', 0 FROM template_card WHERE tag_code = 'marketing' AND title = '复刻这条爆款产品广告';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/6jlOXdNzAKXJuHsZ.webp', 1 FROM template_card WHERE tag_code = 'marketing' AND title = '复刻这条爆款产品广告';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/v6Waw_zcXtavbM2v.webp', 2 FROM template_card WHERE tag_code = 'marketing' AND title = '复刻这条爆款产品广告';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/Zgi6Lycj1HnnrNxg.webp', 0 FROM template_card WHERE tag_code = 'marketing' AND title = '将商品链接制作成宣传视频';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/n0jNm5MblskBnAw5.webp', 1 FROM template_card WHERE tag_code = 'marketing' AND title = '将商品链接制作成宣传视频';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/Cyj815TQRkO2oQNZ.webp', 2 FROM template_card WHERE tag_code = 'marketing' AND title = '将商品链接制作成宣传视频';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/i93ZgDkJEps7epld.webp', 0 FROM template_card WHERE tag_code = 'marketing' AND title = '制作一条电影感 TVC 品牌广告';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/qsmne3iarr9MWE6o.webp', 1 FROM template_card WHERE tag_code = 'marketing' AND title = '制作一条电影感 TVC 品牌广告';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/AyZO2JThG8uDovUL.webp', 2 FROM template_card WHERE tag_code = 'marketing' AND title = '制作一条电影感 TVC 品牌广告';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/jzekLVhMO34tTkYx.webp', 0 FROM template_card WHERE tag_code = 'marketing' AND title = '为这套穿搭创作虚拟试穿视频';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/r8Dw6RhjZM1FkCIv.webp', 1 FROM template_card WHERE tag_code = 'marketing' AND title = '为这套穿搭创作虚拟试穿视频';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/5OWTYORTLl88jOSJ.webp', 2 FROM template_card WHERE tag_code = 'marketing' AND title = '为这套穿搭创作虚拟试穿视频';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/UX1Wpr8ewZNJCQT6.webp', 0 FROM template_card WHERE tag_code = 'marketing' AND title = '为我的餐厅制作一条介绍视频';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/TzaJpgmaMpXCx4RG.webp', 1 FROM template_card WHERE tag_code = 'marketing' AND title = '为我的餐厅制作一条介绍视频';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/iwok04AOcwZw7buj.webp', 2 FROM template_card WHERE tag_code = 'marketing' AND title = '为我的餐厅制作一条介绍视频';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/_zApAwlJrwvOAcPZ.webp', 0 FROM template_card WHERE tag_code = 'marketing' AND title = '围绕我的产品讲述创意迷你故事';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/axJySYoruc-wE6OR.webp', 1 FROM template_card WHERE tag_code = 'marketing' AND title = '围绕我的产品讲述创意迷你故事';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/sKmP5bOxwRd56yTz.webp', 2 FROM template_card WHERE tag_code = 'marketing' AND title = '围绕我的产品讲述创意迷你故事';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/QMzRjaueg94jFAKd.webp', 0 FROM template_card WHERE tag_code = 'short' AND title = '创作一条科幻微短片';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/1X7kMpevz2YUmFEG.webp', 1 FROM template_card WHERE tag_code = 'short' AND title = '创作一条科幻微短片';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/zaFT3jymqL21n5PR.webp', 2 FROM template_card WHERE tag_code = 'short' AND title = '创作一条科幻微短片';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/oobUck_dyMQGtO_h.webp', 0 FROM template_card WHERE tag_code = 'short' AND title = '写一个复仇戏剧场景';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/TiiebwCiUmRrETmc.webp', 1 FROM template_card WHERE tag_code = 'short' AND title = '写一个复仇戏剧场景';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/IU__VZglonHTjH16.webp', 2 FROM template_card WHERE tag_code = 'short' AND title = '写一个复仇戏剧场景';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/cB3I6Weje7xb3a6Q.webp', 0 FROM template_card WHERE tag_code = 'short' AND title = '制作一段电影感打斗镜头';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/IjVSkcC14UB9MXDn.webp', 1 FROM template_card WHERE tag_code = 'short' AND title = '制作一段电影感打斗镜头';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/J1RBgGJwK24W6obb.webp', 2 FROM template_card WHERE tag_code = 'short' AND title = '制作一段电影感打斗镜头';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/698jiFEfkUdZgpqL.webp', 0 FROM template_card WHERE tag_code = 'short' AND title = '创作一个动漫故事场景';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/fKPnoSmGI4z4_OTK.webp', 1 FROM template_card WHERE tag_code = 'short' AND title = '创作一个动漫故事场景';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/IU9FQa4VABQy0es8.webp', 2 FROM template_card WHERE tag_code = 'short' AND title = '创作一个动漫故事场景';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/PT2ditJYpti1P0Du.webp', 0 FROM template_card WHERE tag_code = 'short' AND title = '制作睡前故事卡通片';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/Q5tevhddZtl8VQdR.webp', 1 FROM template_card WHERE tag_code = 'short' AND title = '制作睡前故事卡通片';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/N1z9HPHJGPWPUgCI.webp', 2 FROM template_card WHERE tag_code = 'short' AND title = '制作睡前故事卡通片';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/5oKg1UXaJ2Z4nM6u.webp', 0 FROM template_card WHERE tag_code = 'short' AND title = '创作游戏概念 CG 预告片';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/m2VCC3H1hEDCLWgV.webp', 1 FROM template_card WHERE tag_code = 'short' AND title = '创作游戏概念 CG 预告片';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/Ct2YsBZo_HYSuDE5.webp', 2 FROM template_card WHERE tag_code = 'short' AND title = '创作游戏概念 CG 预告片';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/9uePP4nYY3AgCGv_.webp', 0 FROM template_card WHERE tag_code = 'replicate' AND title = '复刻这条爆款产品广告';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/6jlOXdNzAKXJuHsZ.webp', 1 FROM template_card WHERE tag_code = 'replicate' AND title = '复刻这条爆款产品广告';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/v6Waw_zcXtavbM2v.webp', 2 FROM template_card WHERE tag_code = 'replicate' AND title = '复刻这条爆款产品广告';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/z6M6FSvwOkHmYQEh.webp', 0 FROM template_card WHERE tag_code = 'replicate' AND title = '匹配这条视频的画面风格';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/9_FUvk0EAmifE-tM.webp', 1 FROM template_card WHERE tag_code = 'replicate' AND title = '匹配这条视频的画面风格';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/yxESD9bh9KPi0UvK.webp', 2 FROM template_card WHERE tag_code = 'replicate' AND title = '匹配这条视频的画面风格';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/mlIaIO5R2bBtKRsS.webp', 0 FROM template_card WHERE tag_code = 'replicate' AND title = '复用这条视频的脚本结构';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/vvLPWoQ0lXsussRR.webp', 1 FROM template_card WHERE tag_code = 'replicate' AND title = '复用这条视频的脚本结构';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/qVVR_FIiL4Ho-sxl.webp', 2 FROM template_card WHERE tag_code = 'replicate' AND title = '复用这条视频的脚本结构';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/lVijg7xe9t2sXxyN.webp', 0 FROM template_card WHERE tag_code = 'replicate' AND title = '制作日语版本';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/rWdXNaQbrD3hgKwL.webp', 1 FROM template_card WHERE tag_code = 'replicate' AND title = '制作日语版本';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/Da6wr0YzPylzzdwM.webp', 2 FROM template_card WHERE tag_code = 'replicate' AND title = '制作日语版本';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/GEGnzOxq2o4BrkCd.webp', 0 FROM template_card WHERE tag_code = 'replicate' AND title = '替换视频中的人物';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/da1miHOzrNT8F3XJ.webp', 1 FROM template_card WHERE tag_code = 'replicate' AND title = '替换视频中的人物';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/NWm29zo0ikTYFlvS.webp', 2 FROM template_card WHERE tag_code = 'replicate' AND title = '替换视频中的人物';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/nvyICkcksVoJOLdw.webp', 0 FROM template_card WHERE tag_code = 'replicate' AND title = '将卡通转为真人实拍';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/TEzXSRur0lRYzX_L.webp', 1 FROM template_card WHERE tag_code = 'replicate' AND title = '将卡通转为真人实拍';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/T2_E806YADXpCbgX.webp', 2 FROM template_card WHERE tag_code = 'replicate' AND title = '将卡通转为真人实拍';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/QSw9ImK22KG9sXW4.webp', 0 FROM template_card WHERE tag_code = 'social' AND title = '制作魔法变装过渡视频';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/s5VbfuAiZPkW5lA1.webp', 1 FROM template_card WHERE tag_code = 'social' AND title = '制作魔法变装过渡视频';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/Rf2-yJXjx2gyAwKm.webp', 2 FROM template_card WHERE tag_code = 'social' AND title = '制作魔法变装过渡视频';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/8Whi6pO7JSc3wJ28.webp', 0 FROM template_card WHERE tag_code = 'social' AND title = '创作精致生活 vlog';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/Cod28Krz-QPfM4yX.webp', 1 FROM template_card WHERE tag_code = 'social' AND title = '创作精致生活 vlog';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/goniNlyRVWrButw6.webp', 2 FROM template_card WHERE tag_code = 'social' AND title = '创作精致生活 vlog';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/2mhTuNW0qSurovSs.webp', 0 FROM template_card WHERE tag_code = 'social' AND title = '生成播客讨论片段';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/xORgW-O0IVNg7q85.webp', 1 FROM template_card WHERE tag_code = 'social' AND title = '生成播客讨论片段';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/2mhTuNW0qSurovSs.webp', 2 FROM template_card WHERE tag_code = 'social' AND title = '生成播客讨论片段';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/lY4r8HnncvG-JPbf.webp', 0 FROM template_card WHERE tag_code = 'social' AND title = '用视觉方式讲解概念';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/VqAxXPxzhMJbgZOs.webp', 1 FROM template_card WHERE tag_code = 'social' AND title = '用视觉方式讲解概念';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/nKo-wn5RR9K3i5Tm.webp', 2 FROM template_card WHERE tag_code = 'social' AND title = '用视觉方式讲解概念';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/sF_29b3xmUMUc4Ok.webp', 0 FROM template_card WHERE tag_code = 'social' AND title = '让我的宠物表演技能';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/cOV-n2-wGYcghVfF.webp', 1 FROM template_card WHERE tag_code = 'social' AND title = '让我的宠物表演技能';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/FBdAP7rRuge74fAW.webp', 2 FROM template_card WHERE tag_code = 'social' AND title = '让我的宠物表演技能';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/b1or-eReUFoTl7Qg.webp', 0 FROM template_card WHERE tag_code = 'social' AND title = '制作搞笑短视频';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/-ypogTE-7BGyqNnv.webp', 1 FROM template_card WHERE tag_code = 'social' AND title = '制作搞笑短视频';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/QCVDx08bltQWls-P.webp', 2 FROM template_card WHERE tag_code = 'social' AND title = '制作搞笑短视频';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/Y7Ryu1R1dSdJU2Dx.webp', 0 FROM template_card WHERE tag_code = 'image' AND title = '设计高级产品主图';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/LSt66iNTvPa_ipyk.webp', 1 FROM template_card WHERE tag_code = 'image' AND title = '设计高级产品主图';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/prwLhlnCmgiur42e.webp', 2 FROM template_card WHERE tag_code = 'image' AND title = '设计高级产品主图';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/xXyrFPyISEKtmR2b.webp', 0 FROM template_card WHERE tag_code = 'image' AND title = '制作商品详情页';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/Ed-JQeCGSqMH98ua.webp', 1 FROM template_card WHERE tag_code = 'image' AND title = '制作商品详情页';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/VCMgO0HQJWY4VTnL.webp', 2 FROM template_card WHERE tag_code = 'image' AND title = '制作商品详情页';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/4VrENnbmYOWTAEfS.webp', 0 FROM template_card WHERE tag_code = 'image' AND title = '设计营销活动海报';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/Jt_GpabYZpePnhA4.webp', 1 FROM template_card WHERE tag_code = 'image' AND title = '设计营销活动海报';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/Nobu4qir_1GgQa6G.webp', 2 FROM template_card WHERE tag_code = 'image' AND title = '设计营销活动海报';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/Zuj-C-X3v-zM2Ww7.webp', 0 FROM template_card WHERE tag_code = 'image' AND title = '设计 YouTube 缩略图';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/QkEm2g7fufauhHJm.webp', 1 FROM template_card WHERE tag_code = 'image' AND title = '设计 YouTube 缩略图';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/_P1N5XPE6fSOyAUA.webp', 2 FROM template_card WHERE tag_code = 'image' AND title = '设计 YouTube 缩略图';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/56HBa0ScjFVdL317.webp', 0 FROM template_card WHERE tag_code = 'image' AND title = '为这款产品设计包装';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/yCYWs2CuApdRla-8.webp', 1 FROM template_card WHERE tag_code = 'image' AND title = '为这款产品设计包装';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/hQo30udvYe_zOVOL.webp', 2 FROM template_card WHERE tag_code = 'image' AND title = '为这款产品设计包装';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/xEPEqZnU1gZoAVHx.webp', 0 FROM template_card WHERE tag_code = 'image' AND title = '创作现代品牌 logo';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/Hy89VuSzZW12qIJQ.webp', 1 FROM template_card WHERE tag_code = 'image' AND title = '创作现代品牌 logo';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/_Y4JcvCCrrkZD5SF.webp', 2 FROM template_card WHERE tag_code = 'image' AND title = '创作现代品牌 logo';
