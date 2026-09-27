/* ============================================
 * 用户端充值页效果预览（GET /api/admin/topup-tiers/preview）。
 *
 * 只展示**已上架且未失效**的档位——服务端 listActive 过滤，草稿与下架都进不来，
 * 所以运营在这里看到的顺序就是用户在充值页看到的顺序。
 * ============================================ */
import { useCallback, useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import { fetchTopupTierPreview, type TopupTierPreview } from '@/api/admin';
import { isApiError } from '@/api/http';
import { Badge, Button, Card, Empty, Hint, Modal, Stat } from '../../ui';
import { discountLabel, fmtMoney, fmtPoints } from './plan';

export default function PreviewModal({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<TopupTierPreview[] | null>(null);
  const [error, setError] = useState('');

  /** 拉取当前已上架且未失效的档位（服务端过滤）；加载失败可重试 */
  const load = useCallback(() => {
    setError('');
    setList(null);
    fetchTopupTierPreview()
      .then(setList)
      .catch((e) => setError(isApiError(e) ? e.message : '获取预览数据失败'));
  }, []);

  // 打开时拉取
  useEffect(() => load(), [load]);

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
          <Empty message={error} extra={<Button onClick={load}>重试</Button>} />
        </div>
      )}
      {!error && list === null && <Empty message="加载中…" />}
      {!error && list !== null && list.length === 0 && <Empty message="暂无上架档位" />}
      {!error && list !== null && list.length > 0 && (
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
