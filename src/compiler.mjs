import { createHash } from 'node:crypto';
import JSONbig from 'json-bigint';

// IDs and mathematical integers must never pass through JavaScript Number.
export const parseIr = (text) => JSONbig({ useNativeBigInt: true, alwaysParseAsBig: true }).parse(text);
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const fail = (message, node) => {
  throw new Error(`${message}${node?.id !== undefined ? ` (IR id ${node.id})` : ''}`);
};
const key = (id) => String(id);
const identifier = (name) => {
  // A deliberately small name subset; reject instead of accidentally aliasing symbols.
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) fail(`Unsupported identifier: ${name}`);
  if (['self', 'Self', 'type', 'struct', 'enum', 'fn', 'mod', 'pub', 'crate', 'super', 'ref', 'match', 'move', 'loop', 'in', 'as', 'use', 'where', 'const', 'static', 'impl', 'trait', 'let', 'mut', 'return', 'true', 'false', 'while', 'for', 'if', 'else', 'async', 'await', 'dyn', 'unsafe', 'extern', 'break', 'continue'].includes(name)) {
    fail(`Reserved Rust identifier: ${name}`);
  }
  return name;
};
const conjunction = (parts) => parts.length ? parts.map((x) => `(${x})`).join(' &&\n        ') : 'true';
const operators = Object.freeze({
  iadd: ['+', 'int', 'int'], isub: ['-', 'int', 'int'],
  igt: ['>', 'int', 'bool'], igte: ['>=', 'int', 'bool'],
  ilt: ['<', 'int', 'bool'], ilte: ['<=', 'int', 'bool'],
});

