-- IK6B3E 技能纵向黑盒验收种子：两条确定性官方技能。
-- 沿用 003_acceptance_agent_skill.sql 三表三行模式（skill → creative_skill → creative_skill_version）。
-- category 取 BFF 合法枚举（film/marketing），sort_order 接续 003 的 1；
-- digest = sha256(body 原文，无尾部换行)，与激活完整性校验约定一致。

INSERT INTO skill (
  id,
  name,
  description,
  source,
  category,
  sort_order
) VALUES (
  9002,
  'Acceptance Storyboard',
  'Deterministic official Skill for the skill journey blackbox acceptance suite.',
  'official',
  'film',
  2
);

INSERT INTO creative_skill (
  creative_skill_id,
  name,
  description,
  source_skill_id,
  active_version_id,
  owner_user_id,
  asset_domain
) VALUES (
  'acceptance_storyboard',
  'Acceptance Storyboard',
  'Deterministic official Skill for the skill journey blackbox acceptance suite.',
  9002,
  'acceptance-storyboard-v1',
  0,
  'official'
);

INSERT INTO creative_skill_version (
  creative_skill_version_id,
  creative_skill_id,
  display_version,
  body,
  content_digest,
  resource_digest
) VALUES (
  'acceptance-storyboard-v1',
  'acceptance_storyboard',
  '1.0.0',
  '# Acceptance Storyboard\n\nUse the frozen storyboard composition rules.',
  'sha256:28ce807eab91079af6cb2ad93244ae5568b214cc219ee56fad12e109091a34ba',
  'sha256:28ce807eab91079af6cb2ad93244ae5568b214cc219ee56fad12e109091a34ba'
);

INSERT INTO skill (
  id,
  name,
  description,
  source,
  category,
  sort_order
) VALUES (
  9003,
  'Acceptance Teaser',
  'Deterministic official Skill for the skill journey blackbox acceptance suite.',
  'official',
  'marketing',
  3
);

INSERT INTO creative_skill (
  creative_skill_id,
  name,
  description,
  source_skill_id,
  active_version_id,
  owner_user_id,
  asset_domain
) VALUES (
  'acceptance_teaser',
  'Acceptance Teaser',
  'Deterministic official Skill for the skill journey blackbox acceptance suite.',
  9003,
  'acceptance-teaser-v1',
  0,
  'official'
);

INSERT INTO creative_skill_version (
  creative_skill_version_id,
  creative_skill_id,
  display_version,
  body,
  content_digest,
  resource_digest
) VALUES (
  'acceptance-teaser-v1',
  'acceptance_teaser',
  '1.0.0',
  '# Acceptance Teaser\n\nUse the frozen teaser composition rules.',
  'sha256:28a83665d11fa8a2c88c21c3f92cee324aa0b2ddd93d1f98e328c156e20aec05',
  'sha256:28a83665d11fa8a2c88c21c3f92cee324aa0b2ddd93d1f98e328c156e20aec05'
);
