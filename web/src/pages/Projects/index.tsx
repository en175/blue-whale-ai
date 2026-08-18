/* ============================================
 * Projects 项目管理页：项目卡片列表与增删改
 * ============================================ */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pencil, Trash2, Plus, Check, X } from 'lucide-react';
import ConfirmModal from '@/components/ConfirmModal';
import { fetchProjects, createProject, renameProject, deleteProject, type ProjectRecord } from '@/api/projects';
import { isApiError } from '@/api/http';
import styles from './index.module.css';

/** 格式化当前时间为可读字符串 */
function formatTime(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${min}:${s}`;
}

export default function Projects() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<ProjectRecord['id'] | null>(null);
  const [editingName, setEditingName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ProjectRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [editError, setEditError] = useState('');
  const [deleting, setDeleting] = useState(false);

  // 页面加载拉取项目列表（按创建时间倒序）
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError('');
    fetchProjects()
      .then((list) => {
        if (alive) setProjects(list);
      })
      .catch((e) => {
        if (alive) setLoadError(isApiError(e) ? e.message : '项目列表加载失败');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  /** 新建项目：POST /api/projects，成功后跳转画布页 */
  const handleCreate = async () => {
    if (creating) return;
    const name = newName.trim() || formatTime(new Date());
    setCreating(true);
    setCreateError('');
    try {
      const created = await createProject(name);
      navigate(`/canvas?project=${created.id}`);
    } catch (e) {
      setCreateError(isApiError(e) ? e.message : '创建失败，请稍后重试');
    } finally {
      setCreating(false);
    }
  };

  /** 开始编辑 */
  const startEdit = (project: ProjectRecord) => {
    setEditingId(project.id);
    setEditingName(project.name);
  };

  /** 保存编辑：PUT /api/projects/:id，成功后用响应更新列表项 */
  const saveEdit = async (id: ProjectRecord['id']) => {
    const name = editingName.trim();
    if (!name) {
      setEditError('项目名不能为空');
      return;
    }
    setEditError('');
    try {
      const updated = await renameProject(id, name);
      setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, ...updated } : p)));
      setEditingId(null);
      setEditingName('');
    } catch (e) {
      setEditError(isApiError(e) ? e.message : '重命名失败，请稍后重试');
    }
  };

  /** 取消编辑 */
  const cancelEdit = () => {
    setEditingId(null);
    setEditingName('');
    setEditError('');
  };

  /** 确认删除：DELETE /api/projects/:id，成功后从列表移除该项 */
  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await deleteProject(deleteTarget.id);
      setProjects((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (e) {
      setCreateError(isApiError(e) ? e.message : '删除失败，请稍后重试');
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        {/* 顶部标题栏 */}
        <div className={styles.header}>
          <h1 className={styles.pageTitle}>项目</h1>
          <div className={styles.headerActions}>
            <input
              className={styles.nameInput}
              type="text"
              placeholder="新项目名称"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
            <button className={styles.createBtn} onClick={handleCreate} disabled={creating}>
              <Plus size={16} strokeWidth={2} />
              <span>{creating ? '创建中…' : '新建项目'}</span>
            </button>
            {createError && <span className={styles.createError}>{createError}</span>}
          </div>
        </div>

        {/* 项目列表 */}
        <div className={styles.list}>
          {loading && <div className={styles.empty}>加载中…</div>}
          {!loading && loadError && <div className={styles.empty}>{loadError}</div>}
          {!loading && !loadError && projects.length === 0 && (
            <div className={styles.empty}>暂无项目，点击“新建项目”开始创建</div>
          )}

          {projects.map((project) => (
            <div key={project.id} className={styles.row}>
              {editingId === project.id ? (
                /* ---- 编辑模式 ---- */
                <div className={styles.editContainer}>
                  <input
                    className={styles.editInput}
                    type="text"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveEdit(project.id);
                      if (e.key === 'Escape') cancelEdit();
                    }}
                    autoFocus
                  />
                  <button
                    className={styles.editSaveBtn}
                    onClick={() => saveEdit(project.id)}
                    title="保存"
                  >
                    <Check size={18} strokeWidth={2} />
                    <span>保存</span>
                  </button>
                  <button
                    className={styles.editCancelBtn}
                    onClick={cancelEdit}
                    title="取消"
                  >
                    <X size={18} strokeWidth={2} />
                    <span>取消</span>
                  </button>
                  {editError && <span className={styles.createError}>{editError}</span>}
                </div>
              ) : (
                /* ---- 展示模式 ---- */
                <>
                  {/* 左侧：缩略图 + 项目名称，点击跳转画布页 */}
                  <div
                    className={styles.rowLeft}
                    onClick={() => navigate(`/canvas?project=${project.id}`)}
                    title={project.name}
                  >
                    {project.thumb && (
                      <img className={styles.thumb} src={project.thumb} alt={project.name} />
                    )}
                    <span className={styles.projectName}>{project.name}</span>
                  </div>

                  {/* 右侧：创建日期 + 操作区 */}
                  <div className={styles.rowRight}>
                    <span className={styles.date}>
                      {new Date(project.created_at).toLocaleDateString('zh-CN')}
                    </span>
                    <button
                      className={styles.iconBtn}
                      title="编辑"
                      onClick={() => startEdit(project)}
                    >
                      <Pencil size={16} strokeWidth={2} />
                    </button>
                    <button
                      className={`${styles.iconBtn} ${styles.deleteBtn}`}
                      title="删除"
                      onClick={() => setDeleteTarget(project)}
                    >
                      <Trash2 size={16} strokeWidth={2} />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 删除确认弹窗 */}
      <ConfirmModal
        open={!!deleteTarget}
        title="删除项目"
        message={
          deleteTarget
            ? `确定要删除项目「${deleteTarget.name}」吗？此操作不可撤销。`
            : ''
        }
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
