/**
 * Agent 回复的 Markdown 渲染。
 *
 * 原来是手写的逐行解析器，只认标题、无序列表和引用：模型输出的表格原样显示成一堆竖线，
 * 有序列表退化成普通段落，围栏代码块的 ``` 直接印在正文里（IKA2VC-4）。这些都不是能靠
 * 补几条正则收住的，换成 react-markdown + GFM 一次解决，也顺带把嵌套、链接、删除线补上。
 *
 * 表格自带横向滚动容器：面板本来就窄，宽表格必须自己滚，不能把整个消息流撑出横向滚动条。
 *
 * 从 index.tsx 搬出来（IKFLB9）：提示词卡和文档弹层也要用它。
 */
import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './index.module.css';
import { ASSET_MENTION_ATTR, rehypeAssetMentions, type KnownAsset } from './assetMentions';
import { AssetMentionChip } from './AssetMentionChip';

export function Markdown({ text, assets = [], className }: { text: string; assets?: readonly KnownAsset[]; className?: string }) {
  // 本会话已知的素材名在正文里换成胶囊（IKDLW3）。插件按 assets 记忆：每次渲染造一个新插件会让
  // react-markdown 重建整条处理链。
  const rehypePlugins = useMemo(() => (assets.length ? [rehypeAssetMentions(assets)] : []), [assets]);
  return (
    <div className={className ?? styles.md}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={rehypePlugins}
        components={{
          // 插件把命中的名字标成带 data 属性的 span；其余 span 原样。
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
          // 模型偶尔会输出链接。新标签页打开，并断开与本页的 opener 引用。
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
