import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { compileIr, parseIr, sha256 } from '../src/compiler.mjs';

export const root = fileURLToPath(new URL('../', import.meta.url));
export function generate() {
  const version = JSON.parse(readFileSync(resolve(root, 'node_modules/@informalsystems/quint/package.json'), 'utf8')).version;
  if (version !== '0.33.0') throw new Error(`Expected Quint 0.33.0, got ${version}`);
  const bindings = JSON.parse(readFileSync(resolve(root, 'bindings.json'), 'utf8'));
  const args = [resolve(root, 'node_modules/@informalsystems/quint/dist/src/cli.js'), 'compile', 'model/bank.qnt', '--target=json', '--flatten=true'];
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`Quint compilation failed: ${result.error ?? result.stderr}`);
  const text = result.stdout;
  const ir = parseIr(text);
  const generated = compileIr(ir, bindings, {
    quintVersion: version,
    irSha256: sha256(text),
    sourceSha256: sha256(readFileSync(resolve(root, 'model/bank.qnt'))),
    bindingsSha256: sha256(readFileSync(resolve(root, 'bindings.json'))),
  });
  mkdirSync(resolve(root, 'generated'), { recursive: true });
  writeFileSync(resolve(root, 'generated/bank.ir.json'), text);
  writeFileSync(resolve(root, 'generated/bank.spec.rs'), generated.rust);
  writeFileSync(resolve(root, 'generated/manifest.json'), JSON.stringify(generated.manifest, null, 2) + '\n');
  console.log(`Generated bank.spec.rs from real Quint ${version} IR (${generated.manifest.actions.length} exported actions).`);
  return generated;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) generate();
