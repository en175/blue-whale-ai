/* ============================================
 * 新建 / 编辑固定积分卡档位弹窗（PRD §10.2 / §10.4 / §10.5）。
 *
 * ⚠️ 这里**没有**「支付价格」与「基础积分」两个输入框，它们是只读的派生量：
 *   `实付 = 原价 × 折扣`、`积分 = 原价 × 当前换算率`。
 *   收下它们等于允许「原价 100、积分写 999999」这种自相矛盾的档位存进库。
 *   换算率不写死在前端：它是运行时配置（住在 billing 的定价目录里），由列表接口带回。
 * ============================================ */
import { useState } from 'react';
import { toast } from 'sonner';
import type { TopupTierPermission, TopupTierStatus } from '@/api/admin';
import { isApiError } from '@/api/http';
import {
  Button,
  Checkbox,
  Field,
  Input,
  Modal,
  Select,
  TagInput,
  Textarea,
  formGrid,
} from '../../ui';
import {
  DEFAULT_BUTTON_TEXT,
  DEFAULT_CREDITS_VALID_MONTHS,
  MAX_CREDITS_VALID_MONTHS,
  MIN_CREDITS_VALID_MONTHS,
  TIER_TEXT_LIMITS,
  tierCardFormError,
  tierFormError,
} from './tierForm';
import { fmtMoney, fmtPoints, type Plan, type PlanFormValues } from './plan';

interface PlanFormModalProps {
  initial?: Plan;
  /** 当前生效的换算率（1 元 = 多少积分），由列表接口带回。积分预览用它算。 */
  creditsPerYuan: number;
  onClose: () => void;
  onSubmit: (data: PlanFormValues, id?: string) => Promise<void>;
}

