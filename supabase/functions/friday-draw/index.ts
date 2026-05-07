/**
 * friday-draw — Supabase Edge Function
 *
 * Runs every Friday at 10:00 UTC (12:00 Denmark summer time / CEST).
 * Cron schedule: 0 10 * * 5
 *
 * What it does:
 *  1. Finds next Saturday's date
 *  2. Loads all sign-ups for that date
 *  3. Checks the event isn't already locked (safe to re-trigger manually)
 *  4. Reads configured tee times from saturday_events (falls back to defaults)
 *  5. Shuffles players randomly and distributes across groups
 *  6. Saves assignments to saturday_signups + locks saturday_events
 *
 * No secrets required beyond the automatic SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── Config ───────────────────────────────────────────────────────────────────

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

/** Default tee times used when none have been pre-configured in saturday_events */
const DEFAULT_TEE_TIMES = ['08:30', '08:40', '08:50'];

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Returns the date of next Saturday as YYYY-MM-DD (UTC) */
function getNextSaturday(): string {
  const d = new Date();
  const day = d.getUTCDay(); // 0=Sun … 6=Sat
  // if today IS Saturday we want the NEXT one (+7), not today
  const daysUntil = day === 6 ? 7 : (6 - day + 7) % 7;
  d.setUTCDate(d.getUTCDate() + daysUntil);
  return d.toISOString().split('T')[0];
}

/** Fisher-Yates shuffle — returns a new array */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * How many groups to create:
 *  1-4  players → 1 group
 *  5-8  players → 2 groups
 *  9-12 players → 3 groups
 */
function groupCount(n: number): number {
  if (n <= 4) return 1;
  if (n <= 8) return 2;
  return 3;
}

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (_req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const nextSat  = getNextSaturday();

    console.log(`[friday-draw] Running for ${nextSat}`);

    // 1. Load sign-ups ─────────────────────────────────────────────────────

    const { data: signups, error: signupsErr } = await supabase
      .from('saturday_signups')
      .select('*')
      .eq('date', nextSat);

    if (signupsErr) throw new Error(`signups query: ${signupsErr.message}`);

    if (!signups || signups.length === 0) {
      console.log('[friday-draw] No sign-ups found — nothing to do.');
      return json({ message: 'No sign-ups for next Saturday', date: nextSat });
    }

    console.log(`[friday-draw] ${signups.length} sign-up(s) found`);

    // 2. Check if already locked ──────────────────────────────────────────

    const { data: existingEvent } = await supabase
      .from('saturday_events')
      .select('*')
      .eq('date', nextSat)
      .maybeSingle();

    if (existingEvent?.locked) {
      console.log('[friday-draw] Event already locked — skipping draw.');
      return json({ message: 'Draw already locked for this Saturday', date: nextSat });
    }

    // 3. Determine tee times ───────────────────────────────────────────────

    const configuredTimes: string[] = Array.isArray(existingEvent?.tee_times)
      ? existingEvent.tee_times
      : DEFAULT_TEE_TIMES;

    const numGroups  = groupCount(signups.length);
    const activeTimes = configuredTimes.slice(0, numGroups);

    console.log(`[friday-draw] ${numGroups} group(s), tee times: ${activeTimes.join(', ')}`);

    // 4. Shuffle & assign ─────────────────────────────────────────────────

    const shuffled = shuffle(signups);

    // Distribute evenly by cycling through group numbers.
    // e.g. 7 players, 2 groups → group 1 gets 4, group 2 gets 3
    const assignments: Array<{ signupId: number; playerId: string; teeTime: string; groupNum: number }> =
      shuffled.map((s, i) => {
        const groupNum = (i % numGroups) + 1; // 1-indexed
        return {
          signupId: s.id,
          playerId: s.player_id,
          teeTime:  activeTimes[groupNum - 1],
          groupNum,
        };
      });

    // 5. Persist assignments to saturday_signups ──────────────────────────

    for (const a of assignments) {
      const { error } = await supabase
        .from('saturday_signups')
        .update({ tee_time: a.teeTime, group_num: a.groupNum })
        .eq('id', a.signupId);
      if (error) throw new Error(`update signup ${a.signupId}: ${error.message}`);
    }

    // 6. Lock the event (upsert so it works even if no row existed yet) ───

    const { error: eventErr } = await supabase
      .from('saturday_events')
      .upsert(
        { date: nextSat, tee_times: configuredTimes, locked: true },
        { onConflict: 'date' },
      );
    if (eventErr) throw new Error(`upsert saturday_events: ${eventErr.message}`);

    console.log('[friday-draw] Draw saved and event locked');

    return json({
      message: 'Draw completed',
      date:    nextSat,
      players: signups.length,
      groups:  assignments.reduce((acc, a) => {
        (acc[a.groupNum] ??= []).push(a.playerId);
        return acc;
      }, {} as Record<number, string[]>),
    });

  } catch (err) {
    console.error('[friday-draw] ERROR:', err);
    return json({ error: String(err) }, 500);
  }
});

// ── Tiny helper ───────────────────────────────────────────────────────────────

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
