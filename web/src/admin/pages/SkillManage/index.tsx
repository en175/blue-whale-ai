import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pencil, Trash2 } from 'lucide-react';
import {
  adminSkillCategoriesOptions,
  adminSkillDetailOptions,
  adminSkillsOptions,
  assignAdminSkillsCategory,
  renameAdminSkillCategory,
  deleteAdminSkillCategory,
  setAdminSkillActive,
  updateAdminSkill,
  type AdminSkill,
  type AdminSkillDetail,
} from '@/admin/api/adminSkills';
import { remoteImageCrossOrigin, resolveMediaSrc } from '@/shared/utils/remoteImageCors';
import { isApiError } from '@/shared/api/http';
import ConfirmModal from '../../components/ConfirmModal';
import {
  Alert,
  Badge,
  Button,
  Card,
  Chip,
  Empty,
  Input,
  Modal,
  Page,
  PageHeader,
  Select,
  Table,
  Toolbar,
} from '../../ui';

const NEW_CAT = '__new__';
const FILTER_NONE = '__none__';

export default function SkillManage() {
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newNames, setNewNames] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<string>('all');
  const [bulkCat, setBulkCat] = useState<string>('');
  const [bulkNew, setBulkNew] = useState('');
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<AdminSkill | null>(null);
  const [onlyMissingContent, setOnlyMissingContent] = useState(false);

  const skillsQuery = useQuery(adminSkillsOptions());
  const catsQuery = useQuery(adminSkillCategoriesOptions());
  const skills: AdminSkill[] = useMemo(() => skillsQuery.data ?? [], [skillsQuery.data]);
  const cats = catsQuery.data ?? [];
  const loading = skillsQuery.isPending || catsQuery.isPending;
  const firstError = skillsQuery.error ?? catsQuery.error;
  const loadError =
    skillsQuery.isError || catsQuery.isError
      ? isApiError(firstError)
        ? firstError.message
        : '加载技能列表失败'
      : '';

  const load = useCallback(() => {
    void skillsQuery.refetch();
    void catsQuery.refetch();
  }, [skillsQuery, catsQuery]);

  const effectiveTarget = useCallback(
    (s: AdminSkill): string => {
      const d = drafts[s.id];
      if (d === undefined) return s.category;
      return d === NEW_CAT ? (newNames[s.id] ?? '').trim() : d;
    },
    [drafts, newNames],
  );

  const pending = useMemo(
    () =>
      skills
        .map((s) => ({ s, target: effectiveTarget(s) }))
        .filter((x) => x.target !== x.s.category && x.target.length >= 1 && x.target.length <= 32),
    [skills, effectiveTarget],
  );

  const filtered = useMemo(() => {
    const base =
      filter === 'all'
        ? skills
        : filter === FILTER_NONE
          ? skills.filter((s) => s.category === '')
          : skills.filter((s) => s.category === filter);
    return onlyMissingContent ? base.filter((s) => !s.has_content) : base;
  }, [onlyMissingContent, skills, filter]);

  const missingContentCount = useMemo(
    () => skills.filter((s) => !s.has_content).length,
    [skills],
  );

  const hasUncat = skills.some((s) => s.category === '');
  const allFilteredSelected = filtered.length > 0 && filtered.every((s) => selected.has(s.id));

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) filtered.forEach((s) => next.delete(s.id));
      else filtered.forEach((s) => next.add(s.id));
      return next;
    });
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const applyBulk = () => {
    if (!bulkCat || selected.size === 0) return;
    if (bulkCat === NEW_CAT && !bulkNew.trim()) {
      setActionError('请输入新分类名');
      return;
    }
    setDrafts((prev) => {
      const next = { ...prev };
      selected.forEach((id) => {
        next[id] = bulkCat;
      });
      return next;
    });
    if (bulkCat === NEW_CAT) {
      setNewNames((prev) => {
        const next = { ...prev };
        selected.forEach((id) => {
          next[id] = bulkNew.trim();
        });
        return next;
      });
    }
    setActionError('');
  };

  const saveAll = async () => {
    if (pending.length === 0 || busy) return;
    setBusy(true);
    setActionError('');
    try {
      const groups = new Map<string, string[]>();
      for (const { s, target } of pending) {
        const list = groups.get(target) ?? [];
        list.push(s.id);
        groups.set(target, list);
      }
      for (const [target, ids] of groups) {
        await assignAdminSkillsCategory(ids, target);
      }
      setDrafts({});
      setNewNames({});
      setSelected(new Set());
      load();
    } catch (e) {
      setActionError(isApiError(e) ? e.message : '保存失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setActionError('');
    try {
      await fn();
      load();
    } catch (e) {
      setActionError(isApiError(e) ? e.message : '操作失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  const catOptions = [
    { value: '', label: '选择目标分类…' },
    ...cats.map((c) => ({ value: c.name, label: c.name })),
    { value: NEW_CAT, label: '新分类…' },
  ];

  return (
    <Page>
      <PageHeader
        title="技能管理"
        subtitle="官方技能归类与分类维护（用户侧分类展示已隐藏）"
        extra={
          <Button
            variant="primary"
            disabled={busy || pending.length === 0}
            onClick={saveAll}
          >
            {busy ? '保存中…' : `一键保存（${pending.length}）`}
          </Button>
        }
      />

      {actionError && <Card>{actionError}</Card>}

      <Card padded={false}>
        {}
        <div style={{ padding: 'var(--admin-space-3)' }}>
          <Toolbar>
            <Chip active={filter === 'all'} onClick={() => setFilter('all')}>
              全部
            </Chip>
            {hasUncat && (
              <Chip active={filter === FILTER_NONE} onClick={() => setFilter(FILTER_NONE)}>
                未分类
              </Chip>
            )}
            {missingContentCount > 0 && (
              <Chip
                active={onlyMissingContent}
                onClick={() => setOnlyMissingContent((v) => !v)}
              >
                缺正文
                <Badge tone="warning">{missingContentCount}</Badge>
              </Chip>
            )}
            {cats.map((c) => (
              <span key={c.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                <Chip active={filter === c.name} onClick={() => setFilter(c.name)}>
                  {c.name}
                  <Badge tone="neutral">{c.count}</Badge>
                </Chip>
                <Button
                  size="sm"
                  variant="ghost"
                  title="重命名分类"
                  aria-label={`重命名分类 ${c.name}`}
                  icon={<Pencil size={12} strokeWidth={2} />}
                  onClick={() => setRenameTarget(c.name)}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  title="删除分类（其下技能变未分类）"
                  aria-label={`删除分类 ${c.name}`}
                  icon={<Trash2 size={12} strokeWidth={2} />}
                  onClick={() => setDeleteTarget(c.name)}
                />
              </span>
            ))}
          </Toolbar>
        </div>

        {}
        <div style={{ padding: '0 12px 12px' }}>
          <Toolbar>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={allFilteredSelected} onChange={toggleAll} />
              <span>已选 {selected.size} 项</span>
            </label>
            <Select
              options={catOptions}
              value={bulkCat}
              onChange={setBulkCat}
            />
            {bulkCat === NEW_CAT && (
              <Input
                maxLength={32}
                placeholder="新分类名（≤32字）"
                value={bulkNew}
                onChange={(e) => setBulkNew(e.target.value)}
              />
            )}
            <Button disabled={selected.size === 0 || !bulkCat} onClick={applyBulk}>
              应用到选中（暂存）
            </Button>
            <small>改动先暂存高亮，点右上「一键保存」统一提交</small>
          </Toolbar>
        </div>

        {}
        <Table>
          <thead>
            <tr>
              <th style={{ width: 40 }} />
              <th>封面</th>
              <th>名称</th>
              <th>分类</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6}>
                  <Empty message="加载中…" />
                </td>
              </tr>
            )}
            {!loading && loadError && (
              <tr>
                <td colSpan={6}>
                  <Empty
                    message={loadError}
                    extra={<Button onClick={load}>重试</Button>}
                  />
                </td>
              </tr>
            )}
            {!loading && !loadError && filtered.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <Empty message="暂无技能" />
                </td>
              </tr>
            )}
            {filtered.map((s) => {
              const sel = drafts[s.id] ?? s.category;
              const dirty = effectiveTarget(s) !== s.category;
              const rowOptions = [
                ...(s.category === '' ? [{ value: '', label: '未分类' }] : []),
                ...(!cats.some((c) => c.name === s.category) && s.category !== ''
                  ? [{ value: s.category, label: s.category }]
                  : []),
                ...cats.map((c) => ({ value: c.name, label: c.name })),
                { value: NEW_CAT, label: '新分类…' },
              ];
              return (
                <tr key={s.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(s.id)}
                      onChange={() => toggleOne(s.id)}
                    />
                  </td>
                  <td>
                    {s.cover_url ? (
                      <img
                        src={resolveMediaSrc(s.cover_url)}
                        crossOrigin={remoteImageCrossOrigin(s.cover_url)}
                        alt=""
                        style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 'var(--admin-radius-control)' }}
                      />
                    ) : (
                      <span>—</span>
                    )}
                  </td>
                  <td>{s.name}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Select
                        options={rowOptions}
                        value={sel}
                        onChange={(v) => setDrafts((p) => ({ ...p, [s.id]: v }))}
                      />
                      {sel === NEW_CAT && (
                        <Input
                          maxLength={32}
                          placeholder="新分类名（≤32字）"
                          value={newNames[s.id] ?? ''}
                          onChange={(e) => setNewNames((p) => ({ ...p, [s.id]: e.target.value }))}
                        />
                      )}
                      {dirty && (
                        <Badge tone="warning" dot>
                          未保存
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Badge tone={s.is_delete === 0 ? 'neutral' : 'warning'}>
                        {s.is_delete === 0 ? '在架' : '下架'}
                      </Badge>
                      {!s.has_content && <Badge tone="warning" dot>缺正文</Badge>}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Pencil size={12} strokeWidth={2} />}
                        onClick={() => setEditTarget(s)}
                      >
                        编辑
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          run(() => setAdminSkillActive(s.id, s.is_delete === 0 ? 1 : 0))
                        }
                      >
                        {s.is_delete === 0 ? '下架' : '上架'}
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      {editTarget && (
        <EditSkillModal
          skill={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            load();
          }}
        />
      )}

      <RenameModal
        from={renameTarget}
        onClose={() => setRenameTarget(null)}
        onSave={(to) =>
          run(() => renameAdminSkillCategory(renameTarget as string, to)).then(() =>
            setRenameTarget(null),
          )
        }
      />

      {deleteTarget !== null && (
        <ConfirmModal
          title="删除分类"
          content={`确定删除分类「${deleteTarget}」？其下技能将变为未分类。`}
          confirmText={busy ? '删除中…' : '确认删除'}
          onConfirm={() =>
            run(() => deleteAdminSkillCategory(deleteTarget)).then(() => setDeleteTarget(null))
          }
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </Page>
  );
}

function EditSkillModal({
  skill,
  onClose,
  onSaved,
}: {
  skill: AdminSkill;
  onClose: () => void;
  onSaved: () => void;
}) {
  const detailQuery = useQuery(adminSkillDetailOptions(skill.id));
  const [form, setForm] = useState({
    name: '',
    description: '',
    content: '',
    category: '',
    sort_order: '0',
    cover_url: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const detail: AdminSkillDetail | undefined = detailQuery.data;
    if (!detail) return;
    setForm({
      name: detail.name,
      description: detail.description ?? '',
      content: detail.content ?? '',
      category: detail.category,
      sort_order: String(detail.sort_order),
      cover_url: detail.cover_url ?? '',
    });
    setError('');
  }, [detailQuery.data]);

  const save = async () => {
    if (saving) return;
    const name = form.name.trim();
    if (!name || name.length > 255) {
      setError('名称须为 1–255 字符');
      return;
    }
    const sortOrder = Number(form.sort_order);
    if (!Number.isInteger(sortOrder)) {
      setError('排序须为整数');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await updateAdminSkill(skill.id, {
        name,
        description: form.description.trim() || null,
        content: form.content || null,
        category: form.category.trim(),
        sort_order: sortOrder,
        cover_url: form.cover_url.trim() || null,
      });
      onSaved();
    } catch (e) {
      setError(isApiError(e) ? e.message : '保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title={`编辑技能（${skill.name}）`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={saving || detailQuery.isPending} onClick={save}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </>
      }
    >
      {detailQuery.isError && (
        <Alert tone="danger">
          {isApiError(detailQuery.error) ? detailQuery.error.message : '加载技能失败'}
        </Alert>
      )}
      {detailQuery.isPending && <Empty message="加载中…" />}
      {!detailQuery.isPending && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--admin-space-3)' }}>
          <label>
            <div>名称</div>
            <Input
              maxLength={255}
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              style={{ width: '100%' }}
            />
          </label>
          <label>
            <div>简介</div>
            <textarea
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              rows={3}
              style={{ width: '100%', fontFamily: 'inherit', padding: '8px 10px', borderRadius: 'var(--admin-radius-control)', border: '1px solid var(--admin-border)' }}
            />
          </label>
          <label>
            <div>正文（Markdown）</div>
            <textarea
              value={form.content}
              onChange={(e) => setForm((p) => ({ ...p, content: e.target.value }))}
              rows={14}
              style={{ width: '100%', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12.5, lineHeight: 1.6, padding: '8px 10px', borderRadius: 'var(--admin-radius-control)', border: '1px solid var(--admin-border)' }}
            />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 'var(--admin-space-3)' }}>
            <label>
              <div>分类</div>
              <Input
                maxLength={32}
                value={form.category}
                onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
                style={{ width: '100%' }}
              />
            </label>
            <label>
              <div>排序</div>
              <Input
                value={form.sort_order}
                onChange={(e) => setForm((p) => ({ ...p, sort_order: e.target.value }))}
                style={{ width: '100%' }}
              />
            </label>
          </div>
          <label>
            <div>封面地址</div>
            <Input
              value={form.cover_url}
              onChange={(e) => setForm((p) => ({ ...p, cover_url: e.target.value }))}
              style={{ width: '100%' }}
            />
          </label>
          {error && <Alert tone="danger">{error}</Alert>}
        </div>
      )}
    </Modal>
  );
}

function RenameModal({
  from,
  onClose,
  onSave,
}: {
  from: string | null;
  onClose: () => void;
  onSave: (to: string) => Promise<void>;
}) {
  const [to, setTo] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setTo(from ?? '');
    setError('');
  }, [from]);

  if (from === null) return null;

  const save = async () => {
    const value = to.trim();
    if (saving || !value || value.length > 32) {
      setError('分类名须为 1–32 字符');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave(value);
    } catch (e) {
      setError(isApiError(e) ? e.message : '改名失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title={`重命名分类（${from}）`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={saving} onClick={save}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </>
      }
    >
      <Input
        maxLength={32}
        value={to}
        onChange={(e) => setTo(e.target.value)}
        style={{ width: '100%' }}
      />
      {error && (
        <Alert tone="danger">{error}</Alert>
      )}
    </Modal>
  );
}
