/* ============================================
 * 系统设置 · 计费：站点级计费参数（换算率 / 折扣叠加策略与底线）
 *
 * ── 为什么这两个字段在这里，而不在模型列表 ────────────────────────────────────
 *
 * `creditsPerYuan` 是「1 元 = 多少积分」，作用于**充值**换算；`discountPolicy` 是全局折扣
 * 怎么叠、底线在哪。两者都描述**站点**，不是任何一个模型的属性 —— 模型列表里的「定价」tab
 * 改的是**那一个模型**的价（写进能力行的 `pricing`），放不下一件与模型无关的事。
 *
 * ── 保存语义与其它 tab 不同（页面必须说清） ───────────────────────────────────
 *
 * 前面几个 tab 是「改一项存一项」（`system_settings` 表逐项更新）。这里不是：
 * 定价目录是**一份 JSON 整份发布**，保存 = 拿本页这两个值**重建**一份目录 → 整份发布，
 * 版本号 +1。所以按钮上直接写着新版本号，而不是一个含义不明的「保存」。
 *
 * ── ⚠️ 这里**是**白名单重建（与旧版相反，页面必须说清为什么）────────────────
 *
 * 目录以前还装着每个模型的计价规则（`models.<模型>.<任务类型>`）。那时发布**绝不能**按本页
 * 认识的字段拼一份新文档 —— 一次「改换算率」的保存会把目录里那十几个模型的规则整个抹掉，
 * 而界面上看不出任何异常。所以旧版是「解析后的原对象展开 + 只换这两个键」，属于**本页不编辑、
 * 但必须逐字带回去**的东西。
 *
 * 那批规则已经搬进模型能力行（`generation_model_capability.pricing`，见模型列表的「定价」tab），
 * 目录现在**只装** `schemaVersion` / `currency` / `creditsPerYuan` / `discountPolicy`。于是重建
 * 不再有受害者，反而是唯一说得清「发出去的文档里有什么」的做法：它不取决于库里那份历史上长什么样。
 * 重建的口径在 `siteCatalogDocument`（`lib/billing-catalog/catalogDraft.ts`），本页只给它两个值。
 *
 * ⚠️ 由此还带出一条**基线**上的讲究：既然发出去的文档是重建的，判断「有没有改动」的基线也必须
 *    是**同一口径重建出来的**那份，而不是读回来那份原文 —— 否则原文里残留的 `models` 会让
 *    「打开看一眼、点保存」永远显示成「改过了」（见下方 `baseline`）。
 *
 * ⚠️ 还有一条并发语义：目录发布没有锁、也没有「版本前置校验」，后保存的整份覆盖先保存的。
 *    所以页面上常驻显示**当前生效版本号** —— 至少能看出「我手里这份不是最新的」。
 * ============================================ */
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

/**
 * 服务端那份目录的状态。
 *
 * <p>四种分开写，因为**处置完全不同**：还在读（等）｜没有生效版本（改不了，见下方分支）｜
 * 读到了（正常渲染）｜读到了但不是合法 JSON（不能发布）。压成一个「有或没有」的布尔，
 * 就会把「没有」与「读坏了」混成一件事 —— 而后者拿一份没读懂的文档去发布是会覆盖生效版本的。
 */
type Loaded =
  | { kind: 'pending' }
  | { kind: 'none' }
  | { kind: 'ok'; doc: CatalogDocumentJson; version: number }
  | { kind: 'broken'; message: string };

/**
 * 算例用的两个折扣倍数。**不是任何一条真实折扣**，只是把「叠加怎么算」说到能心算 ——
 * 与 `DiscountPolicyNotice` 用同一组数，两处说的是同一个例子。
 */
const EXAMPLE_MEMBER_BP = 9000;
const EXAMPLE_PROMOTION_BP = 7000;

const errMsg = (e: unknown, fallback: string) => (isApiError(e) ? e.message : fallback);

/** 与页面其它 tab 同一版式（原由 .tabBody 给，见 index.tsx 的 tabBodyStyle） */
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
  /** 上一次成功发布回来的新版本号（保存后回显）。 */
  const [published, setPublished] = useState<number | null>(null);

  /**
   * 最近一次「表单被服务端数据对齐过」的版本号。
   *
   * <p>用它而不是让 `useEffect([catalog.data])` 无条件覆盖表单：react-query 默认会在窗口
   * 重新获得焦点时重取，取回**同一版本**时若也重设表单，用户正在填的值会被悄悄冲掉
   * （「我明明改了，切回来又是老数」）。版本号变了才对齐，语义是「手里这份底板过期了」——
   * 那才是必须重设的时候。
   */
  const syncedVersionRef = useRef<number | null>(null);

  /** 服务端那份目录的解析结果（解析不了就不能发布：拿一份没读懂的东西去覆盖更坏）。 */
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

  // 版本变了（首次读到 / 别人发布了 / 自己刚发布完取回来）才把表单对齐到服务端那份
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

  /**
   * 待发布的文档：**白名单重建**一份只有站点级字段的目录（文件头那条纪律）。
   *
   * <p>底板不是 `loaded.doc` —— 目录里那些本页不编辑的历史字段（`models` 等）不会跟着走，
   * 发布出去的文档只由本页这两个值决定。重建口径在 `siteCatalogDocument` 里。
   */
  const draft = useMemo(() => {
    if (loaded.kind !== 'ok' || rateError !== null || floorError !== null) return null;
    return siteCatalogDocument(Number(rateText.trim()), {
      stackMode,
      floorFactorBp: Number(floorText.trim()),
    });
  }, [loaded, rateError, floorError, rateText, stackMode, floorText]);

  /**
   * 比「有没有改动」用的基线：**同一口径重建出来的**那份生效文档。
   *
   * <p>⚠️ 不能拿 `loaded.doc` 原文当基线：原文里可能还留着上一版目录的 `models` 段（或别的
   * 本页不认识的键），而发布出去的文档里一定没有 —— 拿原文比，一次「打开看一眼、点保存」会
   * 永远显示成「改过了」，按钮永远亮着，每点一次就白占一个版本。
   */
  const baseline = useMemo(
    () =>
      loaded.kind === 'ok'
        ? siteCatalogDocument(readCreditsPerYuan(loaded.doc), readDiscountPolicy(loaded.doc))
        : null,
    [loaded],
  );

  // 没改动就不给发：目录是版本化的冻结物，点一次「保存」多一个内容相同的版本，
  // 历史里就再也看不出「这版是谁、为什么改的」（isCatalogDirty 比的是解析后的对象，见其注释）
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
      // 发布即新版本：让共用这个 key 的地方（模型列表定价 tab 的换算率、两张折扣页的
      // 只读提示）一起刷新，否则它们还在按旧换算率解释单价。等它取完再收 saving，
      // 免得中间那一瞬「按钮还写着 v12 → v13，旁边却已经标着已发布 v13」。
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

  // 四种状态各有一句人话的处置，只有「读到了」才往下渲染表单。
  // ⚠️ 分支写全（含 pending）而不是靠「剩下的就是 ok」：漏一个分支，未生效的目录会被
  // 当成可编辑的目录渲染出来，而那是「拿一份空目录覆盖生效版本」的起点。
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
      // 「现在是什么」：生效版本号与当前折扣底线 —— 这个分支里多处文案要用它们。
      const version = loaded.version;
      const floorBp = Number(floorText.trim());
      // 算例照计价侧的口径取一次 max（`CompositeDiscountResolver` 最后一步）：
      // 算例与真实结果不一致的提示比没有提示更坏。
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
