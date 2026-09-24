import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const suffixes = {
  'x86_64-apple-darwin': 'darwin-x64',
  'aarch64-apple-darwin': 'darwin-arm64',
  'x86_64-pc-windows-msvc': 'win32-x64-msvc',
  'aarch64-pc-windows-msvc': 'win32-arm64-msvc',
  'x86_64-unknown-linux-gnu': 'linux-x64-gnu',
  'aarch64-unknown-linux-gnu': 'linux-arm64-gnu',
  'x86_64-unknown-linux-musl': 'linux-x64-musl',
  'aarch64-unknown-linux-musl': 'linux-arm64-musl',
};

for (const target of pkg.napi.targets) {
  const suffix = suffixes[target];
  if (!suffix) throw new Error(`Unknown native target: ${target}`);
  const binary = `${pkg.napi.binaryName}.${suffix}.node`;
  const platformPath = join('npm', suffix, binary);
  if (!existsSync(platformPath) || !existsSync(binary)) {
    throw new Error(`Missing native artifact for ${target}: ${platformPath}`);
  }
}
console.log(`Verified ${pkg.napi.targets.length} native artifacts.`);
