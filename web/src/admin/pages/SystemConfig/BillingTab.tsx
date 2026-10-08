import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  billingCatalogKeys,
  billingCatalogOptions,
  publishBillingCatalog,
} from '@/api/adminBillingCatalog';
import { isApiError } from '@/api/http';
import { Alert, Badge, Button, Field, Input, Select, formGrid } from '../../ui';
import {
  isCatalogDirty,
  parseCatalog,
  readCreditsPerYuan,
  readDiscountPolicy,
  serializeCatalog,
  siteCatalogDocument,
  type CatalogDocumentJson,
} from '../../lib/billing-catalog/catalogDraft';
import { combineFactors, describeFloor, describeStackMode, formatDiscount } from '../../discountRules';
import {
  buildNote,
  creditsPerYuanError,
  floorFactorBpError,
  MAX_CREDITS_PER_YUAN,
  MIN_CREDITS_PER_YUAN,
  textOf,
} from './billingSiteParams';

type Loaded =
  | { kind: 'pending' }
  | { kind: 'none' }
  | { kind: 'ok'; doc: CatalogDocumentJson; version: number }
  | { kind: 'broken'; message: string };

const EXAMPLE_MEMBER_BP = 9000;
const EXAMPLE_PROMOTION_BP = 7000;

const errMsg = (e: unknown, fallback: string) => (isApiError(e) ? e.message : fallback);

const tabBodyStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 20,
  maxWidth: 980,
} as const;

