import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const prepareOnly = process.argv.includes('--prepare-only');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const napi = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'napi.cmd' : 'napi');
const suffixes = [
  'darwin-x64', 'darwin-arm64', 'win32-x64-msvc', 'win32-arm64-msvc',
  'linux-x64-gnu', 'linux-arm64-gnu', 'linux-x64-musl', 'linux-arm64-musl',
];

if (!existsSync('artifacts')) throw new Error('Native artifacts are missing. Run just fetch-artifacts.');
// OIDC credentials are acquired only by npm publish, so whoami cannot test them in CI.
if (!prepareOnly && !process.env.GITHUB_ACTIONS) {
  execFileSync(npm, ['whoami'], { stdio: 'inherit' });
}

const stage = mkdtempSync(join(tmpdir(), 'oxlint-manual-publish-'));
let success = false;
try {
  for (const file of ['package.json', 'package-lock.json', 'README.md', 'LICENSE',
    'index.js', 'index.d.ts']) {
    cpSync(join(root, file), join(stage, file));
  }
  for (const directory of ['dist', 'docs', 'artifacts']) {
    cpSync(join(root, directory), join(stage, directory), { recursive: true });
  }

  execFileSync(napi, ['create-npm-dirs', '--cwd', stage], { stdio: 'inherit' });
  execFileSync(napi, ['artifacts', '--cwd', stage], { stdio: 'inherit' });
  execFileSync('node', [join(root, 'scripts', 'verify-artifacts.mjs')], {
    cwd: stage, stdio: 'inherit',
  });
  execFileSync(napi, [
    'prepublish', '--cwd', stage, '-t', 'npm', '--no-gh-release', '--skip-optional-publish',
  ], { stdio: 'inherit' });

  const prepared = JSON.parse(readFileSync(join(stage, 'package.json'), 'utf8'));
  for (const suffix of suffixes) {
    const name = `${pkg.name}-${suffix}`;
    if (prepared.optionalDependencies?.[name] !== pkg.version) {
      throw new Error(`Missing optional dependency ${name}@${pkg.version}.`);
    }
  }
  execFileSync(npm, ['pack', '--dry-run', '--ignore-scripts'], { cwd: stage, stdio: 'inherit' });

  if (!prepareOnly) {
    for (const suffix of suffixes) {
      const packageDir = join(stage, 'npm', suffix);
      const platform = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
      if (platform.name !== `${pkg.name}-${suffix}` || platform.version !== pkg.version) {
        throw new Error(`Incorrect platform package metadata in ${packageDir}.`);
      }
      console.log(`Publishing ${platform.name}@${platform.version}`);
      execFileSync(npm, ['publish', '--access', 'public', '--ignore-scripts'], {
        cwd: packageDir, stdio: 'inherit',
      });
    }
    console.log(`Publishing ${pkg.name}@${pkg.version}`);
    execFileSync(npm, ['publish', '--access', 'public', '--ignore-scripts'], {
      cwd: stage, stdio: 'inherit',
    });
  }
  success = true;
} finally {
  if (success) rmSync(stage, { recursive: true, force: true });
  else console.error(`Release staging retained for inspection: ${resolve(stage)}`);
}
