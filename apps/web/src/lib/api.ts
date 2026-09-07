const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1';

export type ApiResponse<T> = { data: T };
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = sessionStorage.getItem('ar-token');
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message ?? 'No se pudo completar la operación.');
  return body as T;
}

export const formatMoney = (value: number | string | undefined) => new Intl.NumberFormat('es-HN', { style: 'currency', currency: 'HNL', maximumFractionDigits: 2 }).format(Number(value ?? 0));
