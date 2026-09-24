/* 管理端 UI 基元统一出口。
 * 页面一律从这里 import：`import { Button, Card } from '@/admin/ui';`
 * 直接指到组件目录也行，但走桶能让「管理端有哪些基元」一眼可见，
 * 也避免各页面把相对路径写歪。 */
export { default as Badge, type BadgeTone } from './Badge';
export { default as Button, type ButtonSize, type ButtonVariant } from './Button';
export { default as Card } from './Card';
export { default as Empty } from './Empty';
export { default as PageHeader } from './PageHeader';
export { default as Table } from './Table';
