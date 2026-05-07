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
 *  7. Emails every signed-up player their tee time and playing partners via Resend
 *
 * Secrets required (set via Supabase Dashboard → Edge Functions → friday-draw → Secrets,
 *   or with: supabase secrets set RESEND_API_KEY=re_xxx FROM_EMAIL="Royal Golf <you@domain.com>"):
 *   RESEND_API_KEY     — Resend API key
 *   FROM_EMAIL         — Verified sender address, e.g. "Royal Golf League <league@royalgolfclub.dk>"
 *
 * SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically by the runtime.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── Config ───────────────────────────────────────────────────────────────────

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY            = Deno.env.get('RESEND_API_KEY')!;
const FROM_EMAIL                = Deno.env.get('FROM_EMAIL') ?? 'Royal Golf League <noreply@royalgolfclub.dk>';

/** Default tee times used when none have been pre-configured in saturday_events */
const DEFAULT_TEE_TIMES = ['08:30', '08:40', '08:50'];

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Returns the date of next Saturday as YYYY-MM-DD (UTC) */
function getNextSaturday(): string {
  const d = new Date();
  const day = d.getUTCDay(); // 0=Sun … 6=Sat
  // daysUntil: if today IS Saturday (day=6) we want the NEXT one (+7), not today (+0)
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

    /**
     * Distribute evenly by cycling through group numbers.
     * e.g. 7 players, 2 groups → group 1 gets 4, group 2 gets 3
     */
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

    // 7. Load player details for email ────────────────────────────────────

    const playerIds = [...new Set(signups.map((s: { player_id: string }) => s.player_id))];

    const { data: players, error: playersErr } = await supabase
      .from('players')
      .select('id, name, email, handicap_index')
      .in('id', playerIds);

    if (playersErr) throw new Error(`players query: ${playersErr.message}`);

    const playerMap = new Map(
      (players ?? []).map((p: { id: string; name: string; email: string | null; handicap_index: number | null }) =>
        [p.id, p],
      ),
    );

    // Build group → player-name list map for email content
    const groupNames: Record<number, string[]> = {};
    for (const a of assignments) {
      const p = playerMap.get(a.playerId);
      const name = p?.name ?? 'Unknown';
      (groupNames[a.groupNum] ??= []).push(name);
    }

    // 8. Send emails via Resend ────────────────────────────────────────────

    const emailResults: string[] = [];

    for (const a of assignments) {
      const player = playerMap.get(a.playerId);
      if (!player?.email) {
        console.warn(`[friday-draw] No email for player ${a.playerId} — skipping`);
        continue;
      }

      const firstName = player.name.split(' ')[0];
      const partners  = (groupNames[a.groupNum] ?? []).filter(n => n !== player.name);
      const partnersHtml = partners.length > 0
        ? partners.map(n => `<strong>${n}</strong>`).join(', ')
        : '<em>No other players in your group yet</em>';

      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; color: #222; background: #f5f5f5; margin: 0; padding: 0; }
    .wrap { max-width: 520px; margin: 32px auto; background: #fff; border-radius: 10px;
            padding: 32px; box-shadow: 0 2px 12px rgba(0,0,0,.08); }
    h2 { color: #2a6535; margin-top: 0; }
    table { border-collapse: collapse; margin: 20px 0; width: 100%; }
    td { padding: 10px 14px; border: 1px solid #e0e0e0; }
    td:first-child { font-weight: bold; color: #555; width: 42%; }
    .footer { color: #aaa; font-size: 0.8rem; margin-top: 28px; border-top: 1px solid #eee;
              padding-top: 14px; }
  </style>
</head>
<body>
  <div class="wrap">
    <h2>⛳ Saturday Draw Confirmed</h2>
    <p>Hi ${firstName},</p>
    <p>Your tee time for <strong>Saturday ${nextSat}</strong> has been set!</p>
    <table>
      <tr><td>Tee time</td><td><strong style="font-size:1.1rem">${a.teeTime}</strong></td></tr>
      <tr><td>Group</td><td>${a.groupNum}</td></tr>
      <tr><td>Playing with</td><td>${partnersHtml}</td></tr>
    </table>
    <p>Open the app to see the full tee sheet. See you on the course! 🏆</p>
    <div class="footer">Royal Golf Club Saturday League</div>
  </div>
</body>
</html>`;

      const res = await fetch('https://api.resend.com/emails', {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          from:    FROM_EMAIL,
          to:      [player.email],
          subject: `⛳ Saturday Draw — Your tee time is ${a.teeTime}`,
          html,
        }),
      });

      const status = `${player.name}: HTTP ${res.status}`;
      console.log(`[friday-draw] Email sent — ${status}`);
      emailResults.push(status);
    }

    return json({
      message:  'Draw completed and emails sent',
      date:     nextSat,
      players:  signups.length,
      groups:   groupNames,
      emails:   emailResults,
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
