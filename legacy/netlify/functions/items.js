import { sql } from './db.js';
import { addCORS, okJSON, unauthorized, authOk } from './_util.js';

export default async (req) => {
  if (req.method === 'OPTIONS') {
    const res = new Response('', { status: 204 });
    addCORS(res);
    return res;
  }

  const url = new URL(req.url);
  const id = url.searchParams.get('id');

  if (req.method === 'GET') {
    const rows = id
      ? await sql`SELECT * FROM items WHERE id=${id}`
      : await sql`SELECT * FROM items ORDER BY ordering ASC`;
    const r = okJSON(rows);
    addCORS(r);
    return r;
  }

  if (!authOk(req)) {
    const r = unauthorized();
    addCORS(r);
    return r;
  }

  if (req.method === 'POST') {
    const body = await req.json();
    const [row] = await sql`
      INSERT INTO items (name_ar,name_en,price,calories,img_url,category,variants,ordering)
      VALUES (
        ${body.name_ar},
        ${body.name_en},
        ${body.price},
        ${body.calories||0},
        ${body.img_url||''},
        ${body.category||''},
        ${body.variants ? JSON.stringify(body.variants) : null},
        ${body.ordering||0}
      )
      RETURNING *`;
    const r = okJSON(row, 201);
    addCORS(r);
    return r;
  }

  if (req.method === 'PUT' && id) {
    const body = await req.json();
    const [row] = await sql`
      UPDATE items SET
        name_ar=${body.name_ar},
        name_en=${body.name_en},
        price=${body.price},
        calories=${body.calories||0},
        img_url=${body.img_url||''},
        category=${body.category||''},
        variants=${body.variants ? JSON.stringify(body.variants) : null},
        ordering=${body.ordering||0}
      WHERE id=${id} RETURNING *`;
    const r = okJSON(row);
    addCORS(r);
    return r;
  }

  if (req.method === 'DELETE' && id) {
    await sql`DELETE FROM items WHERE id=${id}`;
    const r = okJSON({ ok: true });
    addCORS(r);
    return r;
  }

  const r = okJSON({ error: 'method' }, 405);
  addCORS(r);
  return r;
};
