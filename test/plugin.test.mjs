import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import plugin, { noSelfPositioning, recommended } from 'oxlint-tw-no-self-positioning';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = mkdtempSync(join(tmpdir(), 'oxlint-self-positioning-'));
const configDirectory = mkdtempSync(join(root, 'test', 'config-'));
const config = join(directory, '.oxlintrc.json');
test.after(() => rmSync(directory, { recursive: true, force: true }));
test.after(() => rmSync(configDirectory, { recursive: true, force: true }));

function lint(source, rules = plugin.recommended.rules, configFile = config) {
  if (configFile === config) {
    writeFileSync(config, JSON.stringify({ jsPlugins: plugin.recommended.jsPlugins, rules }));
  }
  const file = join(directory, 'example.tsx');
  writeFileSync(file, source);
  const result = spawnSync(process.execPath,
    [join(root, 'node_modules', 'oxlint', 'bin', 'oxlint'), '--config', configFile, file],
    { encoding: 'utf8' });
  if (result.error) throw result.error;
  const output = result.stdout + result.stderr;
  assert.doesNotMatch(output, /Failed to load|Error loading|panic/i);
  return {
    status: result.status,
    messages: [...output.matchAll(/React component root must not set '([^']+)'/g)].map(m => m[1]),
    output,
  };
}

test('checks root class and style, while allowing min/max width and descendants', () => {
  const result = lint(`
    function Card() {
      return <article className="md:-mx-2 absolute top-0 w-80 basis-1/2 max-w-lg min-w-0 p-4"
        style={{ marginTop: 4, position: 'absolute', width: 200, maxWidth: 500, minWidth: 0 }}>
        <span className="mt-4 w-full" />
      </article>;
    }
  `);
  assert.deepEqual(result.messages.sort(), [
    'md:-mx-2', 'absolute', 'top-0', 'w-80', 'basis-1/2',
    'marginTop:4', 'position:absolute', 'width:200',
  ].sort(), result.output);
  assert.equal(result.status, 1);
});

test('handles arrow components, wrappers, branches, fragments, and class render', () => {
  const result = lint(`
    const Card = () => <div className="mt-2" />;
    const Wrapped = React.memo(React.forwardRef((props, ref) => <div className="w-full" />));
    function Branch({ ok }) { return ok ? <div className="left-0" /> : <div className="max-w-sm" />; }
    function Group() { return <><div className="basis-auto" /><div className="m-0" /></>; }
    class Panel extends React.Component { render() { return <div className="absolute" />; } }
  `);
  assert.deepEqual(result.messages.sort(),
    ['mt-2', 'w-full', 'left-0', 'basis-auto', 'm-0', 'absolute'].sort(), result.output);
});

test('reads static strings in class helpers and template literals', () => {
  const result = lint(`
    const Box = ({ active }) => <div className={cn('p-4', active && 'hover:!mt-3',
      { 'w-[10rem]': active, 'left-0': false }, [\`lg:basis-1/3 \${active ? '' : ''}\`])} />;
  `);
  assert.deepEqual(result.messages, ['hover:!mt-3', 'w-[10rem]', 'lg:basis-1/3'], result.output);
});

test('ignores noncomponents and allowed root utilities', () => {
  const result = lint(`
    function helper() { return <div className="m-4" />; }
    function Card() { return <div className="max-w-sm min-w-0 static float-none flex flex-row p-4 before:absolute *:w-full" style={{ maxWidth: 10, position: 'static', cssFloat: 'none' }} />; }
  `);
  assert.deepEqual(result.messages, [], result.output);
  assert.equal(result.status, 0, result.output);
});

