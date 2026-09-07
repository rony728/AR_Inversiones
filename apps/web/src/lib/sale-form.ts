import { normalizeSearch, type ProductRow } from './product-catalog';
import type { PurchaseLine } from './purchase-form';

export type SaleLine = PurchaseLine;
export type SaleAmounts = { subtotal: number; cost: number; profit: number };
export type SaleIssue = { code: 'INVALID_QUANTITY' | 'DUPLICATE_PRODUCT' | 'INSUFFICIENT_STOCK' | 'BELOW_COST'; message: string };

const toCents = (value: number) => Math.round(value * 100);
const fromCents = (value: number) => value / 100;

export function saleLineEstimate(line: SaleLine, product?: ProductRow): SaleAmounts {
  if (!product) return { subtotal: 0, cost: 0, profit: 0 };
  const subtotalCents = line.cantidad * toCents(line.valor);
  const costCents = line.cantidad * toCents(Number(product.costo_promedio));
  return { subtotal: fromCents(subtotalCents), cost: fromCents(costCents), profit: fromCents(subtotalCents - costCents) };
}

export function saleTotals(lines: SaleLine[], products: ProductRow[]): SaleAmounts {
  return lines.reduce((totals, line) => {
    const amounts = saleLineEstimate(line, products.find((product) => product.id === line.productoId));
    return { subtotal: totals.subtotal + amounts.subtotal, cost: totals.cost + amounts.cost, profit: totals.profit + amounts.profit };
  }, { subtotal: 0, cost: 0, profit: 0 });
}

export function requestedQuantities(lines: SaleLine[]) {
  const requested = new Map<string, number>();
  for (const line of lines) if (line.productoId) requested.set(line.productoId, (requested.get(line.productoId) ?? 0) + line.cantidad);
  return requested;
}

export function validateSaleLines(lines: SaleLine[], products: ProductRow[]): SaleIssue | null {
  const selected = lines.filter((line) => line.productoId);
  const invalidQuantity = selected.find((line) => !Number.isInteger(line.cantidad) || line.cantidad <= 0);
  if (invalidQuantity) return { code: 'INVALID_QUANTITY', message: 'La cantidad de cada producto debe ser un número entero mayor que cero.' };

  for (const [productId, quantity] of requestedQuantities(selected)) {
    const product = products.find((candidate) => candidate.id === productId);
    if (product && quantity > Number(product.cantidad_disponible)) return { code: 'INSUFFICIENT_STOCK', message: `La cantidad solicitada de ${product.nombre} supera las ${product.cantidad_disponible} unidades disponibles.` };
  }

  if (new Set(selected.map((line) => line.productoId)).size !== selected.length) return { code: 'DUPLICATE_PRODUCT', message: 'Cada producto puede aparecer una sola vez dentro de la venta.' };

  for (const line of selected) {
    const product = products.find((candidate) => candidate.id === line.productoId);
    if (product && toCents(line.valor) < toCents(Number(product.costo_promedio))) return { code: 'BELOW_COST', message: `El precio de ${product.nombre} no puede ser menor que su costo promedio.` };
  }
  return null;
}

export function filterActiveClients(clients: Array<Record<string, unknown>>, search: string) {
  const term = normalizeSearch(search.trim());
  return clients.filter((client) => client.activo !== false && (!term || normalizeSearch(client.nombre).includes(term)));
}
