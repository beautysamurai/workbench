import test from 'node:test';
import assert from 'node:assert/strict';
import {
  languageForPath,
  resolveWorkspacePath,
  shellQuote,
  toWslUnc,
  uncToWslPath,
} from '../src/main/path-utils';

test('converts a Linux path to a modern WSL UNC path', () => {
  assert.equal(
    toWslUnc('Ubuntu', '/home/kabes/projects/curve-server'),
    '\\\\wsl.localhost\\Ubuntu\\home\\kabes\\projects\\curve-server',
  );
});

test('converts both WSL UNC formats back to Linux paths', () => {
  assert.equal(
    uncToWslPath('Ubuntu', '\\\\wsl.localhost\\Ubuntu\\home\\kabes\\README.md'),
    '/home/kabes/README.md',
  );
  assert.equal(
    uncToWslPath('Ubuntu', '\\\\wsl$\\Ubuntu\\home\\kabes\\README.md'),
    '/home/kabes/README.md',
  );
});

test('resolves relative context files inside a workspace root', () => {
  assert.equal(
    resolveWorkspacePath('/home/kabes/project', 'docs/../README.md'),
    '/home/kabes/project/README.md',
  );
});

test('quotes apostrophes safely for a POSIX shell', () => {
  assert.equal(shellQuote("/tmp/O'Reilly"), "'/tmp/O'\"'\"'Reilly'");
});

test('detects common source languages', () => {
  assert.equal(languageForPath('/src/CurveRepository.java'), 'java');
  assert.equal(languageForPath('/docs/design.md'), 'markdown');
  assert.equal(languageForPath('/no-extension'), '');
});
