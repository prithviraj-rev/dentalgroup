// Daily QuickBooks pull (app.config.json sync.schedule). Runs the same syncAll() as the Sync now button,
// once a day at a wall-clock time in a time zone, and catches up on start if the last successful sync is
// older than maxAgeHours (e.g. the server was down overnight). Regular syncs also keep QuickBooks refresh
// tokens alive (they expire after ~100 days unused).

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function validateSchedule(s) {
  if (!s || s.enabled === false) return;
  if (!HHMM.test(String(s.time || ''))) throw new Error('app.config.json: sync.schedule.time must be HH:MM (24-hour), e.g. "03:00"');
  try { new Intl.DateTimeFormat('en-US', { timeZone: s.timezone }); } catch { throw new Error(`app.config.json: sync.schedule.timezone "${s.timezone}" is not a valid IANA time zone (e.g. America/Chicago)`); }
  if (s.maxAgeHours != null && (typeof s.maxAgeHours !== 'number' || s.maxAgeHours <= 0)) throw new Error('app.config.json: sync.schedule.maxAgeHours must be a positive number');
}

/** Offset of timeZone from UTC at instant ms, in ms (positive east of UTC). */
function tzOffset(ms, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Next instant (ms) after `now` when the wall clock in timeZone reads HH:MM. DST-safe. */
export function nextRunAt(time, timeZone, now = Date.now()) {
  const [h, m] = time.split(':').map(Number);
  const local = new Date(now + tzOffset(now, timeZone)); // wall clock as if UTC
  for (let day = 0; day < 3; day++) {
    const guess = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + day, h, m);
    let at = guess - tzOffset(guess, timeZone);
    at = guess - tzOffset(at, timeZone); // second pass settles DST transitions
    if (at > now) return at;
  }
  return now + 24 * 3600_000;
}

/**
 * Start the daily job. run: async () => sync result. lastSuccess: () => ISO string | null.
 * Returns status() for the API.
 */
export function startDailySync({ schedule, run, lastSuccess, missingData = () => null, log = console }) {
  const state = { enabled: Boolean(schedule && schedule.enabled !== false), time: schedule?.time, timezone: schedule?.timezone, nextRun: null, lastRun: null, lastResult: null, running: false };
  const status = () => ({ ...state });
  if (!state.enabled) return { status, stop() {} };
  let timer = null;

  const fire = async (reason) => {
    if (state.running) return;
    state.running = true;
    state.lastRun = new Date().toISOString();
    log.log(`[schedule] ${reason}: syncing every company`);
    try {
      const r = await run();
      state.lastResult = { succeeded: r.succeeded, failed: r.failed, companies: r.companies };
      log.log(`[schedule] done: ${r.succeeded} of ${r.companies} succeeded`);
    } catch (e) {
      state.lastResult = { error: e.message };
      log.error(`[schedule] sync failed: ${e.message}`);
    } finally {
      state.running = false;
    }
  };

  const arm = () => {
    const at = nextRunAt(state.time, state.timezone);
    state.nextRun = new Date(at).toISOString();
    timer = setTimeout(async () => { await fire('daily run'); arm(); }, at - Date.now());
    timer.unref?.();
  };
  arm();
  log.log(`  Daily QuickBooks sync at ${state.time} ${state.timezone} (next ${state.nextRun})`);

  const maxAgeMs = (schedule.maxAgeHours ?? 26) * 3600_000;
  if (schedule.catchUpOnStart !== false) {
    const last = lastSuccess();
    const missing = missingData(); // e.g. companies whose raw QuickBooks records were never pulled
    if (!last || Date.now() - Date.parse(last) > maxAgeMs || missing) {
      const t = setTimeout(() => fire(missing || (last ? `last sync ${last} is older than ${maxAgeMs / 3600_000}h` : 'never synced')), 30_000);
      t.unref?.();
    }
  }
  return { status, stop() { clearTimeout(timer); } };
}
