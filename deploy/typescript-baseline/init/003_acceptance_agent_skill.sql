INSERT INTO skill (
  id,
  name,
  description,
  source,
  category,
  sort_order
) VALUES (
  9001,
  'Acceptance Poster',
  'Deterministic official Skill used by the Node full-stack acceptance suite.',
  'official',
  'image',
  1
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
  'acceptance_poster',
  'Acceptance Poster',
  'Deterministic official Skill used by the Node full-stack acceptance suite.',
  9001,
  'acceptance-poster-v1',
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
  'acceptance-poster-v1',
  'acceptance_poster',
  '1.0.0',
  '# Acceptance Poster\n\nUse the frozen poster composition rules.',
  'sha256:131c6997ea0d081f4553e613a65ba7b047a33124784f51c5c4017cdfb9fe258b',
  'sha256:131c6997ea0d081f4553e613a65ba7b047a33124784f51c5c4017cdfb9fe258b'
);
