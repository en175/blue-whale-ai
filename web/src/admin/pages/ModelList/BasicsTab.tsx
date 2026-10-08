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
      {}
      {initial && (
        <MetaRow
          items={[
            { label: '模型 ID（不可改）', value: initial.model_id },
            { label: '类型（不可改）', value: typeName(type) },
            { label: '供应商（不可改）', value: initial.provider_id },
          ]}
        />
      )}

      {}
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

      {}
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
