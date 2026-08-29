'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const mode = process.argv[2];
if (mode !== 'portable' && mode !== 'full') {
  console.error('Usage: node scripts/run-tests.cjs <portable|full>');
  process.exit(2);
}

const projectRoot = path.resolve(__dirname, '..');
const testRoot = path.join(projectRoot, 'dist-test', 'tests');

function collectTestFiles(directory, recursive) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isFile() && entry.name.endsWith('.test.js')) {
      files.push(target);
    } else if (recursive && entry.isDirectory()) {
      files.push(...collectTestFiles(target, true));
    }
  }
  return files;
}

let testFiles;
try {
  testFiles = collectTestFiles(testRoot, mode === 'full').sort();
} catch (error) {
  console.error(`Unable to enumerate compiled tests: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

if (testFiles.length === 0) {
  console.error(`No ${mode} compiled test files found under ${testRoot}.`);
  process.exit(1);
}

const wslRoot = `${path.join(testRoot, 'wsl')}${path.sep}`;
if (mode === 'full' && !testFiles.some((file) => file.startsWith(wslRoot))) {
  console.error(`No WSL integration test files found under ${path.join(testRoot, 'wsl')}.`);
  process.exit(1);
}

console.log(`Running ${testFiles.length} ${mode} compiled test files:`);
for (const file of testFiles) {
  console.log(`- ${path.relative(projectRoot, file)}`);
}

const result = spawnSync(process.execPath, ['--test', ...testFiles], {
  cwd: projectRoot,
  shell: false,
  stdio: 'inherit',
  windowsHide: true,
});
if (result.error) {
  console.error(`Unable to run compiled tests: ${result.error.message}`);
  process.exit(1);
}
if (result.status === null) {
  console.error(`Test runner terminated by signal ${result.signal ?? 'unknown'}.`);
  process.exit(1);
}
process.exit(result.status);
