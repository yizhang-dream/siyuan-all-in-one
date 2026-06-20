import { spawnSync } from 'node:child_process';

const passthrough = process.argv.slice(2);

run('scripts/check_ai_live.mjs', passthrough);
run('scripts/check_e2e_live.mjs', passthrough);

function run(script, args = []) {
  const result = spawnSync(process.execPath, ['--no-warnings', script, ...args], {
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status || 1);
}
