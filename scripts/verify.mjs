import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { root, generate } from './generate.mjs';
import { findVerus, versions } from './setup-verus.mjs';
import { compileIr, parseIr, sha256 } from '../src/compiler.mjs';

const replaceOnce = (source, from, to) => {
  if (source.split(from).length !== 2) throw new Error(`Mutation anchor must occur exactly once: ${from}`);
  return source.replace(from, to);
};
const cleanProof = (source, name) => {
  if (/\b(?:assume|admit|assume_specification|axiom)\s*[(<]|#\s*\[[^\]]*external/s.test(source)) {
    throw new Error(`Unproved assumption/verification escape in ${name}`);
  }
};
const counts = (text) => {
  const match = text.match(/verification results::\s*(\d+) verified, (\d+) errors/);
  return match ? { verified: Number(match[1]), errors: Number(match[2]) } : null;
};

export function verify({ regenerate = true } = {}) {
  mkdirSync(resolve(root, 'results'), { recursive: true });
  const summaryPath = resolve(root, 'results/summary.json');
  const summary = { status: 'running', tools: versions, checks: [] };
  const save = () => writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n');
  save();
  try {
    if (regenerate) generate();
    const binary = findVerus();
    const cargoBin = join(process.env.CARGO_HOME ?? join(homedir(), '.cargo'), 'bin');
    const env = { ...process.env, PATH: `${cargoBin}:${process.env.PATH ?? ''}` };
    const invoke = (args) => {
      const result = spawnSync(binary, args, { cwd: root, env, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
      if (result.error || result.signal) throw new Error(`Verus execution failed: ${result.error ?? result.signal}`);
      return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
    };
    const version = invoke(['--version']);
    if (version.exitCode !== 0 || !version.stdout.includes(`Version: ${versions.verus}`) || !version.stdout.includes(`Toolchain: ${versions.rust}-`)) {
      throw new Error(`Unexpected Verus toolchain:\n${version.stdout}${version.stderr}`);
    }
    writeFileSync(resolve(root, 'results/verus-version.txt'), version.stdout + version.stderr);
    summary.verusVersion = version.stdout.trim();
    summary.inputs = {
      sourceSha256: sha256(readFileSync(resolve(root, 'model/bank.qnt'))),
      irSha256: sha256(readFileSync(resolve(root, 'generated/bank.ir.json'))),
      specSha256: sha256(readFileSync(resolve(root, 'generated/bank.spec.rs'))),
      implementationSha256: sha256(readFileSync(resolve(root, 'src/account.rs'))),
    };
    const source = readFileSync(resolve(root, 'src/account.rs'), 'utf8');
    const spec = readFileSync(resolve(root, 'generated/bank.spec.rs'), 'utf8');
    cleanProof(source, 'implementation');
    cleanProof(spec, 'generated specification');

    const runCase = (name, file, expected, compile = false) => {
      const args = [file, '--crate-name', name.replaceAll('-', '_'), '--no-cheating', '--expand-errors'];
      if (compile) args.push('--compile', '-o', 'results/account-demo');
      const result = invoke(args);
      const text = result.stdout + result.stderr;
      writeFileSync(resolve(root, `results/${name}.log`), `$ verus ${args.join(' ')}\nexit=${result.exitCode}\n${text}`);
      const statistics = counts(text);
      const accepted = expected === 'accept'
        ? result.exitCode === 0 && statistics?.errors === 0 && statistics.verified >= 4
        : result.exitCode !== 0 && statistics?.errors > 0 && /postcondition not satisfied/.test(text) && /model_withdraw/.test(text);
      const check = { name, expected, passed: Boolean(accepted), ...statistics, exitCode: result.exitCode, source: file, log: `results/${name}.log` };
      summary.checks.push(check);
      save();
      if (!accepted) throw new Error(`Unexpected verification outcome for ${name}:\n${text}`);
      console.log(`${name}: ${expected === 'accept' ? 'VERIFIED' : 'REJECTED as expected'} (${statistics.verified} verified, ${statistics.errors} errors)`);
      return check;
    };

    runCase('correct', 'src/account.rs', 'accept', true);
    if (!existsSync(resolve(root, 'results/account-demo'))) throw new Error('Compiled executable missing');
    const executed = spawnSync(resolve(root, 'results/account-demo'), [], { cwd: root, encoding: 'utf8', timeout: 10000 });
    if (executed.error || executed.signal || executed.status !== 0) throw new Error(`Compiled Rust program failed: ${executed.error ?? executed.stderr}`);
    summary.execution = { exitCode: executed.status, staticallyCheckedScenario: 'new → deposit(100) → withdraw(30): balance=70, transactions=2' };
    writeFileSync(resolve(root, 'results/execution.log'), `exit=${executed.status}\n${executed.stdout}${executed.stderr}`);

    const mutants = [
      ['missing-debit', 'balance: account.balance - amount, // mutation: debit', 'balance: account.balance, // mutation: debit'],
      ['missing-counter', 'transactions: account.transactions + 1, // mutation: counter', 'transactions: account.transactions, // mutation: counter'],
    ];
    for (const [name, from, to] of mutants) {
      const mutant = replaceOnce(source, from, to);
      cleanProof(mutant, name);
      const file = `generated/account-${name}.rs`;
      writeFileSync(resolve(root, file), mutant);
      runCase(name, file, 'reject');
    }

    // Source-of-truth control: change the Quint model, not a handwritten Rust specification.
    const modelSource = readFileSync(resolve(root, 'model/bank.qnt'), 'utf8');
    const boundary = modelSource.indexOf('  action withdraw(');
    if (boundary < 0) throw new Error('Model mutation anchor missing');
    const changedModel = modelSource.slice(0, boundary) + replaceOnce(modelSource.slice(boundary), "transactions' = transactions + 1,", "transactions' = transactions + 2,");
    const changedDir = resolve(root, 'results/model-change');
    mkdirSync(changedDir, { recursive: true });
    writeFileSync(resolve(changedDir, 'bank.qnt'), changedModel);
    const compiled = spawnSync(process.execPath, [resolve(root, 'node_modules/@informalsystems/quint/dist/src/cli.js'), 'compile', 'results/model-change/bank.qnt', '--target=json', '--flatten=true'], { cwd: root, encoding: 'utf8', timeout: 60000 });
    if (compiled.error || compiled.status !== 0) throw new Error(`Changed model failed Quint compilation: ${compiled.error ?? compiled.stderr}`);
    const changedSpec = compileIr(parseIr(compiled.stdout), JSON.parse(readFileSync(resolve(root, 'bindings.json'), 'utf8')), {
      quintVersion: versions.quint, irSha256: sha256(compiled.stdout), sourceSha256: sha256(changedModel),
    });
    cleanProof(changedSpec.rust, 'changed-model specification');
    writeFileSync(resolve(changedDir, 'bank.ir.json'), compiled.stdout);
    writeFileSync(resolve(changedDir, 'bank.spec.rs'), changedSpec.rust);
    writeFileSync(resolve(changedDir, 'account.rs'), replaceOnce(source, '../generated/bank.spec.rs', 'bank.spec.rs'));
    runCase('model-change', 'results/model-change/account.rs', 'reject');
    summary.status = 'passed';
    summary.scope = 'Selected bank operations, sequential execution, machine integer safety, generated state invariant. No temporal/full-step refinement proof; compiler semantics preservation is not formally proved.';
    save();
    return summary;
  } catch (error) {
    summary.status = 'failed';
    summary.failure = error.message;
    save();
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) verify();
