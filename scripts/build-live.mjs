import {execFileSync} from 'node:child_process';
for (const role of ['core','app']) execFileSync(process.execPath, ['build.mjs'], {cwd: 'live/' + role, stdio: 'inherit'});