export function compileIr(ir, bindings, provenance = {}) {
  if (ir.stage !== 'compiling' || ir.errors?.length || !ir.types || !ir.effects || !ir.table) {
    fail('Expected successful typed, resolved Quint compile JSON');
  }
  if (!Array.isArray(ir.modules) || ir.modules.length !== 1) fail('Expected one flattened module');
  const module = ir.modules[0];
  if (module.name !== bindings.module || ir.main !== bindings.module) fail('Main module does not match bindings');
  if (!Array.isArray(bindings.actions) || !bindings.actions.length || !Array.isArray(bindings.invariants)) {
    fail('Bindings must explicitly select actions and invariants');
  }
  const selected = [bindings.init, ...bindings.actions, ...bindings.invariants];
  if (selected.some((x) => typeof x !== 'string') || new Set(selected).size !== selected.length) {
    fail('Export names must be distinct strings');
  }
  // Assumptions/constants are never silently ignored. Use concrete pure vals in this PoC.
  const allowedDeclarations = new Set(['var', 'def', 'typedef']);
  for (const d of module.declarations) {
    if (!allowedDeclarations.has(d.kind)) fail(`Unsupported declaration: ${d.kind}`, d);
  }
  const declarations = new Map(module.declarations.map((d) => [d.name, d]));
  if (declarations.size !== module.declarations.length) fail('Duplicate declaration names');
  const states = module.declarations.filter((d) => d.kind === 'var');
  if (!states.length) fail('No state variables');
  const stateIds = new Map(states.map((d) => [key(d.id), identifier(d.name)]));
  const referenced = new Set();

  const typeOf = (node) => {
    const scheme = ir.types[key(node.id)];
    if (!scheme || scheme.typeVariables?.length || scheme.rowVariables?.length) {
      fail('Missing or polymorphic inferred type', node);
    }
    return scheme.type;
  };
  const scalarType = (node) => {
    const type = typeOf(node);
    if (!['int', 'bool'].includes(type.kind)) fail(`Unsupported type: ${type.kind}`, node);
    return type.kind;
  };
  const resolve = (node) => {
    const target = ir.table[key(node.id)];
    if (!target) fail(`Unresolved reference: ${node.name ?? node.opcode}`, node);
    return target;
  };
  for (const state of states) scalarType(state);

  const expression = (node, context, expected) => {
    const actual = scalarType(node);
    if (expected && actual !== expected) fail(`Expected ${expected}, got ${actual}`, node);
    if (node.kind === 'int') {
      if (typeof node.value !== 'bigint') fail('Integer literal must be parsed losslessly', node);
      return `(${node.value.toString()}int)`;
    }
    if (node.kind === 'bool') return node.value ? 'true' : 'false';
    if (node.kind === 'name') {
      const target = resolve(node);
      const stateName = stateIds.get(key(target.id));
      if (stateName) {
        if (!context.state) fail('Initial condition/pure val cannot read current state', node);
        return `${context.state}.${stateName}`;
      }
      const parameter = context.params.get(key(target.id));
      if (parameter) return parameter;
      if (target.kind === 'def' && ['pureval', 'val'].includes(target.qualifier) && target.expr.kind !== 'lambda') {
        if (context.stack.has(key(target.id))) fail('Recursive definition', target);
        referenced.add(target.name);
        return expression(target.expr, {
          ...context,
          state: target.qualifier === 'pureval' ? null : context.state,
          stack: new Set([...context.stack, key(target.id)]),
        }, actual);
      }
      fail(`Unsupported name reference: ${target.name}`, node);
    }
    if (node.kind !== 'app') fail(`Unsupported expression: ${node.kind}`, node);
    const args = node.args;
    const arity = (n) => { if (args.length !== n) fail(`Wrong arity for ${node.opcode}`, node); };
    if (operators[node.opcode]) {
      arity(2);
      const [op, input, output] = operators[node.opcode];
      if (actual !== output) fail(`Invalid result type for ${node.opcode}`, node);
      return `(${expression(args[0], context, input)} ${op} ${expression(args[1], context, input)})`;
    }
    if (['eq', 'neq'].includes(node.opcode)) {
      arity(2);
      const operand = scalarType(args[0]);
      if (actual !== 'bool') fail('Equality must return bool', node);
      return `(${expression(args[0], context, operand)} ${node.opcode === 'eq' ? '==' : '!='} ${expression(args[1], context, operand)})`;
    }
    if (['and', 'or'].includes(node.opcode)) {
      if (!args.length || actual !== 'bool') fail('Invalid Boolean connective', node);
      return `(${args.map((a) => expression(a, context, 'bool')).join(node.opcode === 'and' ? ' && ' : ' || ')})`;
    }
    if (node.opcode === 'not') {
      arity(1);
      if (actual !== 'bool') fail('not must return bool', node);
      return `(!${expression(args[0], context, 'bool')})`;
    }
    if (node.opcode === 'iuminus') {
      arity(1);
      if (actual !== 'int') fail('Negation must return int', node);
      return `(-${expression(args[0], context, 'int')})`;
    }
    if (node.opcode === 'ite') {
      arity(3);
      return `(if ${expression(args[0], context, 'bool')} { ${expression(args[1], context, actual)} } else { ${expression(args[2], context, actual)} })`;
    }
    fail(`Unsupported opcode: ${node.opcode}`, node);
  };

  const action = (name, initial) => {
    identifier(name);
    const decl = declarations.get(name);
    if (!decl || decl.kind !== 'def' || decl.qualifier !== 'action') fail(`Expected action: ${name}`, decl);
    referenced.add(name);
    const lambda = decl.expr.kind === 'lambda' ? decl.expr : null;
    const params = lambda?.params ?? [];
    const signature = typeOf(decl);
    if (params.length ? signature.kind !== 'oper' || signature.res.kind !== 'bool' : signature.kind !== 'bool') {
      fail('Expected Boolean action signature', decl);
    }
    if (initial && params.length) fail('Parameterized init is unsupported', decl);
    const paramMap = new Map(params.map((p, i) => [key(p.id), `arg${i}`]));
    const paramDecls = params.map((p, i) => `arg${i}: ${scalarType(p)}`);
    const context = { state: initial ? null : 'pre', params: paramMap, stack: new Set([key(decl.id)]) };
    const guards = [];
    const updates = new Map();
    const lower = (node) => {
      if (scalarType(node) !== 'bool') fail('Action body must return bool', node);
      if (node.kind === 'app' && node.opcode === 'actionAll') {
        if (!node.args.length) fail('Empty actionAll', node);
        node.args.forEach(lower);
      } else if (node.kind === 'app' && node.opcode === 'assign') {
        if (node.args.length !== 2 || node.args[0].kind !== 'name') fail('Invalid assignment', node);
        const target = resolve(node.args[0]);
        const field = stateIds.get(key(target.id));
        if (!field) fail('Assignment target is not a state variable', node);
        if (updates.has(field)) fail(`Duplicate assignment to ${field}`, node);
        updates.set(field, expression(node.args[1], context, scalarType(target)));
      } else {
        // This also rejects actionAny, nondet, nested action calls, temporal and sequential operators.
        guards.push(expression(node, context, 'bool'));
      }
    };
    lower(lambda?.expr ?? decl.expr);
    for (const state of states) {
      if (!updates.has(state.name)) fail(`Action ${name} must explicitly assign ${state.name}; implicit framing is unsupported`, decl);
    }
    const suffix = paramDecls.length ? `, ${paramDecls.join(', ')}` : '';
    const argumentsSuffix = params.length ? `, ${params.map((_, i) => `arg${i}`).join(', ')}` : '';
    const updatesText = [...updates].map(([field, value]) => `post.${field} == ${value}`);
    const enabled = initial ? '' : `    pub open spec fn model_${name}_enabled(pre: ModelState${suffix}) -> bool {\n        ${conjunction(guards)}\n    }\n\n`;
    const relation = conjunction([
      ...(initial ? guards : [`model_${name}_enabled(pre${argumentsSuffix})`]), ...updatesText,
    ]);
    const code = `${enabled}    pub open spec fn model_${name}(${initial ? 'post: ModelState' : `pre: ModelState, post: ModelState${suffix}`}) -> bool {\n        ${relation}\n    }`;
    return { name, params: params.map((p, i) => ({ irName: p.name, argument: `arg${i}`, type: scalarType(p) })), code };
  };
  const initial = action(bindings.init, true);
  const actions = bindings.actions.map((name) => action(name, false));
  const invariants = bindings.invariants.map((name) => {
    identifier(name);
    const decl = declarations.get(name);
    if (!decl || decl.kind !== 'def' || !['val', 'pureval'].includes(decl.qualifier)) fail(`Expected invariant value: ${name}`, decl);
    referenced.add(name);
    const value = expression(decl.expr, { state: 'state', params: new Map(), stack: new Set([key(decl.id)]) }, 'bool');
    return `    pub open spec fn model_${name}(state: ModelState) -> bool {\n        ${value}\n    }`;
  });
  const fields = states.map((state) => `        pub ${state.name}: ${scalarType(state)},`).join('\n');
  const header = [
    '// Generated from typed Quint IR. Do not edit.',
    `// Quint: ${provenance.quintVersion ?? 'unknown'}; IR SHA-256: ${provenance.irSha256 ?? 'unknown'}`,
    '// Scope: explicitly selected action relations, not complete behavior/liveness refinement.',
  ].join('\n');
  const rust = `${header}\nuse vstd::prelude::*;\n\nverus! {\n    pub struct ModelState {\n${fields}\n    }\n\n${[initial.code, ...actions.map((a) => a.code), ...invariants].join('\n\n')}\n}\n`;
  return {
    rust,
    manifest: {
      ...provenance,
      module: module.name,
      fields: states.map((s) => ({ name: s.name, type: scalarType(s) })),
      init: bindings.init,
      actions: actions.map(({ code, ...metadata }) => metadata),
      invariants: bindings.invariants,
      referencedDefinitions: [...referenced].sort(),
      excludedDefinitions: module.declarations.filter((d) => d.kind === 'def' && !referenced.has(d.name)).map((d) => d.name),
      scope: 'Selected operation relations only. No full step, temporal, progress, fairness or concurrency proof.',
    },
  };
}
