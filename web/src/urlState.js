// Dashboard state <-> URL query string, so a view can be bookmarked or shared.
//   ?office=all|<realmId>|<id>,<id>&from=YYYY-MM&to=YYYY-MM&granularity=month|quarter|year&yoy=1
//   &metric=netIncome&mainChart=combo&officeChart=lines

const KEYS = ['office', 'from', 'to', 'granularity', 'metric', 'mainChart', 'officeChart'];

export function readUrlState() {
  const q = new URLSearchParams(window.location.search);
  const out = {};
  for (const k of KEYS) if (q.get(k)) out[k] = q.get(k);
  if (q.has('yoy')) out.yoy = q.get('yoy') === '1';
  return out;
}

export function writeUrlState(state) {
  const q = new URLSearchParams();
  for (const k of KEYS) if (state[k]) q.set(k, state[k]);
  if (state.yoy) q.set('yoy', '1');
  const next = `${window.location.pathname}?${q}`;
  if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, '', next);
}
