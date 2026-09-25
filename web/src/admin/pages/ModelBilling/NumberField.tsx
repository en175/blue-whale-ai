/* 整数输入框 —— 管理端「只填整数」的那些栏位共用（换算率 / 折扣底线 / 价格表…）。
 *
 * 单独一个文件是因为它被两处用：页面上的目录设置卡片，与规则编辑弹窗。
 * 放在任何一边都会让另一边的 import 方向变别扭。
 */
import { useEffect, useState } from 'react';
import { Field, Input } from '../../ui';


/**
 * 整数输入：内部存**文字**，只在能解析成整数时往外抛。
 *
 * <p>为什么不能直接用 `value={String(数字)}` 的受控输入：那样用户永远清不空这个框
 * （清空 = 非法 = 立刻被写成原值弹回来），而「全选删掉再输」是最常见的改数方式。
 * 所以文字留在本组件里，外面拿到的永远是合法整数。
 *
 * @param allowNull 允许「空」这个状态（清空时往外抛 null）。用于换算率这种**必须填**的字段：
 *                  空着就是空着，交给 billing 的编译期报错说清楚，而不是在这里悄悄补一个数。
 */
export default function NumberField({
  label,
  ariaLabel,
  hint,
  value,
  onChange,
  allowNull = false,
}: {
  label: string;
  ariaLabel: string;
  hint: string;
  value: number | null;
  onChange: (value: number | null) => void;
  allowNull?: boolean;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));

  // 外部值变了（重新加载 / 换成另一份目录）才回写文字；用户自己敲的空串不会被这里弹回去
  useEffect(() => {
    setText(value === null ? '' : String(value));
  }, [value]);

  return (
    <Field label={label} hint={hint}>
      <Input
        aria-label={ariaLabel}
        value={text}
        onChange={(e) => {
          const raw = e.target.value.trim();
          setText(e.target.value);
          if (raw === '') {
            if (allowNull) onChange(null);
            return;
          }
          if (!/^\d+$/.test(raw)) return;
          onChange(Number(raw));
        }}
      />
    </Field>
  );
}
