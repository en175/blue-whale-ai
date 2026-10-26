-- 定价目录（《计费逻辑详细设计》§2.5 / 《数据表结构说明》§2.6）
--
-- 语义：一行 = 一个版本。**同时最多一条 status='active'**，其余是 draft（编辑中）
--       与 retired（历史，永不删——老 job 结算要按它复现定价）。
--
-- 为什么是「一份 JSON 文档」而不是价格行表：
--   · 定价规则要**整体发布、整体回滚**，行表做不到原子
--   · 一份 catalog ≈ 50 模型 × 5 任务 ≈ 250 条规则 < 300KB，可整体加载进内存
--   · 运营改价 = 改 JSON + 发布，不发版、不改表、不重启
--
-- document 的结构见《计费逻辑详细设计》§2.5.1；本迁移只建表，不塞种子数据
-- （初始定价是运营的事，且每个环境不同）。

CREATE TABLE IF NOT EXISTS billing_pricing_catalogs (
  id              BIGINT       NOT NULL AUTO_INCREMENT,

  -- 版本号单调递增；job 提交时冻结它，结算按冻结版本复现，所以**改价不影响已提交任务**
  catalog_version INT          NOT NULL,

  -- draft 编辑中 / active 生效中（全表至多一条）/ retired 历史
  status          VARCHAR(16)  NOT NULL,

  -- 完整规则文档。MySQL 8 的 JSON 类型会做格式校验——写坏 JSON 在插入时就失败
  document        JSON         NOT NULL,

  -- JSON Schema 版本：将来 document 结构演进时，据此判断按哪套解析
  schema_version  INT          NOT NULL,

  -- 内容 SHA-256。job 上也冻结它——版本号可被复用（人为重发同号），hash 不会
  document_hash   CHAR(64)     NOT NULL,

  effective_from  DATETIME     NULL,
  effective_to    DATETIME     NULL,

  published_by    VARCHAR(64)  NOT NULL,
  published_at    DATETIME     NOT NULL,
  note            VARCHAR(255) NOT NULL DEFAULT '',

  PRIMARY KEY (id),
  UNIQUE KEY uk_catalog__version (catalog_version),
  UNIQUE KEY uk_catalog__hash (document_hash),

  -- 查「当前生效版本」走这条
  KEY idx_catalog__status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='定价目录版本；同时至多一条 active';
