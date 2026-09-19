const DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;

export function formatDate(value: unknown, fallback = '—') {
  if (!value) return fallback;
  const match = DATE_PREFIX.exec(String(value));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : fallback;
}

export function formatDateTime(value: unknown, fallback = '—') {
  if (!value) return fallback;
  const date = formatDate(value, fallback);
  const time = /T(\d{2}):(\d{2})/.exec(String(value));
  return time ? `${date} ${time[1]}:${time[2]}` : date;
}
