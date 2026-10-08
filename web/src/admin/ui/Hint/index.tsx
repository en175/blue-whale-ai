import type { ReactNode } from 'react';
import Tooltip from '../Tooltip';

export default function Hint({
  children,
  title,
  label = '说明',
}: {
  children: ReactNode;
  title?: ReactNode;
  label?: string;
}) {
  return <Tooltip title={title} content={children} label={label} />;
}
