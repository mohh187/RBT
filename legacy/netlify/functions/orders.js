import { sql } from './db.js';
import { addCORS, okJSON, unauthorized, authOk } from './_util.js';

function getClientIp(req) {
  const headers = [
    'x-nf-client-connection-ip',
    'x-forwarded-for',
    'client-ip',
    'x-real-ip'
  ];
  for (const key of headers) {
    const value = req.headers.get(key);
    if (value) {
      return value.split(',')[0].trim();
    }
  }
  return '';
}

function sanitizeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function sanitizeString(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function buildLoyaltySummary(body) {
  const summary = body && body.loyalty ? body.loyalty : {};
  const rewards = Array.isArray(body && body.loyalty_rewards)
    ? body.loyalty_rewards
    : Array.isArray(summary.rewards)
      ? summary.rewards
      : [];
  const normalizedRewards = rewards.map((r = {}) => ({
    drink_ar: sanitizeString(r.drink_ar),
    drink_en: sanitizeString(r.drink_en),
    freebies: sanitizeNumber(r.freebies, 0),
    discount: sanitizeNumber(r.discount, 0)
  }));
  const drinkUnits = sanitizeNumber(summary.drinkUnits ?? summary.eligibleDrinks ?? body?.drink_units, 0);
  const baseCount = sanitizeNumber(summary.baseCount, 0);
  const projectedCount = sanitizeNumber(summary.projectedCount, baseCount + drinkUnits);
  const freebiesEarned = normalizedRewards.reduce((total, r) => total + sanitizeNumber(r.freebies, 0), 0);
  return {
    rewards: normalizedRewards,
    summary: {
      baseCount,
      projectedCount,
      drinkUnits,
      freebiesEarned,
      discount: sanitizeNumber(body?.loyalty_discount ?? summary.discount, 0)
    }
  };
}

export default async (req) => {
  if (req.method === 'OPTIONS') {
    const res = new Response('', { status: 204 });
    addCORS(res);
    return res;
  }

  if (req.method === 'GET') {
    if (!authOk(req)) {
      const res = unauthorized();
      addCORS(res);
      return res;
    }
    const url = new URL(req.url);
    const limit = Math.min(sanitizeNumber(url.searchParams.get('limit') || 200, 200), 1000);
    const customerKey = sanitizeString(url.searchParams.get('customer_key') || '');
    const rows = customerKey
      ? await sql`SELECT * FROM orders WHERE customer_key=${customerKey} ORDER BY id DESC LIMIT ${limit}`
      : await sql`SELECT * FROM orders ORDER BY id DESC LIMIT ${limit}`;
    const res = okJSON(rows);
    addCORS(res);
    return res;
  }

  if (req.method === 'POST') {
    const body = await req.json();
    const tableNo = sanitizeString(body.table_no);
    const subtotal = sanitizeNumber(body.subtotal ?? body.total, 0);
    const total = sanitizeNumber(body.total, subtotal);
    const discountCode = sanitizeString(body.discount_code);
    const loyaltyDiscount = sanitizeNumber(body.loyalty_discount, 0);
    const customer = body && body.customer ? body.customer : {};
    const customerKeyRaw = sanitizeString(customer.id || '');
    const customerKey = customerKeyRaw || 'guest';
    const customerName = sanitizeString(customer.name || '');
    const customerPhone = sanitizeString(customer.phone || '');
    const device = body && body.device ? body.device : {};
    const deviceInfo = {
      type: sanitizeString(device.type || ''),
      language: sanitizeString(device.language || ''),
      platform: sanitizeString(device.platform || ''),
      vendor: sanitizeString(device.vendor || ''),
      timezone: sanitizeString(device.timezone || ''),
      screen: sanitizeString(device.screen || ''),
      touch: Boolean(device.touch || device.is_touch || false)
    };
    const userAgent = sanitizeString(req.headers.get('user-agent') || device.user_agent || '');
    const ipAddress = sanitizeString(getClientIp(req));
    const { rewards: loyaltyRewards, summary: loyaltySummary } = buildLoyaltySummary(body);
    const drinkUnits = sanitizeNumber(loyaltySummary.drinkUnits, 0);

    const [row] = await sql`
      INSERT INTO orders (
        table_no, cart, subtotal, total, discount_code,
        loyalty_discount, loyalty_rewards, loyalty_summary,
        drink_units, customer_key, customer_name, customer_phone,
        device_info, user_agent, ip_address
      )
      VALUES (
        ${tableNo}, ${sql.json(body.cart || [])}, ${subtotal}, ${total}, ${discountCode},
        ${loyaltyDiscount}, ${sql.json(loyaltyRewards)}, ${sql.json(loyaltySummary)},
        ${drinkUnits}, ${customerKey}, ${customerName}, ${customerPhone},
        ${sql.json(deviceInfo)}, ${userAgent}, ${ipAddress}
      )
      RETURNING *`;

    try {
      if (customerKey) {
        const totalRewards = loyaltySummary.freebiesEarned;
        await sql`
          INSERT INTO customers (
            customer_key, name, phone, total_orders, total_spent,
            total_drinks, total_rewards, last_order_at, last_device,
            last_user_agent, last_ip
          )
          VALUES (
            ${customerKey}, NULLIF(${customerName}, ''), NULLIF(${customerPhone}, ''), 1, ${total},
            ${drinkUnits}, ${totalRewards}, now(), NULLIF(${deviceInfo.type}, ''),
            NULLIF(${userAgent}, ''), NULLIF(${ipAddress}, '')
          )
          ON CONFLICT (customer_key) DO UPDATE SET
            name = COALESCE(EXCLUDED.name, customers.name),
            phone = COALESCE(EXCLUDED.phone, customers.phone),
            total_orders = customers.total_orders + 1,
            total_spent = customers.total_spent + EXCLUDED.total_spent,
            total_drinks = customers.total_drinks + EXCLUDED.total_drinks,
            total_rewards = customers.total_rewards + EXCLUDED.total_rewards,
            last_order_at = now(),
            last_device = COALESCE(EXCLUDED.last_device, customers.last_device),
            last_user_agent = COALESCE(EXCLUDED.last_user_agent, customers.last_user_agent),
            last_ip = COALESCE(EXCLUDED.last_ip, customers.last_ip),
            updated_at = now();
        `;
      }
    } catch (err) {
      console.error('Failed to upsert customer', err);
    }

    const res = okJSON(row, 201);
    addCORS(res);
    return res;
  }

  if (!authOk(req)) {
    const res = unauthorized();
    addCORS(res);
    return res;
  }

  const res = okJSON({ error: 'method' }, 405);
  addCORS(res);
  return res;
};
