/* ============================================
 * Projects 项目管理页：图文项目卡片、分页加载与项目管理
 * ============================================ */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { type InfiniteData, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Check, ImageOff, MoreHorizontal, Pencil, Pin, PinOff, Plus, Trash2 } from 'lucide-react';
import Modal from '@/components/Modal';
import Skeleton from '@/components/Skeleton';
import {
  batchDeleteProjects,
  createProject,
  deleteProject,
  pinProject,
  projectKeys,
  projectPageQueryOptions,
  renameProject,
  type ProjectPageData,
  type ProjectRecord,
} from '@/api/projects';
import { isApiError } from '@/api/http';
import { defaultProjectName } from '@/lib/projectName';
import styles from './index.module.css';

/** 页面向用户展示的日期；坏数据不让整张卡片失去可用性。 */
function formatProjectDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '创建日期未知';
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function errorMessage(error: unknown, fallback: string): string {
  return isApiError(error) ? error.message : fallback;
}

/** 无限分页在数据变动后可暂时有跨页重复，展示层按 ID 收敛。 */
function uniqueProjects(records: ProjectRecord[]): ProjectRecord[] {
  const known = new Set<string>();
  return records.filter((project) => {
    const id = String(project.id);
    if (known.has(id)) return false;
    known.add(id);
    return true;
  });
}

/** 修改已加载的页缓存；重命名时有意只采纳名称，保留卡片已有 previews。 */
function updateCachedProjectPages(
  queryClient: ReturnType<typeof useQueryClient>,
  update: (project: ProjectRecord) => ProjectRecord | null,
) {
  queryClient.setQueriesData<InfiniteData<ProjectPageData>>(
    { queryKey: projectKeys.all },
    (old) => old
      ? {
        ...old,
        pages: old.pages.map((page) => ({
          ...page,
          records: page.records.flatMap((project) => {
            const next = update(project);
            return next ? [next] : [];
          }),
        })),
      }
      : old,
  );
}

function PreviewGallery({ project }: { project: ProjectRecord }) {
  const previews = project.previews?.slice(0, 3) ?? [];

  if (previews.length === 0) {
    return (
      <div className={styles.previewEmpty} aria-label="暂无图片预览">
        <ImageOff size={28} strokeWidth={1.5} aria-hidden="true" />
        <span>暂无图片预览</span>
      </div>
    );
  }

  return (
    <div
      className={styles.previewGallery}
      data-preview-count={previews.length}
      aria-label={`${project.name} 的图片预览`}
    >
      {previews.map((url, index) => (
        <img
          key={`${url}-${index}`}
          className={styles.previewImage}
          src={url}
          alt={`${project.name} 图片预览 ${index + 1}`}
          loading="lazy"
        />
      ))}
    </div>
  );
}

function ProjectCardSkeleton() {
  return (
    <div className={styles.projectSkeletonCard} data-project-card-skeleton aria-hidden="true">
      <div className={styles.projectSkeletonPreview}>
        <Skeleton className={styles.projectSkeletonMedia} data-project-card-skeleton-media />
      </div>
      <div className={styles.projectSkeletonMeta}>
        <Skeleton active={false} className={styles.projectSkeletonTitle} />
        <Skeleton active={false} className={styles.projectSkeletonDate} />
      </div>
    </div>
  );
}

