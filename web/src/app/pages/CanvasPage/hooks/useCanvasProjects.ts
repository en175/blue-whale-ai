import { useNavigate } from 'react-router-dom';
import type { Dispatch, SetStateAction } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  createProject,
  deleteProject,
  fetchProjects,
  pinProject,
  projectKeys,
  renameProject,
} from '@/api/projects';
import { defaultProjectName } from '@/utils/projectName';
import type { CanvasProject } from '../components/ProjectSelector';
import { shouldReturnToProjectsAfterDelete } from '../canvasQuery';

export interface CanvasProjectsHost {
  currentId: string;
  setCurrentId: (id: string) => void;
  projects: CanvasProject[];
  setProjects: Dispatch<SetStateAction<CanvasProject[]>>;
  ensureSavedBeforeProjectSwitch: () => Promise<boolean>;
}

export interface CanvasProjectsHandles {
  handleSelect: (id: string) => Promise<void>;
  handleRename: (id: string, newName: string) => void;
  handleToggleProjectPin: (id: string, pinned: boolean) => void;
  handleDelete: (id: string) => void;
  handleNewProject: () => Promise<void>;
}

export function useCanvasProjects(host: CanvasProjectsHost): CanvasProjectsHandles {
  const { currentId, setCurrentId, projects, setProjects, ensureSavedBeforeProjectSwitch } = host;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const handleSelect = async (id: string) => {
    if (!id || id === currentId) return;
    if (!(await ensureSavedBeforeProjectSwitch())) return;
    setCurrentId(id);
  };

  const handleRename = (id: string, newName: string) => {
    renameProject(id, newName)
      .then((updated) => {
        setProjects((prev) =>
          prev.map((p) => (p.id === id ? { ...p, name: updated.name } : p)),
        );
      })
      .catch(() => undefined);
  };

  const handleToggleProjectPin = (id: string, pinned: boolean) => {
    pinProject(id, pinned)
      .then(() => fetchProjects())
      .then((list) => {
        setProjects(list.map((p) => ({ id: String(p.id), name: p.name, pinned: Boolean(p.pinned_at) })));
        queryClient.invalidateQueries({ queryKey: projectKeys.all });
      })
      .catch(() => undefined);
  };

  const handleDelete = (id: string) => {
    deleteProject(id)
      .then(() => {
        const remaining = projects.filter((p) => p.id !== id);
        setProjects(() => remaining);
        queryClient.removeQueries({ queryKey: projectKeys.all });
        if (shouldReturnToProjectsAfterDelete(currentId, id)) {
          navigate('/projects');
          return;
        }
      })
      .catch(() => undefined);
  };

  const handleNewProject = async () => {
    if (!(await ensureSavedBeforeProjectSwitch())) return;
    try {
      const created = await createProject(defaultProjectName());
      const item: CanvasProject = { id: String(created.id), name: created.name };
      setProjects((prev) => [item, ...prev]);
      setCurrentId(item.id);
    } catch {
    }
  };

  return { handleSelect, handleRename, handleToggleProjectPin, handleDelete, handleNewProject };
}
