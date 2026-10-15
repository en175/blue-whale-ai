import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { SessionContentBlock } from '@/app/api/agentSessions';

export function useCanvasAgentSurface() {
  const navigate = useNavigate();
  const location = useLocation();
  const [showAgent, setShowAgent] = useState(false);
  const [agentOpened, setAgentOpened] = useState(false);
  useEffect(() => { if (showAgent) setAgentOpened(true); }, [showAgent]);
  const [agentCandidate, setAgentCandidate] = useState<SessionContentBlock[] | null>(null);
  const cancelAgentCandidate = useCallback(() => setAgentCandidate(null), []);
  useEffect(() => {
    if (!showAgent) setAgentCandidate(null);
  }, [showAgent]);
  useEffect(() => {
    if (!agentCandidate) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAgentCandidate(null);
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, [agentCandidate]);
  const [agentContext, setAgentContext] = useState<{
    text: string;
    label?: string;
    skillId?: string;
    skillName?: string;
    ts: number;
    mediaBlocks?: SessionContentBlock[];
  } | null>(null);
  useEffect(() => {
    const state = location.state as { agentText?: string; skillId?: string; skillName?: string } | null;
    if (!state?.agentText && !state?.skillId) return;
    setAgentContext({
      text: state.agentText ?? '',
      skillId: state.skillId ?? '',
      skillName: state.skillName ?? '',
      ts: Date.now(),
      mediaBlocks: undefined,
    });
    setShowAgent(true);
    navigate(location.pathname + location.search, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, location.pathname, location.search, navigate]);
  return {
    showAgent,
    setShowAgent,
    agentOpened,
    setAgentOpened,
    agentCandidate,
    setAgentCandidate,
    cancelAgentCandidate,
    agentContext,
    setAgentContext,
  };
}