export default function Projects() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pageRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const [newName, setNewName] = useState('');
  const [createError, setCreateError] = useState('');
  const [pinError, setPinError] = useState('');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<ProjectRecord | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editError, setEditError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ProjectRecord | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false);
  const [batchConfirmation, setBatchConfirmation] = useState('');
  const [batchError, setBatchError] = useState('');

  const {
    data: projectData,
    error: projectQueryError,
    fetchNextPage,
    hasNextPage,
    isError: isProjectQueryError,
    isFetchNextPageError,
    isFetchingNextPage,
    isPending: isProjectQueryPending,
    refetch,
  } = useInfiniteQuery(projectPageQueryOptions());

  const projectPages = projectData?.pages;
  const projects = useMemo(
    () => uniqueProjects(projectPages?.flatMap((page) => page.records) ?? []),
    [projectPages],
  );
  const projectTotal = projectPages?.at(-1)?.total ?? projects.length;
  const isInitialLoading = isProjectQueryPending && !projectPages;
  const hasInitialError = isProjectQueryError && !projectPages;

  const createMutation = useMutation({
    mutationFn: (name: string) => createProject(name, { silent: true }),
  });
  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: ProjectRecord['id']; name: string }) =>
      renameProject(id, name, { silent: true }),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: ProjectRecord['id']) => deleteProject(id, { silent: true }),
  });
  const pinMutation = useMutation({
    mutationFn: ({ id, pinned }: { id: ProjectRecord['id']; pinned: boolean }) =>
      pinProject(id, pinned, { silent: true }),
  });
  const batchDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => batchDeleteProjects(ids, { silent: true }),
  });

  const loadNextPage = useCallback(async () => {
    if (!hasNextPage || isFetchingNextPage || isFetchNextPageError) return;
    await fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchNextPageError, isFetchingNextPage]);

  /** 项目页是实际滚动容器，哨兵不能默认观察 window。 */
  useEffect(() => {
    const target = loadMoreRef.current;
    const root = pageRef.current;
    if (!target || !root || !hasNextPage || isFetchingNextPage || isFetchNextPageError) {
      return undefined;
    }
    if (typeof IntersectionObserver === 'undefined') return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadNextPage();
      },
      { root, rootMargin: '160px 0px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchNextPageError, isFetchingNextPage, loadNextPage]);

  const leaveSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const toggleProjectSelection = (id: ProjectRecord['id']) => {
    const key = String(id);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectedCount = selectedIds.size;
  const allLoadedSelected = projects.length > 0 && projects.every((project) => selectedIds.has(String(project.id)));

  const toggleAllLoadedProjects = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allLoadedSelected) projects.forEach((project) => next.delete(String(project.id)));
      else projects.forEach((project) => next.add(String(project.id)));
      return next;
    });
  };

  const openProject = (project: ProjectRecord) => {
    if (selectionMode) {
      toggleProjectSelection(project.id);
      return;
    }
    navigate(`/canvas?project=${encodeURIComponent(String(project.id))}`);
  };

  const onCardKeyDown = (event: KeyboardEvent<HTMLElement>, project: ProjectRecord) => {
    // 菜单和多选按钮同样位于卡片内；它们的 Enter/Space 不能冒泡成“打开项目”。
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openProject(project);
  };

  /** 创建成功即进入画布；空名由服务端生成默认时间名称。 */
  const handleCreate = () => {
    if (createMutation.isPending) return;
    setCreateError('');
    createMutation.mutate(newName.trim() || defaultProjectName(), {
      onSuccess: (created) => navigate(`/canvas?project=${encodeURIComponent(String(created.id))}`),
      onError: (error) => setCreateError(errorMessage(error, '创建失败，请稍后重试')),
    });
  };

  const openEdit = (project: ProjectRecord) => {
    setOpenMenuId(null);
    setEditTarget(project);
    setEditingName(project.name);
    setEditError('');
  };

  const closeEdit = () => {
    if (renameMutation.isPending) return;
    setEditTarget(null);
    setEditingName('');
    setEditError('');
  };

  const saveEdit = () => {
    const name = editingName.trim();
    if (!editTarget || renameMutation.isPending) return;
    if (!name) {
      setEditError('项目名不能为空');
      return;
    }

    setEditError('');
    renameMutation.mutate(
      { id: editTarget.id, name },
      {
        onSuccess: (updated) => {
          updateCachedProjectPages(queryClient, (project) =>
            String(project.id) === String(updated.id)
              ? { ...project, name: updated.name }
              : project,
          );
          closeEdit();
        },
        onError: (error) => setEditError(errorMessage(error, '重命名失败，请稍后重试')),
      },
    );
  };

  const openSingleDelete = (project: ProjectRecord) => {
    setOpenMenuId(null);
    setDeleteTarget(project);
    setDeleteConfirmation('');
    setDeleteError('');
  };

  /** 置顶/取消置顶（IKH1YL）：口径改变列表顺序，成功后重拉已加载页让服务端排序直出。 */
  const handleTogglePin = (project: ProjectRecord) => {
    setOpenMenuId(null);
    setPinError('');
    pinMutation.mutate(
      { id: project.id, pinned: !project.pinned_at },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: projectKeys.all });
        },
        onError: (error) => setPinError(errorMessage(error, '置顶操作失败，请稍后重试')),
      },
    );
  };

  const closeSingleDelete = () => {
    if (deleteMutation.isPending) return;
    setDeleteTarget(null);
    setDeleteConfirmation('');
    setDeleteError('');
  };

  const confirmSingleDelete = () => {
    if (
      !deleteTarget
      || deleteMutation.isPending
      || deleteConfirmation !== deleteTarget.name
    ) return;

    setDeleteError('');
    deleteMutation.mutate(deleteTarget.id, {
      onSuccess: () => {
        const deletedId = String(deleteTarget.id);
        updateCachedProjectPages(queryClient, (project) =>
          String(project.id) === deletedId ? null : project,
        );
        setSelectedIds((current) => {
          const next = new Set(current);
          next.delete(deletedId);
          return next;
        });
        setDeleteTarget(null);
        setDeleteConfirmation('');
        // offset 分页删除后需要重新拉取已加载页，避免页间出现空洞。
        void queryClient.invalidateQueries({ queryKey: projectKeys.all });
      },
      onError: (error) => setDeleteError(errorMessage(error, '删除失败，请稍后重试')),
    });
  };

  const closeBatchDelete = () => {
    if (batchDeleteMutation.isPending) return;
    setBatchConfirmOpen(false);
    setBatchConfirmation('');
    setBatchError('');
  };

  const confirmBatchDelete = () => {
    const ids = [...selectedIds];
    if (ids.length === 0 || batchDeleteMutation.isPending || batchConfirmation.trim() !== '删除') {
      return;
    }

    setBatchError('');
    batchDeleteMutation.mutate(ids, {
      onSuccess: ({ succeeded, failed }) => {
        const succeededIds = new Set(succeeded.map(String));
        updateCachedProjectPages(queryClient, (project) =>
          succeededIds.has(String(project.id)) ? null : project,
        );
        setSelectedIds((current) => new Set(
          [...current].filter((id) => !succeededIds.has(id)),
        ));
        setBatchConfirmation('');
        void queryClient.invalidateQueries({ queryKey: projectKeys.all });

        if (failed.length > 0) {
          setBatchError(`${failed.length} 个项目未能删除，请刷新后重试。`);
          return;
        }
        setBatchConfirmOpen(false);
        setSelectionMode(false);
      },
      onError: (error) => setBatchError(errorMessage(error, '批量删除失败，请稍后重试')),
    });
  };

  return (
    <div className={styles.page} ref={pageRef} onClick={() => setOpenMenuId(null)}>
      <div className={styles.container}>
        <header className={styles.header}>
          <div className={styles.titleBlock}>
            <h1 className={styles.pageTitle}>项目</h1>
            <p className={styles.pageSubtitle}>从最近创作的图片中，一眼回到你的项目。</p>
          </div>

          <div className={styles.headerActions}>
            {selectionMode ? (
              <div className={styles.selectionActions}>
                <button className={styles.secondaryBtn} type="button" onClick={toggleAllLoadedProjects}>
                  {allLoadedSelected ? '取消全选' : '全选已加载'}
                </button>
                <span className={styles.selectionCount}>已选 {selectedCount} 个</span>
                <button
                  className={styles.deleteSelectionBtn}
                  type="button"
                  disabled={selectedCount === 0}
                  onClick={() => {
                    setBatchError('');
                    setBatchConfirmation('');
                    setBatchConfirmOpen(true);
                  }}
                >
                  <Trash2 size={15} strokeWidth={2} aria-hidden="true" />
                  删除选中
                </button>
                <button className={styles.secondaryBtn} type="button" onClick={leaveSelectionMode}>
                  取消
                </button>
              </div>
            ) : (
              <>
                <button
                  className={styles.secondaryBtn}
                  type="button"
                  onClick={() => setSelectionMode(true)}
                >
                  批量管理
                </button>
                <form
                  className={styles.createForm}
                  onSubmit={(event) => {
                    event.preventDefault();
                    handleCreate();
                  }}
                >
                  <input
                    className={styles.nameInput}
                    type="text"
                    placeholder="项目名称（留空自动命名）"
                    value={newName}
                    onChange={(event) => setNewName(event.target.value)}
                    aria-label="新项目名称"
                  />
                  <button className={styles.createBtn} type="submit" disabled={createMutation.isPending}>
                    <Plus size={16} strokeWidth={2} aria-hidden="true" />
                    <span>{createMutation.isPending ? '创建中…' : '新建项目'}</span>
                  </button>
                </form>
              </>
            )}
          </div>
          {(createError || pinError) && (
            <p className={styles.createError} role="alert">{createError || pinError}</p>
          )}
        </header>

        <main className={styles.content}>
          {isInitialLoading && (
            <div className={styles.skeletonGrid} role="status" aria-label="正在加载项目">
              {Array.from({ length: 6 }, (_, index) => <ProjectCardSkeleton key={index} />)}
            </div>
          )}

          {hasInitialError && (
            <div className={styles.empty} role="alert">
              <p>{errorMessage(projectQueryError, '项目列表加载失败')}</p>
              <button className={styles.retryBtn} type="button" onClick={() => void refetch()}>
                重试
              </button>
            </div>
          )}

          {!isInitialLoading && !hasInitialError && projects.length === 0 && (
            <div className={styles.empty}>
              <ImageOff size={32} strokeWidth={1.5} aria-hidden="true" />
              <p>还没有项目，点击“新建项目”开始创作。</p>
            </div>
          )}

          {projects.length > 0 && (
            <div className={styles.cardGrid} aria-label="项目列表">
              {projects.map((project) => {
                const isSelected = selectedIds.has(String(project.id));
                const isMenuOpen = openMenuId === String(project.id);

                return (
                  <article
                    key={project.id}
                    className={styles.card}
                    data-selected={isSelected || undefined}
                    tabIndex={0}
                    role={selectionMode ? 'button' : 'link'}
                    aria-label={selectionMode ? `选择项目 ${project.name}` : `打开项目 ${project.name}`}
                    aria-pressed={selectionMode ? isSelected : undefined}
                    onClick={() => openProject(project)}
                    onKeyDown={(event) => onCardKeyDown(event, project)}
                  >
                    <PreviewGallery project={project} />

                    {/* 置顶项目图钉角标（IKH1YL） */}
                    {project.pinned_at && (
                      <span className={styles.pinBadge} title="已置顶">
                        <Pin size={13} strokeWidth={2} aria-hidden="true" />
                      </span>
                    )}

                    {selectionMode && (
                      <button
                        className={styles.selectionToggle}
                        type="button"
                        aria-label={isSelected ? `取消选择 ${project.name}` : `选择 ${project.name}`}
                        aria-pressed={isSelected}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleProjectSelection(project.id);
                        }}
                      >
                        {isSelected && <Check size={15} strokeWidth={3} aria-hidden="true" />}
                      </button>
                    )}

                    <div className={styles.cardBody}>
                      <div className={styles.cardText}>
                        <h2 className={styles.projectName} title={project.name}>{project.name}</h2>
                        <time className={styles.date} dateTime={project.created_at}>
                          {formatProjectDate(project.created_at)}
                        </time>
                      </div>

                      {!selectionMode && (
                        <div className={styles.cardActions} onClick={(event) => event.stopPropagation()}>
                          <button
                            className={styles.menuTrigger}
                            type="button"
                            aria-label={`${project.name} 的更多操作`}
                            aria-expanded={isMenuOpen}
                            onClick={(event) => {
                              event.stopPropagation();
                              setOpenMenuId((current) => current === String(project.id) ? null : String(project.id));
                            }}
                          >
                            <MoreHorizontal size={19} strokeWidth={2} aria-hidden="true" />
                          </button>

                          {isMenuOpen && (
                            <div className={styles.cardMenu} role="menu" aria-label={`${project.name} 操作`}>
                              <button
                                type="button"
                                role="menuitem"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleTogglePin(project);
                                }}
                              >
                                {project.pinned_at ? (
                                  <PinOff size={15} strokeWidth={2} aria-hidden="true" />
                                ) : (
                                  <Pin size={15} strokeWidth={2} aria-hidden="true" />
                                )}
                                {project.pinned_at ? '取消置顶' : '置顶'}
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openEdit(project);
                                }}
                              >
                                <Pencil size={15} strokeWidth={2} aria-hidden="true" />
                                重命名
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                className={styles.menuDelete}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openSingleDelete(project);
                                }}
                              >
                                <Trash2 size={15} strokeWidth={2} aria-hidden="true" />
                                删除项目
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {!hasInitialError && projects.length > 0 && (
            <div className={styles.loadMore} ref={loadMoreRef}>
              {isFetchingNextPage && <span>正在加载更多项目…</span>}
              {isFetchNextPageError && (
                <>
                  <span>加载更多项目失败。</span>
                  <button className={styles.retryBtn} type="button" onClick={() => void fetchNextPage()}>
                    重试加载更多
                  </button>
                </>
              )}
              {!isFetchingNextPage && !isFetchNextPageError && hasNextPage && (
                <span>继续向下滚动加载更多</span>
              )}
              {!hasNextPage && <span>已显示 {projects.length} / {projectTotal} 个项目</span>}
            </div>
          )}
        </main>
      </div>

      <Modal
        open={!!editTarget}
        title="重命名项目"
        okText="保存"
        onOk={saveEdit}
        onCancel={closeEdit}
        confirmLoading={renameMutation.isPending}
        closable={!renameMutation.isPending}
        keyboard={!renameMutation.isPending}
        mask={{ closable: !renameMutation.isPending }}
        okButtonProps={{ disabled: !editingName.trim() }}
      >
        <label className={styles.modalLabel}>
          项目名称
          <input
            className={styles.modalInput}
            value={editingName}
            onChange={(event) => {
              const value = event.target.value;
              setEditingName(value);
              setEditError(value.trim() ? '' : '项目名不能为空');
            }}
            autoFocus
            onKeyDown={(event) => {
              if (event.key === 'Enter') saveEdit();
            }}
          />
        </label>
        {editError && <p className={styles.modalError} role="alert">{editError}</p>}
      </Modal>

      <Modal
        open={!!deleteTarget}
        title="删除项目"
        okText="删除项目"
        okType="danger"
        onOk={confirmSingleDelete}
        onCancel={closeSingleDelete}
        confirmLoading={deleteMutation.isPending}
        closable={!deleteMutation.isPending}
        keyboard={!deleteMutation.isPending}
        mask={{ closable: !deleteMutation.isPending }}
        okButtonProps={{ disabled: !deleteTarget || deleteConfirmation !== deleteTarget.name }}
      >
        <p className={styles.modalCopy}>
          删除后将无法恢复项目及其关联素材。请输入项目名称“{deleteTarget?.name ?? ''}”以确认。
        </p>
        <input
          className={styles.modalInput}
          value={deleteConfirmation}
          onChange={(event) => setDeleteConfirmation(event.target.value)}
          placeholder={deleteTarget?.name}
          autoFocus
          onKeyDown={(event) => {
            if (event.key === 'Enter') confirmSingleDelete();
          }}
        />
        {deleteError && <p className={styles.modalError} role="alert">{deleteError}</p>}
      </Modal>

      <Modal
        open={batchConfirmOpen}
        title="批量删除项目"
        okText="删除选中项目"
        okType="danger"
        onOk={confirmBatchDelete}
        onCancel={closeBatchDelete}
        confirmLoading={batchDeleteMutation.isPending}
        closable={!batchDeleteMutation.isPending}
        keyboard={!batchDeleteMutation.isPending}
        mask={{ closable: !batchDeleteMutation.isPending }}
        okButtonProps={{ disabled: selectedCount === 0 || batchConfirmation.trim() !== '删除' }}
      >
        <p className={styles.modalCopy}>
          将删除已选的 {selectedCount} 个项目及其关联素材。请输入“删除”以确认。
        </p>
        <input
          className={styles.modalInput}
          value={batchConfirmation}
          onChange={(event) => setBatchConfirmation(event.target.value)}
          placeholder="删除"
          autoFocus
          onKeyDown={(event) => {
            if (event.key === 'Enter') confirmBatchDelete();
          }}
        />
        {batchError && <p className={styles.modalError} role="alert">{batchError}</p>}
      </Modal>
    </div>
  );
}
