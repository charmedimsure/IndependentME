/**
 * IndependentME - Cloudflare Worker
 *
 * Two apps talk to this:
 *   independentme.html  (Karelynn's tablet)  - reads config, marks tasks done, sends messages
 *   care.html           (caregiver phone)    - writes config, sees the day, replies
 *
 * Security model, stated plainly: this is a shared-secret family app, not a
 * hardened system. HOUSE is the household code both apps use. CARE is a second
 * key that only the caregiver app holds, required for anything that writes
 * config or replies. Anyone who has the codes has access. Keep them off paper
 * that leaves the house, and don't reuse them anywhere else.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS }
  });

const today = () => {
  // Server runs UTC; the apps send their own local day so the log lines up
  const d = new Date();
  return d.toISOString().slice(0, 10);
};


/* Push to one person's ntfy topic, or to everyone's. Best effort: a failed
   push must never stop a message from being recorded. */
/* HTTP headers can only carry Latin-1. An arrow or an em dash in the title
   makes setting the header throw, which silently kills the whole push, so
   everything going into a header gets flattened first. The body is UTF-8 and
   can keep its accents and emoji. */
const hdr = v => String(v == null ? '' : v)
  .replace(/[\u2012-\u2015\u2212]/g, '-')
  .replace(/[\u2018\u2019]/g, "'")
  .replace(/[\u201C\u201D]/g, '"')
  .replace(/\u2192/g, '>')
  .replace(/\u2026/g, '...')
  .replace(/[^\x20-\x7E]/g, '')
  .slice(0, 200) || 'IndependentME';

async function pushTo(topics, title, text, urgent) {
  const list = [...new Set((topics || []).filter(Boolean))];
  const results = await Promise.all(list.map(async topic => {
    try {
      const r = await fetch('https://ntfy.sh/' + encodeURIComponent(topic), {
        method: 'POST',
        headers: {
          'Title': hdr(title),
          'Tags': urgent ? 'sos' : 'speech_balloon',
          'Priority': urgent ? 'urgent' : 'high',
          'Content-Type': 'text/plain; charset=utf-8'
        },
        body: String(text == null ? '' : text)
      });
      return { topic, status: r.status };
    } catch (e) {
      return { topic, status: 0, error: String(e && e.message || e) };
    }
  }));
  return results;
}

const loadConfig = async (env, house) => {
  const row = await env.DB.prepare('SELECT config FROM household WHERE code = ?').bind(house).first();
  return row ? JSON.parse(row.config) : {};
};

/* Is this person reachable right now? A person is unavailable during their
   busy window, unless they've manually overridden it for today. */
function freeNow(person, now) {
  if (!person) return true;
  if (person.override === 'free') return true;
  if (person.override === 'busy') return false;
  const b = person.busy;
  if (!b || !b.days || !b.days.length) return true;
  if (!b.days.includes(now.getDay())) return true;
  const mins = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
  const cur = now.getHours() * 60 + now.getMinutes();
  return cur < mins(b.from) || cur >= mins(b.to);
}

