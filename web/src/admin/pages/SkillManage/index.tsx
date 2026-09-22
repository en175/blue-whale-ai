/* ============================================
 * SkillManage 技能管理：官方技能归类与分类维护（IKA64P）
 * 效率优化：行内改动暂存高亮 + 顶部一键保存；多选批量归类；分类 chip 过滤表格
 * ============================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import {
  fetchAdminSkills,
  fetchAdminSkillCategories,
  assignAdminSkillsCategory,
  renameAdminSkillCategory,
  deleteAdminSkillCategory,
  type AdminSkill,
  type AdminSkillCategory,
} from '@/api/admin';
import { remoteImageCrossOrigin, resolveMediaSrc } from '@/utils/remoteImageCors';
import { isApiError } from '@/api/http';
import ConfirmModal from '../../components/ConfirmModal';
import styles from './index.module.css';

/** 下拉选项：新分类（随归类创建） */
const NEW_CAT = '__new__';
/** 过滤项：未分类 */
const FILTER_NONE = '__none__';

export default function SkillManage() {
  const [skills, setSkills] = useState<AdminSkill[]>([]);
  const [cats, setCats] = useState<AdminSkillCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  /** 暂存改动：技能 id → 目标分类（NEW_CAT 表示新分类，名字见 newNames） */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newNames, setNewNames] = useState<Record<string, string>>({});
  /** 勾选集合 */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** 表格过滤：all / 分类名 / 未分类 */
  const [filter, setFilter] = useState<string>('all');
  /** 批量栏 */
  const [bulkCat, setBulkCat] = useState<string>('');
  const [bulkNew, setBulkNew] = useState('');
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError('');
    Promise.all([fetchAdminSkills(), fetchAdminSkillCategories()])
      .then(([s, c]) => {
        setSkills(s);
        setCats(c);
      })
      .catch((e) => setLoadError(isApiError(e) ? e.message : '加载技能列表失败'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  /** 行的生效目标分类（暂存优先） */
  const effectiveTarget = useCallback(
    (s: AdminSkill): string => {
      const d = drafts[s.id];
      if (d === undefined) return s.category;
      return d === NEW_CAT ? (newNames[s.id] ?? '').trim() : d;
    },
    [drafts, newNames],
  );

  /** 待保存列表（目标有效且与现状不同） */
  const pending = useMemo(
    () =>
      skills
        .map((s) => ({ s, target: effectiveTarget(s) }))
        .filter((x) => x.target !== x.s.category && x.target.length >= 1 && x.target.length <= 32),
    [skills, effectiveTarget],
  );

  /** 表格过滤 */
  const filtered = useMemo(() => {
    if (filter === 'all') return skills;
    if (filter === FILTER_NONE) return skills.filter((s) => s.category === '');
    return skills.filter((s) => s.category === filter);
  }, [skills, filter]);

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

  /** 批量栏「应用到选中」：写入暂存（不请求），由一键保存统一提交 */
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

  /** 一键保存：按目标分组批量提交 */
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

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>技能管理</h1>
          <p className={styles.subtitle}>官方技能归类与分类维护（用户侧分类展示已隐藏）</p>
        </div>
        <button className={styles.saveBtn} disabled={busy || pending.length === 0} onClick={saveAll}>
          {busy ? '保存中…' : `一键保存（${pending.length}）`}
        </button>
      </div>

      {actionError && <div className={styles.actionError}>{actionError}</div>}

      {/* 分类条（点击过滤表格） */}
      <div className={styles.catRow}>
        <button
          className={`${styles.catChip} ${filter === 'all' ? styles.catChipActive : ''}`}
          onClick={() => setFilter('all')}
        >
          全部
        </button>
        {hasUncat && (
          <button
            className={`${styles.catChip} ${filter === FILTER_NONE ? styles.catChipActive : ''}`}
            onClick={() => setFilter(FILTER_NONE)}
          >
            未分类
          </button>
        )}
        {cats.map((c) => (
          <span
            className={`${styles.catChip} ${filter === c.name ? styles.catChipActive : ''}`}
            key={c.name}
            onClick={() => setFilter(c.name)}
          >
            <span>{c.name}</span>
            <span className={styles.catCount}>{c.count}</span>
            <button
              className={styles.catEdit}
              title="重命名分类"
              onClick={(e) => {
                e.stopPropagation();
                setRenameTarget(c.name);
              }}
            >
              <Pencil size={12} strokeWidth={2} />
            </button>
            <button
              className={styles.catEdit}
              title="删除分类（其下技能变未分类）"
              onClick={(e) => {
                e.stopPropagation();
                setDeleteTarget(c.name);
              }}
            >
              <Trash2 size={12} strokeWidth={2} />
            </button>
          </span>
        ))}
      </div>

      {/* 批量栏 */}
      <div className={styles.bulkBar}>
        <label className={styles.bulkLabel}>
          <input type="checkbox" checked={allFilteredSelected} onChange={toggleAll} />
          <span>已选 {selected.size} 项</span>
        </label>
        <select className={styles.select} value={bulkCat} onChange={(e) => setBulkCat(e.target.value)}>
          <option value="">选择目标分类…</option>
          {cats.map((c) => (
            <option key={c.name} value={c.name}>{c.name}</option>
          ))}
          <option value={NEW_CAT}>新分类…</option>
        </select>
        {bulkCat === NEW_CAT && (
          <input
            className={styles.input}
            maxLength={32}
            placeholder="新分类名（≤32字）"
            value={bulkNew}
            onChange={(e) => setBulkNew(e.target.value)}
          />
        )}
        <button
          className={styles.ghostBtn}
          disabled={selected.size === 0 || !bulkCat}
          onClick={applyBulk}
        >
          应用到选中（暂存）
        </button>
        <span className={styles.bulkHint}>改动先暂存高亮，点右上「一键保存」统一提交</span>
      </div>

      {/* 技能表 */}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.thCheck}></th>
              <th>封面</th>
              <th>名称</th>
              <th>分类</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={4} className={styles.tableState}>加载中…</td>
              </tr>
            )}
            {!loading && loadError && (
              <tr>
                <td colSpan={4} className={styles.tableState}>{loadError}</td>
              </tr>
            )}
            {!loading && !loadError && filtered.length === 0 && (
              <tr>
                <td colSpan={4} className={styles.tableState}>暂无技能</td>
              </tr>
            )}
            {filtered.map((s) => {
              const sel = drafts[s.id] ?? s.category;
              const dirty = effectiveTarget(s) !== s.category;
              return (
                <tr key={s.id} className={dirty ? styles.rowDirty : ''}>
                  <td className={styles.thCheck}>
                    <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleOne(s.id)} />
                  </td>
                  <td>
                    {s.cover_url ? (
                      <img className={styles.cover} src={resolveMediaSrc(s.cover_url)} crossOrigin={remoteImageCrossOrigin(s.cover_url)} alt="" />
                    ) : (
                      <span className={styles.coverNone}>—</span>
                    )}
                  </td>
                  <td>{s.name}</td>
                  <td>
                    <div className={styles.catCell}>
                      <select
                        className={styles.select}
                        value={sel}
                        onChange={(e) => setDrafts((p) => ({ ...p, [s.id]: e.target.value }))}
                      >
                        {s.category === '' && <option value="">未分类</option>}
                        {!cats.some((c) => c.name === s.category) && s.category !== '' && (
                          <option value={s.category}>{s.category}</option>
                        )}
                        {cats.map((c) => (
                          <option key={c.name} value={c.name}>{c.name}</option>
                        ))}
                        <option value={NEW_CAT}>新分类…</option>
                      </select>
                      {sel === NEW_CAT && (
                        <input
                          className={styles.input}
                          maxLength={32}
                          placeholder="新分类名（≤32字）"
                          value={newNames[s.id] ?? ''}
                          onChange={(e) => setNewNames((p) => ({ ...p, [s.id]: e.target.value }))}
                        />
                      )}
                      {dirty && <span className={styles.dirtyDot} title="未保存" />}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 改名弹窗 */}
      {renameTarget !== null && (
        <RenameModal
          from={renameTarget}
          onClose={() => setRenameTarget(null)}
          onSave={(to) =>
            run(() => renameAdminSkillCategory(renameTarget, to)).then(() => setRenameTarget(null))
          }
        />
      )}

      {/* 删除二次确认 */}
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
    </div>
  );
}

/* ============ 分类改名弹窗 ============ */
function RenameModal({
  from,
  onClose,
  onSave,
}: {
  from: string;
  onClose: () => void;
  onSave: (to: string) => Promise<void>;
}) {
  const [to, setTo] = useState(from);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

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
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.smallModal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHead}>
          <h2 className={styles.modalTitle}>重命名分类（{from}）</h2>
          <button className={styles.closeBtn} onClick={onClose} title="关闭">
            ×
          </button>
        </div>
        <div className={styles.modalBody}>
          <input
            className={styles.input}
            maxLength={32}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
          {error && <div className={styles.formError}>{error}</div>}
        </div>
        <div className={styles.modalFoot}>
          <button className={styles.cancelBtn} onClick={onClose}>取消</button>
          <button className={styles.saveBtn} disabled={saving} onClick={save}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
