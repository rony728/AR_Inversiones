import type { ProductRow } from './product-catalog';

export type PurchaseLine = { productoId: string; cantidad: number; valor: number };
export type ProductsFund = { id: string; balance: number };

export function duplicateProductId(lines: PurchaseLine[]) {
  const selected = new Set<string>();
  for (const line of lines) {
    if (!line.productoId) continue;
    if (selected.has(line.productoId)) return line.productoId;
    selected.add(line.productoId);
  }
  return null;
}

export function productsFundOf(partner: Record<string, unknown> | undefined): ProductsFund | null {
  const funds = (partner?.custodias as Array<Record<string, unknown>> | undefined) ?? [];
  const fund = funds.find((candidate) => candidate.actividad === 'PRODUCTOS');
  if (!fund || typeof fund.id !== 'string') return null;
  const balance = Number(fund.saldo_actual);
  return Number.isFinite(balance) ? { id: fund.id, balance } : null;
}

export function exceedsKnownBalance(balance: number | null, total: number) {
  return balance !== null && Math.round(total * 100) > Math.round(balance * 100);
}

export function selectablePurchaseProducts(products: ProductRow[], excludedIds: string[], selectedId: string) {
  return products.filter((product) => product.activo && (!excludedIds.includes(product.id) || product.id === selectedId));
}
