import { sql } from './db.js';
import { addCORS, okJSON, unauthorized, authOk } from './_util.js';

function sanitizeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export default async (req) => {
  if (req.method === 'OPTIONS') {
    const res = new Response('', { status: 204 });
    addCORS(res);
    return res;
  }

  if (!authOk(req)) {
    const res = unauthorized();
    addCORS(res);
    return res;
  }

  if (req.method === 'GET') {
    const url = new URL(req.url);
    const limit = Math.min(sanitizeNumber(url.searchParams.get('limit') || 500, 500), 2000);
    const rows = await sql`
      SELECT *
      FROM customers
      ORDER BY last_order_at DESC NULLS LAST, total_orders DESC, customer_key ASC
      LIMIT ${limit}`;
    const res = okJSON(rows);
    addCORS(res);
    return res;
  }

  const res = okJSON({ error: 'method' }, 405);
  addCORS(res);
  return res;
};
