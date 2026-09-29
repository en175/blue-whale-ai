/* ============================================
 * 「基础」tab：身份字段（只读）+ 类型 / 复制自 / model_id / 展示名 / 图标 / 启用。
 *
 * 从 `ModelFormModal.tsx` 拆出来（那个文件已顶到 `max-lines` 上限）：内容按现有区块归位，
 * **没有新增字段**——原先那些条件渲染原样保留。
 *
 * ⚠️ 这里的信息分两类，形态也不同（全管理端同一条规矩，见 `ui/Hint`）：
 *   · 「现在是什么」（这一行的身份、当前值）→ 可见的 `Alert`，藏起来等于把状态藏起来；
 *   · 「这是什么 / 为什么」→ 标签旁的 `?`（`Hint`），悬停才展开。
 * ============================================ */
import type { AdminModel } from '@/api/adminModels';
import { Checkbox, Field, Hint, Input, MetaRow, Select } from '../../ui';
import { FULL, GRID2, GRID3, LABEL } from './formLayout';
import {
  TYPE_TABS,
  channelsForMedia,
  typeName,
  type ChannelId,
  type ModelType,
} from './model-form';

interface BasicsTabProps {
  /** 编辑态传库中那一行；新建态不传 */
  initial?: AdminModel;
  type: ModelType;
  onType: (type: ModelType) => void;
  copyFrom: string;
  onCopy: (id: string) => void;
  copyOptions: AdminModel[];
  modelId: string;
  onModelId: (value: string) => void;
  label: string;
  onLabel: (value: string) => void;
  icon: string;
  onIcon: (value: string) => void;
  enabled: boolean;
  onEnabled: (value: boolean) => void;
  /** 渠道（`generation_model_capability.channel`）：**身份级配置**，与「类型」并列。
   *  它决定请求怎么解析、出站用哪种线协议 —— 具体哪种映射表长什么样，在「尺寸与素材」里配。 */
  channel: ChannelId;
  setChannel: (channel: ChannelId) => void;
}

export default function BasicsTab({
  initial,
  type,
  onType,
  copyFrom,
  onCopy,
  copyOptions,
  modelId,
  onModelId,
  label,
  onLabel,
  icon,
  onIcon,
  enabled,
  onEnabled,
  channel,
  setChannel,
}: BasicsTabProps) {
  return (
    <>
      {/* IKHBDO：类型与供应商是身份字段（后端不接受更新），编辑态只读展示——
          原先编辑态整块不渲染，运营看不到这一行属于哪个供应商。
          用 MetaRow 而不是蓝色色块：色块是装饰，这里要表达的是「这一行是什么」。 */}
      {initial && (
        <MetaRow
          items={[
            { label: '模型 ID（不可改）', value: initial.model_id },
            { label: '类型（不可改）', value: typeName(type) },
            { label: '供应商（不可改）', value: initial.provider_id },
          ]}
        />
      )}

      {/* 类型 / 渠道 / 复制自：**身份级的决策**。编辑态「类型」是只读的（上面那块 Alert），
          但渠道仍要能改（换出站协议 = 换渠道）。 */}
      <div style={GRID3}>
        {!initial && (
          <div>
            <div style={LABEL}>
              类型{' '}
              <Hint>供应商由系统写死为 new-api，无需填写。文本类型不展示尺寸 / 比例 / 时长。</Hint>
            </div>
            <Select
              aria-label="类型"
              options={TYPE_TABS.map((t) => ({ value: t.key, label: t.label }))}
              value={type}
              onChange={(next) => onType(next as ModelType)}
            />
          </div>
        )}
        <div>
          <div style={LABEL}>
            渠道{' '}
            <Hint>
              这个模型走哪家 —— 决定请求字段怎么解析、出站用哪种线协议。
              换出站协议就是<b>换一个渠道</b>（如 GPT 的「内联」与「官方 openai images」是两条），
              不给你自由组合：那样能配出必然被上游拒掉的组合。
              「尺寸与素材」里显示哪张映射表由它决定，表本身在那边填。
            </Hint>
          </div>
          <Select
            aria-label="渠道"
            options={channelsForMedia(type).map((item) => ({ value: item.id, label: item.label }))}
            value={channel}
            onChange={(next) => setChannel(next as ChannelId)}
          />
        </div>
        {!initial && (
          <div>
            <div style={LABEL}>
              复制自某模型 <span>（选填）</span>
            </div>
            <Select
              aria-label="复制自某模型"
              options={[
                { value: '', label: '空白新建' },
                ...copyOptions.map((m) => ({ value: m.id, label: `${m.model_label}（${m.model_id}）` })),
              ]}
              value={copyFrom}
              onChange={onCopy}
            />
          </div>
        )}
      </div>

      <div style={GRID2}>
        <Field label="模型 ID model_id">
          <Input
            placeholder="如 seed-audio-1.0"
            value={modelId}
            disabled={!!initial}
            onChange={(e) => onModelId(e.target.value)}
            style={FULL}
          />
        </Field>
        <Field label="展示名 model_label">
          <Input
            placeholder="如 豆包 Seed Audio 1.0"
            value={label}
            onChange={(e) => onLabel(e.target.value)}
            style={FULL}
          />
        </Field>
      </div>

      {/* 图标与启用**在同一行**：两个都是「单个短控件」，各自占一列才与上面的两列对齐 ——
          单独一行全宽就是前几轮被点名的「一会长一会短」。 */}
      <div style={GRID2}>
        <Field label={<>图标 icon <span>（选填）</span></>}>
          <Input placeholder="URL 或图标名" value={icon} onChange={(e) => onIcon(e.target.value)} style={FULL} />
        </Field>
        <Field label="启用">
          <div style={{ paddingTop: 'var(--admin-space-2)' }}>
            <Checkbox checked={enabled} onChange={onEnabled} label="在 dock 展示" />
          </div>
        </Field>
      </div>
    </>
  );
}
