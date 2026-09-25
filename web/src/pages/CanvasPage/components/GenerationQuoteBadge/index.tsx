/* ============================================
 * 「本次预计消耗 N 积分」—— 生成面板上的价格预览
 *
 * 价格来自我们自己的 billing（`Quote`，只算不扣），与提交时冻结的预扣（`Hold`）同源：
 * 同一份规格归一、同一个用户等级，所以预览价就是实扣价（见后端
 * `handle-quote-generation-job.ts`）。
 *
 * ⚠️ **没有报价就什么都不显示**（`credits: null` / 查询失败 / 加载中）——
 *    绝不显示 0：0 会被读成「免费」，而那是另一件事。报价失败也不弹提示：
 *    它只是「这次没价格」，与「能不能提交」无关，不该挡住任何操作。
 * ============================================ */
import { useQuery } from '@tanstack/react-query';
import { Zap } from 'lucide-react';
import {
  generationQuoteOptions,
  type GenerationJobType,
  type QuoteJobParameters,
} from '@/api/generationQuote';
import styles from './index.module.css';

interface GenerationQuoteBadgeProps {
  /** 报价挂在项目下（与创建任务的路径一致） */
  projectId: string;
  type: GenerationJobType;
  /** 定价维度（model_id + 规格）；必须与面板发送时组装的参数同源 */
  parameters: QuoteJobParameters;
}

export default function GenerationQuoteBadge(props: GenerationQuoteBadgeProps) {
  // 没有项目上下文（空串：未进项目的面板、面板单测）就**不挂载内层**：既不显示价格，
  // 也不去问价 —— 报价本来就挂在项目下，缺了项目这个请求没有意义。
  // ⚠️ 必须用「不挂载」而不是「enabled: false」：后者仍会先执行 queryOptions 工厂。
  if (!props.projectId) return null;
  return <QuoteBadge {...props} />;
}

function QuoteBadge({ projectId, type, parameters }: GenerationQuoteBadgeProps) {
  const { data } = useQuery({
    ...generationQuoteOptions(projectId, {
      type,
      parameters,
      // 画布三个生成面板都只生成一个产物（多图按张计价的场景还没进画布）；
      // 这里必须与提交时那个 expected_output_count 是同一个数，否则价就不是那个价。
      expected_output_count: 1,
    }),
    // 模型还没定下来之前不问价：它是定价的输入之一，缺了问不出有意义的结果
    enabled: parameters.model_id !== '',
  });

  const credits = data?.credits ?? null;
  if (credits === null) return null;

  return (
    <span className={styles.badge} data-testid="generation-quote">
      <Zap size={12} strokeWidth={2} />
      <span>本次预计消耗 {credits} 积分</span>
    </span>
  );
}
