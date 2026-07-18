import { neon } from '@neondatabase/serverless';

// Netlify Neon extension provides NETLIFY_DATABASE_URL
const DATABASE_URL = process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('Neither NETLIFY_DATABASE_URL nor DATABASE_URL is set');
  throw new Error('Database URL environment variable is not set');
}

console.log('Using database:', DATABASE_URL.split('@')[1]?.split('/')[0] || 'unknown');

export const sql = neon(DATABASE_URL);
