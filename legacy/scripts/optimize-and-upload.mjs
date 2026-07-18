import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { v2 as cloudinary } from 'cloudinary';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envCandidates = [
  path.join(__dirname, '.env'),
  path.join(process.cwd(), '.env')
];

let envLoaded = false;
for (const candidate of envCandidates) {
  try {
    await fs.access(candidate);
    dotenv.config({ path: candidate });
    envLoaded = true;
    break;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

if (!envLoaded) {
  dotenv.config();
}

const requiredEnv = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const configuredDirs = (process.env.IMAGE_SOURCE_DIRS || '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

const possibleDirs = [
  ...configuredDirs,
  'public/images',
  'assets/images',
  'static',
  'images',
  'admin/images'
];

const seenDirs = new Set();
const srcDirs = [];
for (const rel of possibleDirs) {
  if (seenDirs.has(rel)) continue;
  seenDirs.add(rel);
  try {
    const abs = path.resolve(process.cwd(), rel);
    const stats = await fs.stat(abs);
    if (stats.isDirectory()) {
      srcDirs.push(abs);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`Unable to access ${rel}:`, error.message);
    }
  }
}

if (srcDirs.length === 0) {
  console.log('No image directories found. Nothing to upload.');
  process.exit(0);
}

async function *walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const resolved = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield *walk(resolved);
    } else {
      yield resolved;
    }
  }
}

const allowedExts = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const uploadMap = [];
const seen = new Set();

function hashBuffer(buffer) {
  return crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 10);
}

function uploadBuffer(buffer, options) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });

    stream.end(buffer);
  });
}

await fs.mkdir(path.join(process.cwd(), 'scripts'), { recursive: true });

for (const baseDir of srcDirs) {
  for await (const absolutePath of walk(baseDir)) {
    const ext = path.extname(absolutePath).toLowerCase();
    if (!allowedExts.has(ext)) continue;

    const buffer = await fs.readFile(absolutePath);
    const digest = hashBuffer(buffer);
    const key = `${path.resolve(absolutePath)}:${digest}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const fileName = `${path.basename(absolutePath, ext)}-${digest}.webp`;

    const optimized = await sharp(buffer)
      .rotate()
      .webp({ quality: 82, effort: 4 })
      .toBuffer();

    const uploadOptions = {
      resource_type: 'image',
      folder: process.env.CLOUDINARY_UPLOAD_FOLDER || 'neema-menu',
      use_filename: true,
      unique_filename: false,
      filename_override: fileName,
      overwrite: true
    };

    console.log(`Uploading ${absolutePath} -> ${fileName}`);
    const result = await uploadBuffer(optimized, uploadOptions);
    const relativePath = path.relative(process.cwd(), absolutePath).split(path.sep).join('/');
    uploadMap.push({ local: relativePath, url: result.secure_url });
  }
}

const outputPath = path.join(process.cwd(), 'scripts', 'upload-map.json');
uploadMap.sort((a, b) => a.local.localeCompare(b.local));
await fs.writeFile(outputPath, JSON.stringify(uploadMap, null, 2));
console.log(`Wrote ${outputPath} with ${uploadMap.length} entries.`);
