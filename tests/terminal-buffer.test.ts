import test from 'node:test';
import assert from 'node:assert/strict';
import { stripAnsi, TerminalBuffer } from '../src/renderer/terminal-buffer';

test('removes common terminal colour sequences', () => {
  assert.equal(stripAnsi('\u001b[32mgreen\u001b[0m'), 'green');
});

test('handles line feeds, carriage-return rewrites, and backspace', () => {
  const buffer = new TerminalBuffer();
  buffer.append('first\nprogress 10%');
  buffer.append('\rprogress 90%');
  buffer.append('\nabc\bD');
  assert.equal(buffer.toString(), 'first\nprogress 90%\nabD');
});

test('keeps only the configured number of completed lines', () => {
  const buffer = new TerminalBuffer(2);
  buffer.append('one\ntwo\nthree\nfour');
  assert.equal(buffer.toString(), 'two\nthree\nfour');
});

test('clear removes all buffered output', () => {
  const buffer = new TerminalBuffer();
  buffer.append('hello');
  buffer.clear();
  assert.equal(buffer.toString(), '');
});
