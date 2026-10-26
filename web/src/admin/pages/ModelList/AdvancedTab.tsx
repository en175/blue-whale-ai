import { Textarea } from '../../ui';
import { Hint } from '../../ui';

interface AdvancedTabProps {
  extraFeatures: string;
  setExtraFeatures: (value: string) => void;
}

export default function AdvancedTab({ extraFeatures, setExtraFeatures }: AdvancedTabProps) {
  return (
    <>
      <details style={{ marginBottom: 18 }}>
        <summary>
          高级 JSON（未识别字段 / 映射兜底）{' '}
          <Hint>
            这里<b>只</b>放未识别字段与映射兜底：结构化控件没覆盖的键、或形态对不上的历史脏值。
            常规配置都在其它 tab —— 尺寸 / 比例 / 出站尺寸映射（含渠道）在「尺寸与素材」，
            定价在「定价」，别来这里改那些。
          </Hint>
        </summary>
        <Textarea value={extraFeatures} onChange={(e) => setExtraFeatures(e.target.value)} style={{ marginTop: 'var(--admin-space-2)' }} />
      </details>
    </>
  );
}
