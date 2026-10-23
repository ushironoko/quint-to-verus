import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileIr, parseIr } from '../src/compiler.mjs';

const text = readFileSync(new URL('../generated/bank.ir.json', import.meta.url), 'utf8');
const bindings = JSON.parse(readFileSync(new URL('../bindings.json', import.meta.url), 'utf8'));
const fresh = () => parseIr(text);
const decl = (ir, name) => ir.modules[0].declarations.find((d) => d.name === name);
const body = (ir, name) => decl(ir, name).expr.expr ?? decl(ir, name).expr;
const assignments = (ir, name) => body(ir, name).args.filter((a) => a.opcode === 'assign');

test('source of updates is IR, including transaction counter, not a bank-specific template', () => {
  const ir = fresh();
  const update = assignments(ir, 'withdraw').find((x) => x.args[0].name === 'transactions');
  update.args[1].args[1].value = 7n;
  const generated = compileIr(ir, bindings);
  assert.match(generated.rust, /post\.transactions == \(pre\.transactions \+ \(7int\)\)/);
  assert.equal(generated.manifest.actions.length, 2);
  assert.ok(generated.manifest.excludedDefinitions.includes('step'));
});

test('integer literals beyond 2^53 are preserved exactly', () => {
  const ir = fresh();
  const update = assignments(ir, 'init')[0];
  update.args[1].value = 9007199254740993123456789n;
  assert.match(compileIr(ir, bindings).rust, /9007199254740993123456789int/);
  assert.equal(parseIr('{"value":9007199254740993123456789}').value, 9007199254740993123456789n);
});

test('a missing frame assignment is rejected instead of silently adding or dropping constraints', () => {
  const ir = fresh();
  body(ir, 'withdraw').args = body(ir, 'withdraw').args.filter((a) => !(a.opcode === 'assign' && a.args[0].name === 'transactions'));
  assert.throws(() => compileIr(ir, bindings), /must explicitly assign transactions/);
});

test('duplicate updates to a state variable are rejected', () => {
  const ir = fresh();
  body(ir, 'withdraw').args.push(assignments(ir, 'withdraw')[0]);
  assert.throws(() => compileIr(ir, bindings), /Duplicate assignment/);
});

test('exporting an unsupported nondeterministic action is rejected', () => {
  const ir = fresh();
  body(ir, 'withdraw').opcode = 'actionAny';
  assert.throws(() => compileIr(ir, bindings), /Unsupported opcode: actionAny/);
});

test('unsupported arithmetic is rejected, never emitted as an uninterpreted assumption', () => {
  const ir = fresh();
  assignments(ir, 'withdraw')[0].args[1].opcode = 'idiv';
  assert.throws(() => compileIr(ir, bindings), /Unsupported opcode: idiv/);
});

test('unresolved references cannot fall back to matching a symbol name', () => {
  const ir = fresh();
  const reference = assignments(ir, 'withdraw')[0].args[1].args[0];
  delete ir.table[String(reference.id)];
  assert.throws(() => compileIr(ir, bindings), /Unresolved reference/);
});

test('initialization cannot read an unconstrained previous state', () => {
  const ir = fresh();
  assignments(ir, 'init')[0].args[1] = assignments(ir, 'withdraw')[0].args[1].args[0];
  assert.throws(() => compileIr(ir, bindings), /cannot read current state/);
});

test('polymorphic or untyped input is rejected', () => {
  const ir = fresh();
  delete ir.types[String(decl(ir, 'balance').id)];
  assert.throws(() => compileIr(ir, bindings), /Missing or polymorphic inferred type/);
});

test('model assumptions are not silently discarded', () => {
  const ir = fresh();
  ir.modules[0].declarations.push({ kind: 'assume', name: 'not_checked', id: 999999n });
  assert.throws(() => compileIr(ir, bindings), /Unsupported declaration: assume/);
});

test('a wrong module binding is rejected', () => {
  assert.throws(() => compileIr(fresh(), { ...bindings, module: 'different' }), /does not match/);
});
