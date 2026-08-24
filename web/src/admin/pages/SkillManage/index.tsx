/* ============================================
 * SkillManage 技能管理：官方技能归类与分类维护（IKA64P）
 * ============================================ */
import { useCallback, useEffect, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import {
  fetchAdminSkills,
  fetchAdminSkillCategories,
  setAdminSkillCategory,
  renameAdminSkillCategory,
  deleteAdminSkillCategory,
  type AdminSkill,
  type AdminSkillCategory,
} from '@/api/admin';
import { isApiError } from '@/api/http';
import ConfirmModal from '../../components/ConfirmModal';
import styles from './index.module.css';

/** 下拉选项：新分类（随归类创建） */
const NEW_CAT = '__new__';

export default function SkillManage() {
  const [skills, setSkills] = useState<AdminSkill[]>([]);
  const [cats, setCats] = useState<AdminSkillCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  /** 技能 id → 下拉当前值 */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  /** 技能 id → 新分类输入值 */
  const [newNames, setNewNames] = useState<Record<string, string>>({});
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

  /** 保存技能分类（选「新分类…」时用输入值，随归类创建） */
  const saveCategory = (s: AdminSkill) => {
    const sel = drafts[s.id] ?? s.category;
    const value = sel === NEW_CAT ? (newNames[s.id] ?? '').trim() : sel;
    if (!value || value.length > 32) {
      setActionError('分类名须为 1–32 字符');
      return;
    }
    run(() => setAdminSkillCategory(s.id, value));
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>技能管理</h1>
          <p className={styles.subtitle}>官方技能归类与分类维护（用户侧分类展示已隐藏）</p>
        </div>
      </div>

      {actionError && <div className={styles.actionError}>{actionError}</div>}

      {/* 分类条 */}
      <div className={styles.catRow}>
        {cats.map((c) => (
          <span className={styles.catChip} key={c.name}>
            <span>{c.name}</span>
            <span className={styles.catCount}>{c.count}</span>
            <button className={styles.catEdit} title="重命名分类" onClick={() => setRenameTarget(c.name)}>
              <Pencil size={12} strokeWidth={2} />
            </button>
            <button
              className={styles.catEdit}
              title="删除分类（其下技能变未分类）"
              onClick={() => setDeleteTarget(c.name)}
            >
              <Trash2 size={12} strokeWidth={2} />
            </button>
          </span>
        ))}
        {cats.length === 0 && (
          <span className={styles.catEmpty}>暂无分类（在技能行选择「新分类…」创建）</span>
        )}
      </div>

      {/* 技能表 */}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>封面</th>
              <th>名称</th>
              <th>分类</th>
              <th className={styles.thRight}>操作</th>
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
            {!loading && !loadError && skills.length === 0 && (
              <tr>
                <td colSpan={4} className={styles.tableState}>暂无官方技能</td>
              </tr>
            )}
            {skills.map((s) => {
              const sel = drafts[s.id] ?? s.category;
              return (
                <tr key={s.id}>
                  <td>
                    {s.cover_url ? (
                      <img className={styles.cover} src={s.cover_url} alt="" />
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
                    </div>
                  </td>
                  <td>
                    <button className={styles.saveBtn} disabled={busy} onClick={() => saveCategory(s)}>
                      保存
                    </button>
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
