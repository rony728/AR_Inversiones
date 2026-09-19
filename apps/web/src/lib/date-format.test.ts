import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime } from './date-format';
describe('formato global de fechas', () => {
  it('muestra DD/MM/YYYY sin desplazar fechas puras por zona horaria', () => { expect(formatDate('2026-09-19')).toBe('19/09/2026'); expect(formatDate('2026-09-19T00:00:00.000Z')).toBe('19/09/2026'); });
  it('conserva hora cuando se solicita fecha y hora', () => expect(formatDateTime('2026-10-05T14:30:00.000Z')).toBe('05/10/2026 14:30'));
});
