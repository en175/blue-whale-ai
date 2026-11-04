import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import UserDropdown from '@/custom/components/UserDropdown';
import CreditsBadge from '@/custom/components/CreditsBadge';
import CreditsShopButton from './components/CreditsShopButton';
import ChatBox from './components/ChatBox';
import CardGallery from './components/CardGallery';
import CanvasEntry from './components/CanvasEntry';
import WorkspaceSwitch from './components/WorkspaceSwitch';
import styles from './index.module.css';

export type HomeWorkspace = 'create' | 'canvas';

export default function Home() {
  const navigate = useNavigate();
  const [chatDraft, setChatDraft] = useState<{ text: string; ts: number; mediaType: 'video' | 'image' } | null>(null);
  const [workspace, setWorkspace] = useState<HomeWorkspace>('create');

  return (
    <div className={styles.home}>
      {}
      <div className={styles.topBar}>
        <CreditsShopButton />
        <CreditsBadge />
        <UserDropdown />
      </div>

      <div className={styles.stage}>
        <div className={styles.creation}>
          {}
          <h1 className={styles.title}>让想象有画面，让表达有回响</h1>

          {}
          <WorkspaceSwitch value={workspace} onChange={setWorkspace} />

          {workspace === 'canvas' && (
            <div className={styles.canvasEntryWrap}>
              <div className={styles.entryHeading}>
                <button type="button" className={styles.entryLink} onClick={() => navigate('/projects')}>
                  全部项目 ↗
                </button>
              </div>
              <CanvasEntry />
            </div>
          )}

          {}
          <div className={styles.chatWrap} data-workspace={workspace}>
            <ChatBox draft={chatDraft} workspace={workspace} />
          </div>
        </div>

        <div className={styles.inspirationWrap}>
          <CardGallery onCardClick={(text, mediaType) => setChatDraft({ text, mediaType, ts: Date.now() })} />
        </div>
      </div>
    </div>
  );
}