test('keeps findings and root tracking separate across files', () => {
  writeFileSync(config, JSON.stringify({
    jsPlugins: plugin.recommended.jsPlugins,
    rules: plugin.recommended.rules,
  }));
  const component = join(directory, 'a.tsx');
  const plainTypeScript = join(directory, 'b.ts');
  const nextComponent = join(directory, 'c.tsx');
  writeFileSync(component, 'export function A() { return <div className="w-full" />; }\n');
  writeFileSync(plainTypeScript, 'export const value = 1;\n');
  writeFileSync(nextComponent, 'export function C() { return <div className="m-2" />; }\n');

  const result = spawnSync(process.execPath, [
    join(root, 'node_modules', 'oxlint', 'bin', 'oxlint'),
    '--config', config, '--threads', '1', component, plainTypeScript, nextComponent,
  ], { encoding: 'utf8' });
  if (result.error) throw result.error;
  const output = result.stdout + result.stderr;
  assert.equal(result.status, 1, output);
  assert.equal([...output.matchAll(/React component root must not set 'w-full'/g)].length, 1, output);
  assert.equal([...output.matchAll(/React component root must not set 'm-2'/g)].length, 1, output);
  assert.doesNotMatch(output, /b\.ts:\d+:\d+:.*tw-no-self-positioning/, output);
});

test('BEM positioning includes relative positioning and floats', () => {
  const result = lint(`
    function Card() {
      return <article className="relative md:sticky float-left float-end border p-4 h-20"
        style={{ position: 'fixed', cssFloat: 'inline-start', height: 20, border: '1px solid', padding: 4 }} />;
    }
  `);
  assert.deepEqual(result.messages.sort(), [
    'relative', 'md:sticky', 'float-left', 'float-end', 'position:fixed', 'cssFloat:inline-start',
  ].sort(), result.output);
});

test('treats Fragment children and returned arrays as roots', () => {
  const result = lint(`
    const Group = () => <React.Fragment><div className="top-0" /><div className="min-w-0" /></React.Fragment>;
    function Items() { return [<div key="a" className="m-2" />, <div key="b" className="max-w-sm" />]; }
    const Panel = class extends React.Component { render() { return <div className="w-full" />; } };
  `);
  assert.deepEqual(result.messages.sort(), ['top-0', 'm-2', 'w-full'].sort(), result.output);
});

test('each property group can be disabled independently', () => {
  const source = `
    const Card = () => <div className="m-2 relative top-0 float-left w-80 basis-1/2"
      style={{ marginLeft: 2, position: 'absolute', left: 0, cssFloat: 'right', width: 80, flexBasis: 20 }} />;
  `;
  const groups = [
    ['no-margin', ['m-2', 'marginLeft:2']],
    ['no-position', ['relative', 'position:absolute']],
    ['no-offset', ['top-0', 'left:0']],
    ['no-float', ['float-left', 'cssFloat:right']],
    ['no-width', ['w-80', 'width:80']],
    ['no-flex-basis', ['basis-1/2', 'flexBasis:20']],
  ];
  const all = groups.flatMap(([, messages]) => messages);
  assert.deepEqual(new Set(lint(source).messages), new Set(all));
  for (const [name, messages] of groups) {
    const rules = { ...plugin.recommended.rules,
      [`tw-no-self-positioning/${name}`]: 'off' };
    const result = lint(source, rules);
    assert.deepEqual(new Set(result.messages), new Set(all.filter(message =>
      !messages.includes(message))), `${name}: ${result.output}`);
  }
});

test('recommended includes every rule and works in oxlint config extends', () => {
  assert.equal(plugin, noSelfPositioning);
  assert.equal(plugin.recommended, recommended);
  assert.deepEqual(Object.keys(plugin.recommended.rules).sort(),
    Object.keys(plugin.rules).map(name => `tw-no-self-positioning/${name}`).sort());
  const tsConfig = join(configDirectory, 'oxlint.config.ts');
  writeFileSync(tsConfig, `
    import { defineConfig } from 'oxlint';
    import { noSelfPositioning } from 'oxlint-tw-no-self-positioning';
    export default defineConfig({ extends: [noSelfPositioning.recommended] });
  `);
  const result = lint('const Card = () => <div className="m-2 w-80" />;', undefined, tsConfig);
  assert.deepEqual(result.messages, ['m-2', 'w-80'], result.output);

  writeFileSync(tsConfig, `
    import { defineConfig } from 'oxlint';
    import { noSelfPositioning } from 'oxlint-tw-no-self-positioning';
    export default defineConfig({
      extends: [noSelfPositioning.recommended],
      rules: { 'tw-no-self-positioning/no-width': 'off' },
    });
  `);
  const overridden = lint('const Card = () => <div className="m-2 w-80" />;', undefined, tsConfig);
  assert.deepEqual(overridden.messages, ['m-2'], overridden.output);
});
