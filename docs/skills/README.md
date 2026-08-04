# 产品技能资产区（skills）

本目录集中管理**产品侧技能资产**：创作技能库（SKILL.md 定义 + 封面图）、本地技能包、产品技能规格。

## 定位

- 与 `docs/projects/`（需求/验收）、`docs/specs/`（规格契约）、`docs/adr/`（决策）并列的产品文档归档区
- 属于散文文档（ADR-0025 例外区）：产品侧可直接在 master 直改，落盘走 `scripts/commit-spec-on-master.sh`
- 非代码：不含可执行代码、构建产物；技能内容仅定义与素材

## 目录约定

| 子目录 | 内容 | 说明 |
| --- | --- | --- |
| `library/` | 创作技能库（`raw/` 技能定义 + `covers/` 封面图 + `_index.md`） | 产品创作 Skill 资产，技能面板可消费 |
| `video-director-local/` | 视频导演本地版技能包（自包含，可整体复制到本地 skills 路径） | 本地工具技能，随产品迭代 |
| `*.md` | 产品技能规格（如 `video-director-presentation-spec.md`） | PM 权威规格，迭代中 |

## 新增规范

- 新增创作技能：`library/raw/cn<编号>-<名称>.md` + `library/covers/cn<编号>-<名称>.png`，同步更新 `library/_index.md`
- 新增技能规格：本目录下 `*.md`，标题含技能名与版本/日期
- 历史废弃文档：归 `docs/archive/`，不在本目录留存
