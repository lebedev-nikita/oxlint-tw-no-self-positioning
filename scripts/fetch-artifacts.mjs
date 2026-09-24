import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';

const run = (command, args) => execFileSync(command, args, {
  encoding: 'utf8',
  stdio: ['inherit', 'pipe', 'inherit'],
}).trim();

const sha = run('git', ['rev-parse', 'HEAD']);
const runs = JSON.parse(run('gh', [
  'run', 'list', '--workflow', 'ci.yml', '--commit', sha, '--event', 'push', '--status', 'success',
  '--json', 'databaseId,headSha,conclusion', '--limit', '50',
]));
const ciRun = runs.find(candidate => candidate.headSha === sha
  && candidate.conclusion === 'success');
if (!ciRun) {
  throw new Error(`No successful CI run for ${sha}. Push the tag and wait for CI.`);
}

rmSync('artifacts', { recursive: true, force: true });
console.log(`Downloading native artifacts from CI run ${ciRun.databaseId}.`);
execFileSync('gh', [
  'run', 'download', String(ciRun.databaseId), '--pattern', 'binding-*', '--dir', 'artifacts',
], { stdio: 'inherit' });
