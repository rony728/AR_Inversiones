import type { ReactNode } from 'react';
import { formatMoney } from '../lib/api';
export function MetricCard({ label, value, icon, accent = 'blue', format = 'money' }: { label: string; value: number | string; icon: ReactNode; accent?: string; format?: 'money' | 'number' }) {
  return <article className={`metric ${accent}`}><div><span>{label}</span><strong>{format === 'money' ? formatMoney(value) : new Intl.NumberFormat('es-HN').format(Number(value))}</strong></div><i>{icon}</i></article>;
}
