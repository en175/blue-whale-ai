import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutGrid, Plus } from 'lucide-react';
import { createProject, fetchRecentProjects, projectPreviews, type ProjectRecord } from '@/custom/api/projects';
import LoginModal from '@/custom/components/LoginModal';
import { showToast } from '@/custom/components/Toast';
import { getCurrentUser } from '@/shared/utils/auth';
import { resolveMediaSrc } from '@/shared/utils/remoteImageCors';
import { openCanvasTab } from '@/custom/utils/open-canvas-tab';
import {
  clearCreateAttempt,
  clearLatestAttempt,
  fetchRecentBySource,
  matchCreatedProject,
  newCreateAttempt,
  readLatestAttempt,
  writeLatestAttempt,
} from '../ChatBox/createAttempt';
import styles from './index.module.css';

const RECENT_LIMIT = 3;

function makeProjectName(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function CanvasEntry() {
  const navigate = useNavigate();
  const [showLogin, setShowLogin] = useState(false);
  const [creating, setCreating] = useState(false);
  const [recent, setRecent] = useState<ProjectRecord[]>([]);

  useEffect(() => {
    if (!getCurrentUser()) return;
    let alive = true;
    fetchRecentProjects(RECENT_LIMIT)
      .then((list) => {
        if (alive) setRecent((list ?? []).slice(0, RECENT_LIMIT));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const resumeLatest = async (userId: number): Promise<boolean> => {
    const attempt = readLatestAttempt(userId);
    if (!attempt) return false;
    try {
      const created = matchCreatedProject(await fetchRecentBySource('canvas'), attempt);
      if (!created) {
        clearLatestAttempt();
        return false;
      }
      clearLatestAttempt();
      navigate(`/canvas?project=${created.id}`);
      return true;
    } catch {
      return false;
    }
  };

  const creatingRef = useRef(false);

  const createCanvas = async () => {
    if (creatingRef.current) return;
    const current = getCurrentUser();
    if (!current) {
      setShowLogin(true);
      return;
    }
    creatingRef.current = true;
    setCreating(true);
    try {
      if (await resumeLatest(current.userId)) return;
      const attempt = newCreateAttempt(current.userId, makeProjectName(), null);
      writeLatestAttempt(attempt);
      const created = await createProject(attempt.name, {
        headers: { 'Idempotency-Key': attempt.id },
        silent: true,
      }, 'canvas');
      clearLatestAttempt();
      clearCreateAttempt();
      navigate(`/canvas?project=${created.id}`);
    } catch (error) {
      showToast('error', error instanceof Error && error.message ? error.message : '创建项目失败，请稍后再试');
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  };

  const handleLoginClose = () => {
    setShowLogin(false);
    if (getCurrentUser()) void createCanvas();
  };

  return (
    <div className={styles.entryGrid} data-testid="canvas-entry">
      <button type="button" className={styles.newCanvas} onClick={createCanvas} disabled={creating}>
        <span className={styles.newCanvasIcon}>
          <Plus size={20} strokeWidth={2} />
        </span>
        <span className={styles.newCanvasLabel}>新建画布</span>
      </button>
      {recent.map((project) => {
        const cover = projectPreviews(project)[0];
        return (
          <button
            key={project.id}
            type="button"
            className={styles.recentCard}
            data-testid="canvas-recent-card"
            onClick={() => openCanvasTab(project.id)}
          >
            {cover ? (
              cover.type === 'video' ? (
                <video className={styles.recentCover} src={resolveMediaSrc(cover.url)} muted playsInline preload="metadata" />
              ) : (
                <img className={styles.recentCover} src={resolveMediaSrc(cover.url)} alt="" loading="lazy" />
              )
            ) : (
              <span className={styles.recentEmpty} data-testid="canvas-recent-empty">
                <LayoutGrid size={26} strokeWidth={1.4} aria-hidden="true" />
                <span>暂无内容预览</span>
              </span>
            )}
            <strong className={styles.recentName}>{project.name}</strong>
          </button>
        );
      })}
      {showLogin && <LoginModal onClose={handleLoginClose} />}
    </div>
  );
}
