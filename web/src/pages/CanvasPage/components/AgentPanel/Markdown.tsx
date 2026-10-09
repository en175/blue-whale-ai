import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './index.module.css';
import { ASSET_MENTION_ATTR, rehypeAssetMentions, type KnownAsset } from './assetMentions';
import { AssetMentionChip } from './AssetMentionChip';

export function Markdown({ text, assets = [], className }: { text: string; assets?: readonly KnownAsset[]; className?: string }) {
  const rehypePlugins = useMemo(() => (assets.length ? [rehypeAssetMentions(assets)] : []), [assets]);
  return (
    <div className={className ?? styles.md}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={rehypePlugins}
        components={{
          span: ({ node: _node, children, ...props }) => {
            const attrs = props as Record<string, unknown>;
            const assetId = attrs[ASSET_MENTION_ATTR];
            if (typeof assetId !== 'string') return <span {...props}>{children}</span>;
            return (
              <AssetMentionChip
                assetId={assetId}
                label={String(attrs['data-asset-label'] ?? '')}
                name={typeof attrs['data-asset-name'] === 'string' ? attrs['data-asset-name'] : undefined}
                mediaType={attrs['data-asset-media'] === 'video' ? 'video' : 'image'}
                url={typeof attrs['data-asset-url'] === 'string' ? attrs['data-asset-url'] : undefined}
              />
            );
          },
          table: ({ children }) => (
            <div className={styles.mdTableWrap}>
              <table>{children}</table>
            </div>
          ),
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