export default function BillingTab() {
  const catalog = useQuery(billingCatalogOptions());
  const queryClient = useQueryClient();

  const [rateText, setRateText] = useState('');
  const [stackMode, setStackMode] = useState('multiply');
  const [floorText, setFloorText] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [published, setPublished] = useState<number | null>(null);

  const syncedVersionRef = useRef<number | null>(null);

  const loaded = useMemo<Loaded>(() => {
    const data = catalog.data;
    if (data === undefined) return { kind: 'pending' };
    if (data.catalogVersion < 0) return { kind: 'none' };
    try {
      return {
        kind: 'ok',
        doc: parseCatalog(data.document),
        version: data.catalogVersion,
      };
    } catch (e) {
      return {
        kind: 'broken',
        message: e instanceof Error ? e.message : '目录文档解析失败',
      };
    }
  }, [catalog.data]);

  useEffect(() => {
    if (loaded.kind !== 'ok') return;
    if (syncedVersionRef.current === loaded.version) return;
    syncedVersionRef.current = loaded.version;
    const doc = loaded.doc;
    const policy = readDiscountPolicy(doc);
    setRateText(textOf(readCreditsPerYuan(doc)));
    setStackMode(policy.stackMode);
    setFloorText(textOf(policy.floorFactorBp));
  }, [loaded]);

  const rateError = creditsPerYuanError(rateText);
  const floorError = floorFactorBpError(floorText);

  const draft = useMemo(() => {
    if (loaded.kind !== 'ok' || rateError !== null || floorError !== null) return null;
    return siteCatalogDocument(Number(rateText.trim()), {
      stackMode,
      floorFactorBp: Number(floorText.trim()),
    });
  }, [loaded, rateError, floorError, rateText, stackMode, floorText]);

  const baseline = useMemo(
    () =>
      loaded.kind === 'ok'
        ? siteCatalogDocument(readCreditsPerYuan(loaded.doc), readDiscountPolicy(loaded.doc))
        : null,
    [loaded],
  );

  const dirty = draft !== null && baseline !== null && isCatalogDirty(draft, baseline);

  const save = async () => {
    if (saving || draft === null || loaded.kind !== 'ok') return;
    setSaving(true);
    setError('');
    setPublished(null);
    try {
      const result = await publishBillingCatalog({
        document: serializeCatalog(draft),
        note: buildNote(loaded.doc, {
          creditsPerYuan: Number(rateText.trim()),
          stackMode,
          floorFactorBp: Number(floorText.trim()),
        }),
      });
      setPublished(result.catalogVersion);
      await queryClient.invalidateQueries({ queryKey: billingCatalogKeys.all });
    } catch (e) {
      setError(errMsg(e, '发布失败：定价目录没被接受，请检查上面两项'));
    } finally {
      setSaving(false);
    }
  };

  if (catalog.isError) {
    return (
      <Alert tone="warning" title="读不到定价目录">
        定价目录没取到（{errMsg(catalog.error, '请求失败')}）—— 这两个参数住在目录里，
        读不到就读不出它们当前生效的值，重建出来的只会是一份编的配置。请确认定价目录接口是否正常。
      </Alert>
    );
  }

  switch (loaded.kind) {
    case 'pending':
      return <Alert tone="info">正在读取当前定价目录…</Alert>;

    case 'none':
      return (
        <Alert tone="warning" title="还没有生效的定价目录">
          这两个参数住在定价目录里，而当前没有生效版本 —— 没有底板就没有「改了什么」可言，
          所以这里不给发布按钮。先由目录发布流程建出第一版，之后才能在这里改。
        </Alert>
      );

    case 'broken':
      return (
        <Alert tone="danger" title="定价目录文档解析失败">
          {loaded.message}
          <div style={{ marginTop: 6 }}>
            文档读不出来，就读不出这两个字段的当前值 —— 这时候发布等于拿一份编的配置覆盖生效版本。
            请先把目录文档的内容修好。
          </div>
        </Alert>
      );

    case 'ok': {
      const version = loaded.version;
      const floorBp = Number(floorText.trim());
      const exampleCombined = combineFactors(EXAMPLE_MEMBER_BP, EXAMPLE_PROMOTION_BP, stackMode);
      const exampleFloored = Math.max(exampleCombined, floorBp);

      return (
        <div style={tabBodyStyle}>
            <div
              style={formGrid(2)}
            >
          <Field
            label="换算率：1 元 = 多少积分"
            info={
              <>
                <div>
                  <b>保存 = 发布一版新目录。</b>与前面几个 tab「改一项存一项」不同：这两个参数住在
                  定价目录里，而目录是整份发布的 —— 保存即拿它们重建一份目录、整份发出去。
                </div>
                <div>
                  目录是版本化的冻结物（任务提交时冻结版本、结算按它复现），所以每保存一次都会留下一版
                  可整体回滚的历史。本页只发布这两项；每个模型的价在模型列表的「定价」tab 里，
                  长在能力行上、不在这份文档里。
                </div>
              </>
            }
            hint={
              <>
                作用于<b>充值</b>：到账积分 = 档位原价（元）× 这个值。合法范围{' '}
                {MIN_CREDITS_PER_YUAN} ~ {MAX_CREDITS_PER_YUAN}。
                <br />
                例：填 15 → 充 1 元到账 15 积分，充 100 元到账 1500 积分。
                <br />
                生成任务的计价<b>不读它</b>（目录里的单价本来就是 mc，出口按固定汇率换积分），
                所以改它不会动到任何一次生成的价格，也不影响已提交的任务。
              </>
            }
          >
            <Input
              type="number"
              inputMode="numeric"
              aria-label="换算率：1 元 = 多少积分"
              placeholder="15"
              value={rateText}
              disabled={saving}
              style={{ width: '100%' }}
              onChange={(e) => setRateText(e.target.value)}
            />
            {rateError !== null && (
              <div style={{ marginTop: 10 }}>
                <Alert tone="danger">{rateError}</Alert>
              </div>
            )}
          </Field>

          <Field
            label="折扣叠加方式"
            hint={
              <>
                同时命中会员折扣与活动（那两张表分别在「会员折扣」与「限时活动」页）时，
                最终系数按这个方式合并。它决定两者<b>会不会叠加</b>，是站点级参数。
              </>
            }
          >
            <Select
              aria-label="折扣叠加方式"
              options={[
                { value: 'multiply', label: describeStackMode('multiply') },
                { value: 'best', label: describeStackMode('best') },
              ]}
              value={stackMode}
              disabled={saving}
              onChange={setStackMode}
            />
          </Field>
        </div>

        <Field
          label="折扣底线（万分比）"
          hint={
            <>
              合并出来的折扣低于它会<b>被抬到底线</b>——运营在两张表里各配一个折扣时没人会心算乘积，
              底线把「配错」的后果限制在「少赚」而不是「亏本」。当前填的是{' '}
              {floorError === null ? describeFloor(floorBp) : '（待修正）'}。
              <br />
              10000 = 不打折（原价），3000 = 最低 3 折，8500 = 8.5 折。
              <br />
              例：会员 {formatDiscount(EXAMPLE_MEMBER_BP)} 与活动{' '}
              {formatDiscount(EXAMPLE_PROMOTION_BP)} 同时命中 → 按当前方式合并为{' '}
              {formatDiscount(exampleCombined)}，再取底线得 {formatDiscount(exampleFloored)}
              {exampleFloored === exampleCombined && '（本例未触及底线）'}。
            </>
          }
        >
          <Input
            type="number"
            inputMode="numeric"
            aria-label="折扣底线（万分比）"
            placeholder="3000"
            value={floorText}
            disabled={saving}
            style={{ width: 200 }}
            onChange={(e) => setFloorText(e.target.value)}
          />
          {floorError !== null && (
            <div style={{ marginTop: 10 }}>
              <Alert tone="danger">{floorError}</Alert>
            </div>
          )}
        </Field>

        {error !== '' && (
          <Alert tone="danger" title="发布失败">
            {error}
            <div style={{ marginTop: 6 }}>
              报价与结算按的就是生效版本 —— 上面这些改动<b>没有</b>生效，目录仍是 v{version}。
            </div>
          </Alert>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <Button variant="primary" disabled={saving || !dirty} onClick={() => void save()}>
            {saving ? '发布中…' : `发布新版本（v${version} → v${version + 1}）`}
          </Button>
          {published !== null && <Badge tone="success">已发布 v{published} ✓</Badge>}
          {published === null && !dirty && (
            <span>
              当前没有改动 —— 目录是版本化的，内容相同的重复发布会白占一个版本，
              所以按钮是灰的。
            </span>
          )}
          </div>
        </div>
      );
    }
  }
}
