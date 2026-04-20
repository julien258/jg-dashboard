// pennylane-debug-meulette-customers.js — diagnostic
export default async (req) => {
  const PENNYLANE_API = 'https://app.pennylane.com/api/external/v2';
  const token = process.env.PENNYLANE_MEULETTE_TOKEN;
  if (!token) return Response.json({ error: 'TOKEN MANQUANT' });

  try {
    const all = [];
    let cursor = null;
    let iterations = 0;
    const log = [];
    for (let i = 0; i < 20; i++) {
      iterations++;
      const path = cursor
        ? `/customers?per_page=100&cursor=${encodeURIComponent(cursor)}`
        : `/customers?per_page=100`;
      const res = await fetch(`${PENNYLANE_API}${path}`, {
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
      });
      const text = await res.text();
      if (!res.ok) {
        return Response.json({
          ok: false,
          step: 'fetchAllCustomers',
          status_http: res.status,
          body: text.substring(0, 2000),
          iteration: iterations,
          cursor_sent: cursor,
          prior_total: all.length
        });
      }
      const data = JSON.parse(text);
      const items = data.items || data.customers || (Array.isArray(data) ? data : []);
      all.push(...items);
      log.push({ iter: iterations, items_count: items.length, next_cursor: data.next_cursor, keys: Object.keys(data) });
      cursor = data.next_cursor || null;
      if (!cursor || items.length === 0) break;
    }

    return Response.json({
      ok: true,
      total_customers: all.length,
      iterations,
      log,
      noms: all.map(c => c.name || c.company_name || '???')
    });
  } catch (e) {
    return Response.json({ ok: false, step: 'catch', error: e.message, stack: e.stack?.substring(0, 1000) });
  }
};

export const config = { path: '/api/pennylane-debug-meulette-customers' };
