/* ============================================
 * 「高级」tab：**只剩**未识别字段 / 映射兜底的 JSON（逃生舱）。
 *
 * 渠道类型（请求字段映射 × 出站协议）与三张请求映射表（gpt 交叉格 / banana 一维表 / seedream
 * 像素矩阵）已搬到「尺寸与素材」tab：它们与视频那张输出像素表是同一件事（「这张能力行的出站
 * 尺寸/参数从哪来」），而**控制项（渠道类型）与被它决定的表分在两个 tab 是最难用的一种切分**——
 * 切一下渠道要跑到另一个 tab 才看得见表换了没有。
 *
 * 这一块是**改了会让出站请求形态变化**的东西（键就是发给上游的参数形态），
 * 保留一个出口：结构化控件没覆盖的键、形态对不上的历史脏值，直接写 JSON。
 * ============================================ */
import { Textarea } from '../../ui';
import { Hint } from '../../ui';

interface AdvancedTabProps {
  /** 未识别字段 / 映射兜底的 JSON 文本 */
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
