import fs from 'fs/promises';
import path from 'path';

const buildDir = process.env.BUILD_DIR || 'dist';
const projectRoot = process.cwd();

const entriesToCopy = [
  'index.html',
  'menu',
  'menu-data.js',
  'menu-admin.html',
  'order-status.html',
  'admin',
  'netlify'
];

await fs.rm(path.join(projectRoot, buildDir), { recursive: true, force: true });
await fs.mkdir(path.join(projectRoot, buildDir), { recursive: true });

for (const entry of entriesToCopy) {
  const source = path.join(projectRoot, entry);
  try {
    const stats = await fs.stat(source);
    const destination = path.join(projectRoot, buildDir, entry);
    if (stats.isDirectory()) {
      await fs.cp(source, destination, { recursive: true });
    } else {
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.copyFile(source, destination);
    }
    console.log(`Copied ${entry}`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.warn(`Skipping missing entry: ${entry}`);
    } else {
      throw error;
    }
  }
}

console.log(`Build output available in ${buildDir}/`);