export default function PlanFormModal({
  initial,
  creditsPerYuan,
  onClose,
  onSubmit,
}: PlanFormModalProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [price, setPrice] = useState(initial ? String(initial.price) : '10');
  const [ratio, setRatio] = useState(initial ? String(initial.ratio) : '1');
  const [start, setStart] = useState(initial?.start ?? '');
  const [end, setEnd] = useState(initial?.end ?? '');
  const [recommended, setRecommended] = useState(initial?.recommended ?? false);
  // ⚠️ 新建落在**草稿**（PRD §10.5「新建卡片默认草稿，不展示给用户」），
  // 与服务端默认值同口径：这里若默认「上架」，运营一点保存就把没配齐的卡片卖给用户了
  const [status, setStatus] = useState<TopupTierStatus>(initial?.status ?? 'draft');
  // ── PRD §10.2 卡片字段 ──
  const [description, setDescription] = useState(initial?.description ?? '');
  const [bonusCredits, setBonusCredits] = useState(initial ? String(initial.bonusCredits) : '0');
  const [activityTag, setActivityTag] = useState(initial?.activityTag ?? '');
  const [buttonText, setButtonText] = useState(initial?.buttonText ?? DEFAULT_BUTTON_TEXT);
  const [firstPurchase, setFirstPurchase] = useState(initial?.firstPurchaseEligible ?? false);
  const [validMonths, setValidMonths] = useState(
    initial ? String(initial.creditsValidMonths) : String(DEFAULT_CREDITS_VALID_MONTHS)
  );
  const [permission, setPermission] = useState<TopupTierPermission>(initial?.permission ?? 'all');
  const [allowlist, setAllowlist] = useState<string[]>(initial?.allowlist ?? []);
  const [deniedHint, setDeniedHint] = useState(initial?.deniedHint ?? '');
  const [saving, setSaving] = useState(false);

  const priceNum = parseFloat(price) || 0;
  const ratioNum = parseFloat(ratio) || 0;
  // 到账积分 = 原价 × **当前生效的换算率**（与后端 deriveCredits 同一条公式、同一个数）。
  // ⚠️ 这里以前写死 `× 500000 / 50000`（= ×10），而列表里的 amount 走服务端按真实换算率派生 ——
  //    换算是运行时配置，两边一旦不同就是同页两个数（2026-09-26 实测：本地库是 15）。
  const points = Math.round(priceNum * creditsPerYuan);
  const pay = priceNum * ratioNum;
  // 空数字格先标成 NaN 交给校验去判：`Number('')` 是 0，会悄悄通过「非负整数」这一关
  const bonusNum = bonusCredits.trim() === '' ? NaN : Number(bonusCredits);
  const monthsNum = validMonths.trim() === '' ? NaN : Number(validMonths);
  // 赠送积分留空就是 0（不赠送），不是「非法」——唯一一个空值有自然含义的数字格
  const normalizedBonus = Number.isNaN(bonusNum) ? 0 : bonusNum;

  const handleSave = async () => {
    if (saving) return;
    const err = tierFormError(priceNum, ratioNum);
    if (err) {
      toast.error(err);
      return;
    }
    const cardErr = tierCardFormError({
      description: description.trim(),
      bonusCredits: normalizedBonus,
      activityTag: activityTag.trim(),
      buttonText: buttonText.trim(),
      firstPurchaseEligible: firstPurchase,
      creditsValidMonths: monthsNum,
      permissionAllowlist: allowlist,
      permissionDeniedHint: deniedHint.trim(),
    });
    if (cardErr) {
      toast.error(cardErr);
      return;
    }
    setSaving(true);
    try {
      await onSubmit(
        {
          name: name.trim(),
          price: priceNum,
          ratio: ratioNum,
          recommended,
          status,
          start,
          end,
          description: description.trim(),
          bonusCredits: normalizedBonus,
          activityTag: activityTag.trim(),
          buttonText: buttonText.trim(),
          firstPurchaseEligible: firstPurchase,
          creditsValidMonths: monthsNum,
          permission,
          allowlist,
          deniedHint: deniedHint.trim(),
        },
        initial?.id
      );
    } catch (e) {
      if (!isApiError(e)) toast.error('保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title={initial ? '编辑档位' : '新建档位'}
      width={760}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </>
      }
    >
      {/* 字段统一走套件的 Field（标签 + 控件 + 微文案 + 段落说明），页面不再手写间距 */}
      <div style={formGrid(2)}>
        <Field label="档位名称（选填）">
          <Input
            value={name}
            placeholder="选填"
            aria-label="档位名称"
            onChange={(e) => setName(e.target.value)}
            style={{ width: '100%' }}
          />
        </Field>
        <Field label="原价（元）">
          <Input
            value={price}
            aria-label="原价（元）"
            onChange={(e) => setPrice(e.target.value)}
            style={{ width: '100%' }}
          />
        </Field>
        <Field
          label="积分数 (派生)"
          hint={`积分 = 原价 × 当前换算率（1 元 = ${creditsPerYuan} 积分）`}
          info={
            <div>
              <div>换算率在「系统设置 → 计费」里改，不在这张表上。</div>
              <div>实付 = 原价 × 折扣；折扣 = 1 表示无折扣。</div>
              <div>
                两者都是算出来的，所以这里只读——手填会出现「原价 100、积分 999999」这种自相矛盾的档位。
              </div>
            </div>
          }
        >
          {/* 派生值只读展示：用 readOnly Input 而不是自绘灰框，样式仍由套件定义 */}
          <Input
            readOnly
            value={fmtPoints(points)}
            aria-label="积分数"
            style={{ width: '100%' }}
          />
        </Field>
        <Field label="折扣比例 (0–1]">
          <Input
            value={ratio}
            aria-label="折扣比例"
            onChange={(e) => setRatio(e.target.value)}
            style={{ width: '100%' }}
          />
        </Field>
        <Field label="实付价格 (派生)">
          <Input
            readOnly
            value={`¥${fmtMoney(pay)}`}
            aria-label="实付价格"
            style={{ width: '100%' }}
          />
        </Field>
        <Field
          label="上架状态"
          hint="新建默认草稿，用户侧不展示"
          info={
            <div>
              <div>
                草稿不进用户侧（列表与购买都只认「上架」），把价格、积分、标签配齐再上架。
              </div>
              <div>下架后不再允许新购，已支付订单按订单快照继续到账。</div>
            </div>
          }
        >
          <Select
            options={[
              { value: 'draft', label: '草稿（不展示给用户）' },
              { value: 'active', label: '上架' },
              { value: 'inactive', label: '下架' },
            ]}
            value={status}
            onChange={(v) => setStatus(v as TopupTierStatus)}
            aria-label="上架状态"
          />
        </Field>
      </div>

      {/* ── 卡片展示（PRD §6.2 用户侧看到的就是这几项）── */}
      <div style={formGrid(1)}>
        <Field label="卡片说明（选填）" hint={`最长 ${TIER_TEXT_LIMITS.description} 字`}>
          <Textarea
            rows={2}
            value={description}
            aria-label="卡片说明"
            onChange={(e) => setDescription(e.target.value)}
            style={{ width: '100%' }}
          />
        </Field>
      </div>
      <div style={formGrid(2)}>
        <Field
          label="活动标签（选填）"
          hint="如「首购加赠 50%」；已首购用户在用户侧不展示"
        >
          <Input
            value={activityTag}
            placeholder="如 首购加赠 50%"
            aria-label="活动标签"
            onChange={(e) => setActivityTag(e.target.value)}
            style={{ width: '100%' }}
          />
        </Field>
        <Field label="按钮文案" hint="PRD 默认「立享加赠」">
          <Input
            value={buttonText}
            aria-label="按钮文案"
            onChange={(e) => setButtonText(e.target.value)}
            style={{ width: '100%' }}
          />
        </Field>
      </div>

      {/* ── 首购与有效期（PRD §10.2）── */}
      <div style={formGrid(2)}>
        <Field
          label="赠送积分"
          hint="首购加赠的额度，0 = 不赠送"
          info={
            <div>
              <div>只在「参与首购」为是、且用户还没首购过时才发放。</div>
              <div>用户侧展示的总积分 = 基础积分 + 赠送积分；已首购用户只看基础积分。</div>
            </div>
          }
        >
          <Input
            value={bonusCredits}
            aria-label="赠送积分"
            onChange={(e) => setBonusCredits(e.target.value)}
            style={{ width: '100%' }}
          />
        </Field>
        <Field
          label="积分有效期（月）"
          hint={`${MIN_CREDITS_VALID_MONTHS}–${MAX_CREDITS_VALID_MONTHS}，默认 ${DEFAULT_CREDITS_VALID_MONTHS} = 2 年`}
        >
          {/* 口径是**月**不是年：年表达不了 6/18 个月这类档位，而月向上兼容 */}
          <Input
            value={validMonths}
            aria-label="积分有效期（月）"
            onChange={(e) => setValidMonths(e.target.value)}
            style={{ width: '100%' }}
          />
        </Field>
      </div>
      <div style={{ marginBottom: 16 }}>
        <Checkbox checked={firstPurchase} onChange={setFirstPurchase} label="参与首购加赠" />
      </div>

      {/* ── 购买权限（PRD §10.4）── */}
      <div style={formGrid(2)}>
        <Field
          label="购买权限"
          info={
            <div>
              <div>
                「指定会员等级」为阶段 2 预留，本阶段不生效——选了不会拦人，也不会放行。
              </div>
              <div>权限改动只影响后续购买判断，不影响已支付订单。</div>
            </div>
          }
        >
          <Select
            options={[
              { value: 'all', label: '全部登录用户' },
              { value: 'user_group', label: '指定用户群（白名单）' },
              { value: 'member_tier', label: '指定会员等级（阶段 2）' },
            ]}
            value={permission}
            onChange={(v) => setPermission(v as TopupTierPermission)}
            aria-label="购买权限"
          />
        </Field>
        <Field label="无权限提示（选填）" hint="用户无权限时展示；留空用默认文案">
          <Input
            value={deniedHint}
            placeholder="如 该档位暂不对外开放"
            aria-label="无权限提示"
            onChange={(e) => setDeniedHint(e.target.value)}
            style={{ width: '100%' }}
          />
        </Field>
      </div>
      {permission !== 'all' && (
        <div style={formGrid(1)}>
          <Field
            label="权限白名单（userId）"
            hint="逐个添加用户 ID，回车或点「添加」"
            info={
              <div>
                <div>白名单里的用户可买，名单外的按上面的权限处理。</div>
                <div>
                  元素按十进制字符串存：userId 是 BigInt，转成数字会丢精度，错一位就是放进来一个陌生人。
                </div>
              </div>
            }
          >
            <TagInput
              values={allowlist}
              onChange={setAllowlist}
              placeholder="userId，如 9001"
              ariaLabel="添加白名单用户"
              maxLength={19}
            />
          </Field>
        </div>
      )}

      {/* ── 时间窗（限时上下架）── */}
      <div style={formGrid(2)}>
        <Field
          label="生效时间（选填）"
          hint="留空 = 永久有效"
          info="设限时范围后，到生效时间自动上架、到失效时间自动下架。"
        >
          <Input
            type="datetime-local"
            value={start}
            aria-label="生效时间"
            onChange={(e) => setStart(e.target.value)}
            style={{ width: '100%' }}
          />
        </Field>
        <Field label="失效时间（选填）" hint="留空 = 永久有效">
          <Input
            type="datetime-local"
            value={end}
            aria-label="失效时间"
            onChange={(e) => setEnd(e.target.value)}
            style={{ width: '100%' }}
          />
        </Field>
      </div>

      {/* 推荐档位：原来的自绘开关在套件里没有对应基元，改用勾选框（语义相同：一个布尔量） */}
      <div style={{ marginTop: 16 }}>
        <Checkbox checked={recommended} onChange={setRecommended} label="推荐档位" />
      </div>
    </Modal>
  );
}
