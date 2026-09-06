import assert from 'node:assert/strict';
import test from 'node:test';
import { taskImageFromClipboardItems } from '../src/main/clipboard-image';

function tinyPng(): Uint8Array {
  return Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
}

test('reads and validates the first supported native clipboard image', async () => {
  const bytes = tinyPng();
  const image = await taskImageFromClipboardItems([
    { types: ['text/plain'], getType: async () => new Blob(['ignore']) },
    { types: ['image/png'], getType: async () => new Blob([bytes], { type: 'image/png' }) },
  ]);
  assert.equal(image?.name, 'Pasted image.png');
  assert.equal(image?.mediaType, 'image/png');
  assert.deepEqual(image?.bytes, bytes);
});

test('returns null for text-only clipboard items and rejects invalid image bytes', async () => {
  assert.equal(await taskImageFromClipboardItems([
    { types: ['text/plain'], getType: async () => new Blob(['plain text']) },
  ]), null);
  await assert.rejects(
    taskImageFromClipboardItems([
      { types: ['image/png'], getType: async () => new Blob([Uint8Array.of(1, 2, 3)], { type: 'image/png' }) },
    ]),
    /PNG, JPEG, or WebP/,
  );
});

test('rejects an oversized native clipboard blob before reading its bytes', async () => {
  let bytesRead = false;
  await assert.rejects(
    taskImageFromClipboardItems([{
      types: ['image/png'],
      getType: async () => ({
        size: (5 * 1024 * 1024) + 1,
        arrayBuffer: async () => {
          bytesRead = true;
          return new ArrayBuffer(0);
        },
      }),
    }]),
    /5 MB or smaller/,
  );
  assert.equal(bytesRead, false);
});
