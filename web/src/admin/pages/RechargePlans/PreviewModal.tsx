import { useQuery } from '@tanstack/react-query';
import { Star } from 'lucide-react';
import { topupTierPreviewOptions, type TopupTierPreview } from '@/api/adminTopupTiers';
import { isApiError } from '@/api/http';
import { Badge, Button, Card, Empty, Hint, Modal, Stat } from '../../ui';
import { discountLabel, fmtMoney, fmtPoints } from './plan';

export default function PreviewModal({ onClose }: { onClose: () => void }) {
  const preview = useQuery(topupTierPreviewOptions());
  const list: TopupTierPreview[] = preview.data ?? [];
  const loading = preview.isPending;
  const error = preview.isError
    ? isApiError(preview.error)
      ? preview.error.message
      : '获取预览数据失败'
    : '';

  return (
    <Modal
      open
      width={720}
      onClose={onClose}
      title={
        <>
          用户端充值页效果预览{' '}
          <Hint>以下展示当前已上架且未失效的档位在用户端充值页的真实排列效果。</Hint>
        </>
      }
    >
      {error && (
        <div style={{ marginTop: 12 }}>
          <Empty message={error} extra={<Button onClick={() => void preview.refetch()}>重试</Button>} />
        </div>
      )}
      {!error && loading && <Empty message="加载中…" />}
      {!error && !loading && list.length === 0 && <Empty message="暂无上架档位" />}
      {!error && !loading && list.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
          {list.map((p) => (
            <Card
              key={p.id}
              extra={
                p.isRecommended ? (
                  <Badge tone="accent">
                    <Star size={12} strokeWidth={2} fill="currentColor" />
                    推荐
                  </Badge>
                ) : undefined
              }
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 16,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <Stat
                    label="积分"
                    value={fmtPoints(p.baseCredits)}
                    hint={p.discount < 1 ? `${discountLabel(p.discount)}优惠` : undefined}
                  />
                  <Stat
                    label="实付"
                    value={`¥${fmtMoney(p.price)}`}
                    hint={p.discount < 1 ? `¥${fmtMoney(p.originalPrice)}` : undefined}
                  />
                </div>
                <Button variant="primary">立即充值</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </Modal>
  );
}
