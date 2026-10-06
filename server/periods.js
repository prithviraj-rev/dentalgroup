// Month-string helpers and bucketing for month | quarter | year granularity.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const isMonth = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s || ''));

export function addMonths(ym, n) {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7)) - 1 + n;
  const d = new Date(Date.UTC(y, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthsBetween(from, to) {
  const out = [];
  for (let p = from; p <= to; p = addMonths(p, 1)) out.push(p);
  return out;
}

export function bucketKey(ym, granularity) {
  if (granularity === 'quarter') return `${ym.slice(0, 4)}-Q${Math.ceil(Number(ym.slice(5, 7)) / 3)}`;
  if (granularity === 'year') return ym.slice(0, 4);
  return ym;
}

export function bucketLabel(key, granularity) {
  if (granularity === 'quarter') return `${key.slice(5)} ${key.slice(0, 4)}`;
  if (granularity === 'year') return key;
  return `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
}

/** Ordered list of buckets covering [from, to], each with its month count. */
export function bucketsFor(from, to, granularity) {
  const map = new Map();
  for (const ym of monthsBetween(from, to)) {
    const key = bucketKey(ym, granularity);
    if (!map.has(key)) map.set(key, { key, label: bucketLabel(key, granularity), months: [] });
    map.get(key).months.push(ym);
  }
  return [...map.values()];
}
