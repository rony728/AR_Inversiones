import type { ReactNode } from 'react';
import { formatMoney } from '../lib/api';
export function MetricCard({ label, value, icon, accent = 'blue' }: { label: string; value: number | string; icon: ReactNode; accent?: string }) {
  return <article className={`metric ${accent}`}><div><span>{label}</span><strong>{formatMoney(value)}</strong></div><i>{icon}</i></article>;
}
