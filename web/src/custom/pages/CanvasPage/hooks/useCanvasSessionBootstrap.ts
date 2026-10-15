import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { useAuthStore } from '@/shared/stores/auth';
import { fetchMe, fetchCredits, toSessionUser } from '@/custom/api/auth';
import { fetchProjects, createProject, touchProjectLastOpened } from '@/custom/api/projects';
import type { CanvasProject } from '../components/ProjectSelector';
import {
  findLastOpenedProjectId,
  findLatestCreatedProjectId,
  pickCanvasIdAfterLoad,
} from '../canvasQuery';

export function useCanvasSessionBootstrap(input: {
  currentId: string;
  projects: CanvasProject[];
  setProjects: Dispatch<SetStateAction<CanvasProject[]>>;
  setCurrentId: Dispatch<SetStateAction<string>>;
}): void {
  const { currentId, projects, setProjects, setCurrentId } = input;
  const updateUser = useAuthStore((s) => s.updateUser);
  const setUsage = useAuthStore((s) => s.setUsage);
  useEffect(() => {
    fetchMe()
      .then((me) => updateUser(toSessionUser(me)))
      .catch(() => undefined);
  }, [updateUser]);
  useEffect(() => {
    let alive = true;
    fetchCredits()
      .then((d) => {
        if (alive) setUsage(d);
      })
      .catch(() => {
        if (alive) setUsage(null);
      });
    return () => {
      alive = false;
    };
  }, [setUsage]);
  useEffect(() => {
    let alive = true;
    fetchProjects()
      .then(async (list) => {
        if (!alive) return;
        const lastOpenedId = findLastOpenedProjectId(list);
        const latestCreatedId = findLatestCreatedProjectId(list);
        let mapped = list.map((p) => ({ id: String(p.id), name: p.name, pinned: Boolean(p.pinned_at) }));
        if (mapped.length === 0) {
          try {
            const created = await createProject('未命名项目');
            if (!alive) return;
            mapped = [{ id: String(created.id), name: created.name, pinned: false }];
          } catch {
          }
        }
        setProjects(mapped);
        setCurrentId((prev) => pickCanvasIdAfterLoad(prev, mapped.map((m) => m.id), lastOpenedId, latestCreatedId));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [setProjects, setCurrentId]);
  const lastTouchedProjectRef = useRef('');
  useEffect(() => {
    if (!currentId || lastTouchedProjectRef.current === currentId) return;
    if (!projects.some((p) => p.id === currentId)) return;
    lastTouchedProjectRef.current = currentId;
    touchProjectLastOpened(currentId).catch(() => undefined);
  }, [currentId, projects]);
}
