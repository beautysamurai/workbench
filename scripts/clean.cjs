const fs = require('node:fs');
const path = require('node:path');

for (const directory of ['dist', 'dist-test']) {
  fs.rmSync(path.join(process.cwd(), directory), { recursive: true, force: true });
}
