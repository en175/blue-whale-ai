import { useState } from 'react';
import UserDropdown from '@/custom/components/UserDropdown';
import CreditsBadge from './components/CreditsBadge';
import CreditsShopButton from './components/CreditsShopButton';
import ChatBox from './components/ChatBox';
import CardGallery from './components/CardGallery';
import CanvasEntry from './components/CanvasEntry';
import styles from './index.module.css';

export default function Home() {
  const [chatDraft, setChatDraft] = useState<{ text: string; ts: number; mediaType: 'video' | 'image' } | null>(null);
  const [workspace, setWorkspace] = useState<'create' | 'canvas'>('create');

  return (
    <div className={styles.home}>
      {}
      <div className={styles.topBar}>
        <CreditsShopButton />
        <CreditsBadge />
        <UserDropdown />
      </div>

      <div className={styles.stage}>
        {}
        <div className={styles.hero}>
          <h1 className={styles.title}>
            让想象有画面
            <br />
            让表达有回响
          </h1>
        </div>

        {}
        <div className={styles.chatWrap}>
          <ChatBox
            draft={chatDraft}
            workspace={workspace}
            onWorkspaceChange={setWorkspace}
          />
        </div>

        {}
        <div className={styles.galleryWrap}>
          {workspace === 'create' ? (
            <CardGallery onCardClick={(text, mediaType) => setChatDraft({ text, mediaType, ts: Date.now() })} />
          ) : (
            <CanvasEntry />
          )}
        </div>
      </div>
    </div>
  );
}
