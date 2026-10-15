import { useState } from 'react';
import UserDropdown from '@/app/components/UserDropdown';
import CreditsBadge from './components/CreditsBadge';
import CreditsShopButton from './components/CreditsShopButton';
import ChatBox from './components/ChatBox';
import CardGallery from './components/CardGallery';
import styles from './index.module.css';

export default function Home() {
  const [chatDraft, setChatDraft] = useState<{ text: string; ts: number; mediaType: 'video' | 'image' } | null>(null);

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
            任意视频，告诉你的 Agent 即可创建
          </h1>
        </div>

        {}
        <div className={styles.chatWrap}>
          <ChatBox draft={chatDraft} />
        </div>

        {}
        <div className={styles.galleryWrap}>
          <CardGallery onCardClick={(text, mediaType) => setChatDraft({ text, mediaType, ts: Date.now() })} />
        </div>
      </div>
    </div>
  );
}
