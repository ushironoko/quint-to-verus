import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, generate } from './generate.mjs';
import { verify } from './verify.mjs';

mkdirSync(resolve(root, 'results'), { recursive: true });
const run = (name, args) => {
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  writeFileSync(resolve(root, `results/${name}.log`), `${result.stdout ?? ''}${result.stderr ?? ''}`);
  if (result.error || result.signal || result.status !== 0) throw new Error(`${name} failed: ${result.error ?? result.stderr ?? result.signal}`);
  console.log(`${name}: passed`);
  return result.stdout;
};

// Mark incomplete reruns explicitly, including failures before Verus is invoked.
writeFileSync(resolve(root, 'results/summary.json'), JSON.stringify({ status: 'running' }, null, 2) + '\n');
try {
  generate();
  run('compiler-tests', ['--test', 'test/compiler.test.mjs']);
  run('quint-simulation', ['node_modules/@informalsystems/quint/dist/src/cli.js', 'run', 'model/bank.qnt', '--backend=typescript', '--invariant=state_invariant', '--max-samples=100', '--max-steps=20', '--seed=42']);
  const summary = verify({ regenerate: false });
  summary.compilerTests = 'results/compiler-tests.log';
  summary.quintSimulation = { log: 'results/quint-simulation.log', samples: 100, maxSteps: 20, seed: 42, exhaustive: false };
  writeFileSync(resolve(root, 'results/summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log('PoC complete. Evidence: results/summary.json');
} catch (error) {
  const prior = JSON.parse(readFileSync(resolve(root, 'results/summary.json'), 'utf8'));
  writeFileSync(resolve(root, 'results/summary.json'), JSON.stringify({ ...prior, status: 'failed', failure: error.message }, null, 2) + '\n');
  throw error;
}
