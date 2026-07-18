export function addCORS(res) {
  res.headers.set('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
}

export function okJSON(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

export function unauthorized() {
  return okJSON({ error: 'unauthorized' }, 401);
}

export function authOk(req) {
  const hdr = req.headers.get('authorization') || '';
  const pass = hdr.replace(/^Bearer\s+/i, '');
  return pass && pass === process.env.ADMIN_PASSWORD;
}
