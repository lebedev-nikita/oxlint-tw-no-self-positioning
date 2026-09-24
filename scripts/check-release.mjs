import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const cargo = readFileSync('Cargo.toml', 'utf8');
const cargoLock = readFileSync('Cargo.lock', 'utf8');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

if (git('status', '--porcelain')) {
  throw new Error('Commit all changes before publishing.');
}

const version = pkg.version;
if (lock.version !== version || lock.packages[''].version !== version
  || !new RegExp(`^version = "${version.replaceAll('.', '\\.')}"$`, 'm').test(cargo)
  || !cargoLock.includes(`name = "oxlint_tw_no_self_positioning"\nversion = "${version}"`)) {
  throw new Error('package.json, package-lock.json, Cargo.toml, and Cargo.lock must use one version.');
}

const expectedTag = `v${version}`;
const tags = git('tag', '--points-at', 'HEAD').split('\n');
if (!tags.includes(expectedTag)) {
  throw new Error(`Tag the current commit with ${expectedTag} before publishing.`);
}
const remoteTags = git('ls-remote', '--tags', 'origin',
  `refs/tags/${expectedTag}`, `refs/tags/${expectedTag}^{}`);
if (!remoteTags.split('\n').some(line => line.startsWith(`${git('rev-parse', 'HEAD')}\t`))) {
  throw new Error(`Push ${expectedTag} to origin and wait for CI before publishing.`);
}

console.log(`Release ${expectedTag} matches clean commit ${git('rev-parse', '--short', 'HEAD')}.`);