const topicsFor = (cfg, name) => {
  const people = cfg.contacts || [];
  if (!name) return people.map(p => p.ntfy);
  const one = people.find(p => p.name === name || p.id === name);
  return one ? [one.ntfy] : people.map(p => p.ntfy);
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    let body = {};
    if (request.method === 'POST') {
      try { body = await request.json(); } catch (e) { return json({ error: 'Bad JSON' }, 400); }
    }

    // Health check: no household code needed, so you can confirm the worker
    // is alive just by opening the URL in a browser.
    if (path === '/') return json({ service: 'IndependentME', ok: true });

    const house = body.house || url.searchParams.get('house');
    if (!house) return json({ error: 'Missing household code' }, 400);

    // Any write from the caregiver side must carry the care key
    const careOk = async () => {
      const row = await env.DB.prepare('SELECT care FROM household WHERE code = ?').bind(house).first();
      if (!row) return true;            // first-run: whoever claims it, sets it
      return row.care === body.care;
    };

    try {
      switch (path) {

        /* ---------- tablet + caregiver both pull ---------- */
        case '/pull': {
          const day = url.searchParams.get('day') || today();
          const hh = await env.DB.prepare('SELECT config, updated FROM household WHERE code = ?')
            .bind(house).first();

          const log = await env.DB.prepare(
            'SELECT task_id, at FROM log WHERE code = ? AND day = ?'
          ).bind(house, day).all();

          // Last seven days, so a missed weekly task can carry forward
          const back = new Date(day + 'T12:00:00');
          back.setDate(back.getDate() - 7);
          const recent = await env.DB.prepare(
            'SELECT day, task_id FROM log WHERE code = ? AND day >= ? AND day <= ?'
          ).bind(house, back.toISOString().slice(0, 10), day).all();

          const msgs = await env.DB.prepare(
            'SELECT id, dir, who, body, icon, at, seen, ack, ack_at FROM messages WHERE code = ? ORDER BY id DESC LIMIT 40'
          ).bind(house).all();

          return json({
            config: hh ? JSON.parse(hh.config) : null,
            updated: hh ? hh.updated : 0,
            done: (log.results || []).map(r => ({ id: r.task_id, at: r.at })),
            recent: recent.results || [],
            messages: (msgs.results || []).reverse(),
            photos: (await env.DB.prepare(
              'SELECT id, who, at, seen FROM photos WHERE code = ? ORDER BY id DESC LIMIT 12'
            ).bind(house).all()).results || []
          });
        }

        /* ---------- tablet marks a task done / undone ---------- */
        case '/done': {
          const { taskId, day, done } = body;
          if (!taskId || !day) return json({ error: 'Missing task or day' }, 400);

          if (done) {
            await env.DB.prepare(
              'INSERT OR IGNORE INTO log (code, day, task_id, at) VALUES (?, ?, ?, ?)'
            ).bind(house, day, taskId, Date.now()).run();
          } else {
            await env.DB.prepare('DELETE FROM log WHERE code = ? AND day = ? AND task_id = ?')
              .bind(house, day, taskId).run();
          }
          return json({ ok: true });
        }

        /* ---------- tablet sends a message ---------- */
        case '/say': {
          const { who, text, icon } = body;
          if (!text) return json({ error: 'Missing message' }, 400);

          await env.DB.prepare(
            'INSERT INTO messages (code, dir, who, body, icon, at, seen) VALUES (?, ?, ?, ?, ?, ?, 0)'
          ).bind(house, 'out', who || '', text, icon || '', Date.now()).run();

          // Buzzes the person she picked. Everyone still sees it in the thread.
          const cfg = await loadConfig(env, house);
          await pushTo(topicsFor(cfg, who), (cfg.name || 'IndependentME') + ' to ' + (who || 'everyone'), text, false);
          return json({ ok: true });
        }

        /* ---------- tablet escalates: put off too often, or asked for help ---------- */
        case '/alert': {
          const { text, kind, who } = body;
          if (!text) return json({ error: 'Missing text' }, 400);
          const help = kind === 'help';
          const reward = kind === 'reward';

          await env.DB.prepare(
            'INSERT INTO messages (code, dir, who, body, icon, at, seen, escalated) VALUES (?, ?, ?, ?, ?, ?, 0, ?)'
          ).bind(house, 'alert', who || '', text, help ? '\u{1F198}' : reward ? '\u{1F381}' : '\u23F0', Date.now(), help ? 0 : 1).run();

          const cfg = await loadConfig(env, house);
          let topics;
          if (help) {
            topics = topicsFor(cfg, who);           // she chose this person
          } else if (reward || cfg.nudgeTo === 'all') {
            topics = topicsFor(cfg, null);
          } else {
            // Routine nudges go only to whoever is marked as the fallback, so
            // four phones don't buzz about teeth.
            const prim = (cfg.contacts || []).filter(p => p.fallback);
            topics = (prim.length ? prim : (cfg.contacts || [])).map(p => p.ntfy);
          }
          await pushTo(topics, cfg.name || 'IndependentME', text, help);
          return json({ ok: true });
        }

        /* ---------- a caregiver claims a help request ---------- */
        case '/ack': {
          if (!await careOk()) return json({ error: 'Wrong caregiver key' }, 403);
          const { id, me } = body;
          if (!id) return json({ error: 'Missing id' }, 400);

          await env.DB.prepare(
            'UPDATE messages SET ack = ?, ack_at = ? WHERE code = ? AND id = ? AND ack IS NULL'
          ).bind(me || 'Someone', Date.now(), house, id).run();

          const cfg = await loadConfig(env, house);
          await pushTo(topicsFor(cfg, null), cfg.name || 'IndependentME',
            (me || 'Someone') + ' has got this one', false);
          return json({ ok: true });
        }

        /* ---------- someone asks to see her ---------- */
        case '/checkin': {
          if (!await careOk()) return json({ error: 'Wrong caregiver key' }, 403);
          await env.DB.prepare(
            'INSERT INTO messages (code, dir, who, body, icon, at, seen, escalated) VALUES (?, ?, ?, ?, ?, ?, 0, 1)'
          ).bind(house, 'ask', body.me || 'Someone', (body.me || 'Someone') + ' would like to see you', '\u{1F44B}', Date.now()).run();
          return json({ ok: true });
        }

        /* ---------- she sends a picture back ---------- */
        case '/photo': {
          const { data, who, askId } = body;
          if (!data) return json({ error: 'Missing photo' }, 400);

          await env.DB.prepare('INSERT INTO photos (code, who, data, at, seen) VALUES (?, ?, ?, ?, 0)')
            .bind(house, who || '', data, Date.now()).run();
          if (askId) await env.DB.prepare('UPDATE messages SET ack = ?, ack_at = ? WHERE code = ? AND id = ?')
            .bind('answered', Date.now(), house, askId).run();

          const cfg = await loadConfig(env, house);
          await pushTo(topicsFor(cfg, who), cfg.name || 'IndependentME', 'Sent you a photo', false);
          return json({ ok: true });
        }

        /* ---------- fetch one photo, kept out of /pull so it stays light ---------- */
        case '/photo-get': {
          const row = await env.DB.prepare('SELECT data, at, who FROM photos WHERE code = ? AND id = ?')
            .bind(house, Number(url.searchParams.get('id'))).first();
          return row ? json(row) : json({ error: 'Not found' }, 404);
        }

        /* ---------- she says not right now ---------- */
        case '/decline': {
          const { askId, who } = body;
          if (askId) await env.DB.prepare('UPDATE messages SET ack = ?, ack_at = ? WHERE code = ? AND id = ?')
            .bind('declined', Date.now(), house, askId).run();
          await env.DB.prepare(
            'INSERT INTO messages (code, dir, who, body, icon, at, seen) VALUES (?, ?, ?, ?, ?, ?, 0)'
          ).bind(house, 'out', who || '', 'Not right now', '\u{1F6AB}', Date.now()).run();
          const cfg = await loadConfig(env, house);
          await pushTo(topicsFor(cfg, who), cfg.name || 'IndependentME', 'Not right now', false);
          return json({ ok: true });
        }

        /* ---------- video call setup ---------- */
        case '/call': {
          // Announces a call so the other end can show an incoming screen
          const { room, from, to } = body;
          if (!room) return json({ error: 'Missing room' }, 400);
          await env.DB.prepare(
            'INSERT INTO messages (code, dir, who, body, icon, at, seen, escalated) VALUES (?, ?, ?, ?, ?, ?, 0, 1)'
          ).bind(house, 'call', to || '', room + '|' + (from || ''), '\u{1F4F9}', Date.now()).run();
          const cfg = await loadConfig(env, house);
          if (to) await pushTo(topicsFor(cfg, to), cfg.name || 'IndependentME', (from || 'Someone') + ' is calling', true);
          return json({ ok: true });
        }

        case '/signal': {
          if (request.method === 'GET') {
            const rows = await env.DB.prepare(
              'SELECT id, side, kind, payload FROM signal WHERE code = ? AND room = ? AND id > ? ORDER BY id'
            ).bind(house, url.searchParams.get('room'), Number(url.searchParams.get('since') || 0)).all();
            return json({ items: rows.results || [] });
          }
          const { room, side, kind, payload } = body;
          if (!room || !kind) return json({ error: 'Missing room or kind' }, 400);
          await env.DB.prepare(
            'INSERT INTO signal (code, room, side, kind, payload, at) VALUES (?, ?, ?, ?, ?, ?)'
          ).bind(house, room, side || 'a', kind, payload || '', Date.now()).run();
          return json({ ok: true });
        }

        /* ---------- prove notifications work ---------- */
        case '/testpush': {
          if (!await careOk()) return json({ error: 'Wrong caregiver key' }, 403);
          const cfg = await loadConfig(env, house);
          const topics = body.topic
            ? [body.topic]
            : (cfg.contacts || []).map(p => p.ntfy).filter(Boolean);
          if (!topics.length) return json({ error: 'No ntfy topics are set on anyone', sent: [] }, 400);
          const sent = await pushTo(topics, (cfg.name || 'IndependentME') + ' test',
            'If you can read this, notifications are working.', false);
          return json({ ok: true, sent });
        }

        /* ---------- who has been in this household ---------- */
        case '/who': {
          // Names survive in the message history even when the setup is lost
          const rows = await env.DB.prepare(
            `SELECT who, COUNT(*) n, MAX(at) last FROM messages
             WHERE code = ? AND who IS NOT NULL AND who != '' AND who != 'help' AND who != 'reminder'
             GROUP BY who ORDER BY n DESC`
          ).bind(house).all();
          return json({ names: rows.results || [] });
        }

        /* ---------- undo a bad save ---------- */
        case '/restore': {
          if (!await careOk()) return json({ error: 'Wrong caregiver key' }, 403);
          const row = await env.DB.prepare('SELECT config, prev_config, prev_updated FROM household WHERE code = ?')
            .bind(house).first();
          if (!row || !row.prev_config) return json({ error: 'There is no earlier version stored' }, 404);

          const now = Date.now();
          await env.DB.prepare(
            'UPDATE household SET prev_config = ?, prev_updated = ?, config = ?, updated = ? WHERE code = ?'
          ).bind(row.config, now, row.prev_config, now, house).run();
          return json({ ok: true, updated: now, config: JSON.parse(row.prev_config) });
        }

        /* ---------- what's in the previous version, without restoring it ---------- */
        case '/prev': {
          const row = await env.DB.prepare('SELECT prev_config, prev_updated FROM household WHERE code = ?')
            .bind(house).first();
          if (!row || !row.prev_config) return json({ has: false });
          const c = JSON.parse(row.prev_config);
          return json({ has: true, at: row.prev_updated,
            people: (c.contacts || []).length, tasks: (c.tasks || []).length,
            names: (c.contacts || []).map(x => x.name) });
        }

        /* ---------- clearing out old messages ---------- */
        case '/purge': {
          if (!await careOk()) return json({ error: 'Wrong caregiver key' }, 403);
          const { ids, before, all } = body;

          if (all) {
            await env.DB.prepare('DELETE FROM messages WHERE code = ?').bind(house).run();
            await env.DB.prepare('DELETE FROM photos WHERE code = ?').bind(house).run();
          } else if (Array.isArray(ids) && ids.length) {
            const marks = ids.map(() => '?').join(',');
            await env.DB.prepare(`DELETE FROM messages WHERE code = ? AND id IN (${marks})`)
              .bind(house, ...ids.map(Number)).run();
          } else if (before) {
            await env.DB.prepare('DELETE FROM messages WHERE code = ? AND at < ?').bind(house, Number(before)).run();
            await env.DB.prepare('DELETE FROM photos WHERE code = ? AND at < ?').bind(house, Number(before)).run();
          } else {
            return json({ error: 'Nothing specified' }, 400);
          }
          return json({ ok: true });
        }

        case '/purge-photo': {
          if (!await careOk()) return json({ error: 'Wrong caregiver key' }, 403);
          if (!body.id) return json({ error: 'Missing id' }, 400);
          await env.DB.prepare('DELETE FROM photos WHERE code = ? AND id = ?').bind(house, Number(body.id)).run();
          return json({ ok: true });
        }

        /* ---------- caregiver replies ---------- */
        case '/reply': {
          if (!await careOk()) return json({ error: 'Wrong caregiver key' }, 403);
          const { who, text, icon } = body;
          if (!text) return json({ error: 'Missing message' }, 400);

          await env.DB.prepare(
            'INSERT INTO messages (code, dir, who, body, icon, at, seen) VALUES (?, ?, ?, ?, ?, ?, 0)'
          ).bind(house, 'in', who || '', text, icon || '💬', Date.now()).run();
          return json({ ok: true });
        }

        /* ---------- caregiver saves the whole setup ---------- */
        case '/config': {
          if (!await careOk()) return json({ error: 'Wrong caregiver key' }, 403);
          if (!body.config) return json({ error: 'Missing config' }, 400);

          const existing = await env.DB.prepare('SELECT config, updated FROM household WHERE code = ?')
            .bind(house).first();

          // Refuse a write that would empty out a household that isn't empty.
          // This is what happens when a new phone saves before it has finished
          // downloading, and it must never silently overwrite everyone.
          if (existing && !body.force) {
            const old = JSON.parse(existing.config || '{}');
            const neu = body.config;
            const shrank = (a, b) => (a || []).length > 0 && (b || []).length === 0;
            if (shrank(old.contacts, neu.contacts) ||
                shrank(old.tasks, neu.tasks) ||
                ((old.tasks || []).length > 2 && (neu.tasks || []).length === 0)) {
              return json({
                error: 'That save would have wiped the existing setup, so it was blocked. ' +
                       'Let the app finish loading, then try again.',
                blocked: true
              }, 409);
            }
          }

          const now = Date.now();
          if (existing) {
            await env.DB.prepare('UPDATE household SET prev_config = ?, prev_updated = ? WHERE code = ?')
              .bind(existing.config, existing.updated, house).run();
          }
          await env.DB.prepare(
            `INSERT INTO household (code, care, config, updated) VALUES (?, ?, ?, ?)
             ON CONFLICT(code) DO UPDATE SET
               config  = excluded.config,
               updated = excluded.updated,
               care    = CASE WHEN household.care IS NULL OR household.care = ''
                              THEN excluded.care ELSE household.care END`
          ).bind(house, body.care || '', JSON.stringify(body.config), now).run();

          // Echo back what was actually stored, so the app can confirm the write
          // landed rather than assuming it did.
          const saved = await env.DB.prepare('SELECT config, updated FROM household WHERE code = ?')
            .bind(house).first();
          return json({ ok: true, updated: saved ? saved.updated : now, config: saved ? JSON.parse(saved.config) : body.config });
        }

        /* ---------- mark messages read ---------- */
        case '/seen': {
          const ids = (body.ids || []).filter(n => Number.isInteger(n));
          if (!ids.length) return json({ ok: true });
          await env.DB.prepare(
            `UPDATE messages SET seen = 1 WHERE code = ? AND id IN (${ids.map(() => '?').join(',')})`
          ).bind(house, ...ids).run();
          return json({ ok: true });
        }

        /* ---------- caregiver week view ---------- */
        case '/week': {
          const rows = await env.DB.prepare(
            'SELECT day, task_id, at FROM log WHERE code = ? AND day >= ? ORDER BY day'
          ).bind(house, url.searchParams.get('from') || '2000-01-01').all();
          return json({ log: rows.results || [] });
        }

        default:
          return json({ error: 'Not found' }, 404);
      }
    } catch (err) {
      return json({ error: String(err && err.message || err) }, 500);
    }
  },

  /**
   * Runs every minute. A help request she aimed at one person shouldn't die
   * quietly if that person's phone is in a purse. If nobody has claimed it
   * after the grace period, it opens up to everyone.
   */
  async scheduled(event, env, ctx) {
    const houses = await env.DB.prepare(
      'SELECT code, config FROM household'
    ).all();

    for (const h of (houses.results || [])) {
      const cfg = JSON.parse(h.config || '{}');
      await env.DB.prepare('DELETE FROM signal WHERE code = ? AND at < ?')
        .bind(h.code, Date.now() - 3600000).run();

      // Call invites and check-in requests are only meaningful for a few
      // minutes. Left alone they pile up in the thread.
      await env.DB.prepare(
        "DELETE FROM messages WHERE code = ? AND dir IN ('call','ask') AND at < ?"
      ).bind(h.code, Date.now() - 7200000).run();

      // Optional housekeeping so the thread doesn't grow forever
      if (cfg.keepDays) {
        const cutoff = Date.now() - cfg.keepDays * 86400000;
        await env.DB.prepare('DELETE FROM messages WHERE code = ? AND at < ?').bind(h.code, cutoff).run();
        await env.DB.prepare('DELETE FROM photos   WHERE code = ? AND at < ?').bind(h.code, cutoff).run();
      }

      const houseGrace = cfg.helpFallbackMinutes != null ? cfg.helpFallbackMinutes : 10;
      if (!houseGrace) continue;

      const open = await env.DB.prepare(
        `SELECT id, body, who, at FROM messages
         WHERE code = ? AND dir = 'alert' AND escalated = 0 AND ack IS NULL`
      ).bind(h.code).all();

      for (const m of (open.results || [])) {
        // Someone in the room can be given a shorter leash than someone at work
        const asked = (cfg.contacts || []).find(p => p.name === m.who);
        const grace = (asked && asked.grace != null ? asked.grace : houseGrace) * 60000;
        if (Date.now() - m.at < grace) continue;

        await env.DB.prepare('UPDATE messages SET escalated = 1 WHERE id = ?').bind(m.id).run();

        // Only people on the ladder, and never someone who's mid-shift or in class
        const now = new Date();
        const ladder = (cfg.contacts || [])
          .filter(p => p.escalate !== false && p.name !== m.who)
          .filter(p => freeNow(p, now) || p.fallback)
          .map(p => p.ntfy);

        await pushTo(
          ladder.length ? ladder : (cfg.contacts || []).filter(p => p.fallback).map(p => p.ntfy),
          (cfg.name || 'IndependentME') + ' \u2014 still waiting',
          'No answer from ' + (m.who || 'anyone') + '. ' + m.body,
          true
        );
      }
    }
  }
};