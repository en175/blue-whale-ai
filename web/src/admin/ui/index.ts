/* 管理端 UI 基元统一出口。
 * 页面一律从这里 import：`import { Button, Card, Table } from '@/admin/ui';`
 *
 * 目标是**页面不再有私有样式**：一个界面元素只有这里一处定义。
 * 看到某个页面自己写 button / table / select / chip 的样式，就是这里缺了对应组件。 */
export { default as Alert, type AlertTone } from './Alert';
export { default as Badge, type BadgeTone } from './Badge';
export { default as Bar } from './Bar';
export { default as Button, type ButtonSize, type ButtonVariant } from './Button';
export { default as Card } from './Card';
export { default as Checkbox } from './Checkbox';
export { default as Chip } from './Chip';
export { default as Empty } from './Empty';
export { default as Field } from './Field';
export { default as Input } from './Input';
export { default as Modal } from './Modal';
export { default as Page } from './Page';
export { default as PageHeader } from './PageHeader';
export { default as Pagination } from './Pagination';
export { default as Select, type SelectOption } from './Select';
export { default as Stat, type StatTone } from './Stat';
export { default as Table } from './Table';
export { default as Textarea } from './Textarea';
export { default as Tabs, type TabItem } from './Tabs';
export { default as TagInput } from './TagInput';
export { default as Toolbar } from './Toolbar';
