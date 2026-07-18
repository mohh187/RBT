CREATE TABLE IF NOT EXISTS items (
  id serial PRIMARY KEY,
  name_ar text NOT NULL,
  name_en text NOT NULL,
  price numeric(10,2) NOT NULL,
  calories int DEFAULT 0,
  img_url text DEFAULT '',
  category text DEFAULT '',
  variants jsonb DEFAULT NULL,
  ordering int DEFAULT 0
);

ALTER TABLE items ADD COLUMN IF NOT EXISTS category text DEFAULT '';
ALTER TABLE items ADD COLUMN IF NOT EXISTS variants jsonb DEFAULT NULL;

CREATE TABLE IF NOT EXISTS orders (
  id serial PRIMARY KEY,
  table_no text,
  cart jsonb NOT NULL,
  subtotal numeric(10,2) DEFAULT 0,
  total numeric(10,2) NOT NULL,
  discount_code text DEFAULT '',
  loyalty_discount numeric(10,2) DEFAULT 0,
  loyalty_rewards jsonb DEFAULT '[]'::jsonb,
  loyalty_summary jsonb DEFAULT '{}'::jsonb,
  drink_units int DEFAULT 0,
  customer_key text,
  customer_name text,
  customer_phone text,
  device_info jsonb DEFAULT '{}'::jsonb,
  user_agent text,
  ip_address text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS subtotal numeric(10,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_code text DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS loyalty_discount numeric(10,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS loyalty_rewards jsonb DEFAULT '[]'::jsonb;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS loyalty_summary jsonb DEFAULT '{}'::jsonb;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS drink_units int DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_key text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_name text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_phone text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS device_info jsonb DEFAULT '{}'::jsonb;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_agent text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ip_address text;

CREATE TABLE IF NOT EXISTS customers (
  customer_key text PRIMARY KEY,
  name text,
  phone text,
  total_orders int DEFAULT 0,
  total_spent numeric(10,2) DEFAULT 0,
  total_drinks int DEFAULT 0,
  total_rewards int DEFAULT 0,
  last_order_at timestamptz,
  last_device text,
  last_user_agent text,
  last_ip text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE customers ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS total_orders int DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS total_spent numeric(10,2) DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS total_drinks int DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS total_rewards int DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_order_at timestamptz;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_device text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_user_agent text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_ip text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE customers ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
