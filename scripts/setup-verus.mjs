import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root } from './generate.mjs';
import { sha256 } from '../src/compiler.mjs';

export const versions = JSON.parse(readFileSync(resolve(root, 'tool-versions.json'), 'utf8'));
const platform = `${process.platform}-${process.arch}`;
export const platformAsset = () => {
  const asset = versions.assets[platform];
  if (!asset) throw new Error(`No pinned Verus archive for ${platform}; supply VERUS_BIN.`);
  return asset;
};

export function findVerus() {
  if (process.env.VERUS_BIN) return resolve(process.env.VERUS_BIN);
  const asset = platformAsset();
  const path = resolve(root, '.tools', asset.directory, 'verus');
  if (existsSync(path)) return path;
  throw new Error('Verus not found. Run bun run setup:verus, or set VERUS_BIN to the pinned binary.');
}

export function setupVerus() {
  const asset = platformAsset();
  const destination = resolve(root, '.tools');
  const binary = resolve(destination, asset.directory, 'verus');
  if (existsSync(binary)) return binary;
  mkdirSync(destination, { recursive: true });
  const archive = resolve(destination, asset.file);
  const download = spawnSync('curl', ['--fail', '--location', '--silent', '--show-error', '--output', archive, `${versions.releaseBase}/${asset.file}`], { stdio: 'inherit', timeout: 120000 });
  if (download.error || download.status !== 0) throw new Error(`Download failed: ${download.error ?? download.status}`);
  if (sha256(readFileSync(archive)) !== asset.sha256) throw new Error('Verus archive SHA-256 mismatch');
  const unpack = spawnSync('unzip', ['-q', archive, '-d', destination], { stdio: 'inherit', timeout: 60000 });
  if (unpack.error || unpack.status !== 0) throw new Error(`Unzip failed: ${unpack.error ?? unpack.status}`);
  console.log(`Installed pinned Verus in ${binary}`);
  console.log(`Requires existing Rust toolchain ${versions.rust}; no global toolchain settings were changed.`);
  return binary;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) setupVerus();
