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

test('checks root dimensions in class and style, while allowing min/max constraints and descendants', () => {
  const result = lint(`
    function Card() {
      return <article className="md:-mx-2 absolute top-0 w-80 h-20 size-4 md:h-24 basis-1/2 max-w-lg min-w-0 max-h-screen min-h-0 p-4"
        style={{ marginTop: 4, position: 'absolute', width: 200, height: 20, maxWidth: 500, minWidth: 0, maxHeight: 100, minHeight: 0 }}>
        <span className="mt-4 w-full h-full" />
      </article>;
    }
  `);
  assert.deepEqual(result.messages.sort(), [
    'md:-mx-2', 'absolute', 'top-0', 'w-80', 'h-20', 'size-4', 'md:h-24', 'basis-1/2',
    'marginTop:4', 'position:absolute', 'width:200', 'height:20',
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
    function Card() { return <div className="max-w-sm min-w-0 max-h-screen min-h-0 static float-none flex flex-row p-4 before:absolute *:w-full *:h-full" style={{ maxWidth: 10, minHeight: 0, position: 'static', cssFloat: 'none' }} />; }
  `);
  assert.deepEqual(result.messages, [], result.output);
  assert.equal(result.status, 0, result.output);
});

test('ignores arbitrary variants targeting descendants of the root', () => {
  const reported = lint(`
    export function Kbd() {
      return <kbd className="[&_svg:not([class*='size-'])]:size-3 [&>svg]:w-4 hover:[&_span]:mt-2 [&:hover]:w-8">A</kbd>;
    }
  `);
  assert.deepEqual(reported.messages, ['[&:hover]:w-8'], reported.output);

  const original = lint(`
    export function Kbd() {
      return <kbd className="[&_svg:not([class*='size-'])]:size-3">A</kbd>;
    }
  `);
  assert.equal(original.status, 0, original.output);
  assert.deepEqual(original.messages, [], original.output);
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

test('allows relative roots as internal containing blocks while rejecting placement and offsets', () => {
  const card = lint(`
    function Card() {
      return <article className="relative overflow-hidden rounded-lg">
        <span className="absolute inset-y-0 left-0 w-1 bg-accent" />
        <div>Content</div>
      </article>;
    }
  `);
  assert.deepEqual(card.messages, [], card.output);
  assert.equal(card.status, 0, card.output);

  const result = lint(`
    function Card() {
      return <article className="relative md:relative hover:!relative [position:relative] absolute fixed md:fixed sticky top-2 left-0"
        style={{ position: 'relative', top: 2 }} />;
    }
  `);
  assert.deepEqual(result.messages.sort(), [
    'absolute', 'fixed', 'md:fixed', 'sticky', 'top-2', 'left-0', 'top:2',
  ].sort(), result.output);
});

test('reports external positioning, floats, and dimensions', () => {
  const result = lint(`
    function Card() {
      return <article className="relative md:sticky float-left float-end border p-4 h-20"
        style={{ position: 'fixed', cssFloat: 'inline-start', height: 20, border: '1px solid', padding: 4 }} />;
    }
  `);
  assert.deepEqual(result.messages.sort(), [
    'md:sticky', 'float-left', 'float-end', 'h-20', 'position:fixed', 'cssFloat:inline-start', 'height:20',
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
    const Card = () => <div className="m-2 relative top-0 float-left w-80 h-20 size-4 basis-1/2"
      style={{ marginLeft: 2, position: 'absolute', left: 0, cssFloat: 'right', width: 80, height: 20, flexBasis: 20 }} />;
  `;
  const groups = [
    ['no-margin', ['m-2', 'marginLeft:2']],
    ['no-position', ['position:absolute']],
    ['no-offset', ['top-0', 'left:0']],
    ['no-float', ['float-left', 'cssFloat:right']],
    ['no-dimensions', ['w-80', 'h-20', 'size-4', 'width:80', 'height:20']],
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
      rules: { 'tw-no-self-positioning/no-dimensions': 'off' },
    });
  `);
  const overridden = lint('const Card = () => <div className="m-2 w-80" />;', undefined, tsConfig);
  assert.deepEqual(overridden.messages, ['m-2'], overridden.output);
});
