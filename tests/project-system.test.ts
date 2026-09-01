import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateSync } from 'node:zlib';
import {
  formatProjectTask,
  nextProjectTaskId,
  parseProjectTasks,
  validateProjectTaskImage,
} from '../src/main/project-system';

function tinyPng(): Uint8Array {
  return Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
}

function testPngCrc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function pngWithImageDataChunks(imageDataChunks: Uint8Array[]): Uint8Array {
  const png = Buffer.from(tinyPng());
  const typeOffset = png.indexOf('IDAT');
  assert.notEqual(typeOffset, -1);
  const oldLength = png.readUInt32BE(typeOffset - 4);
  const chunks = imageDataChunks.map((imageData) => {
    const chunk = Buffer.alloc(imageData.length + 12);
    chunk.writeUInt32BE(imageData.length, 0);
    chunk.write('IDAT', 4, 'ascii');
    chunk.set(imageData, 8);
    chunk.writeUInt32BE(testPngCrc32(chunk.subarray(4, 8 + imageData.length)), 8 + imageData.length);
    return chunk;
  });
  return Uint8Array.from(Buffer.concat([
    png.subarray(0, typeOffset - 4),
    ...chunks,
    png.subarray(typeOffset + 8 + oldLength),
  ]));
}

function pngWithImageData(imageData: Uint8Array): Uint8Array {
  return pngWithImageDataChunks([imageData]);
}

function splitImageDataPng(): Uint8Array {
  const png = Buffer.from(tinyPng());
  const typeOffset = png.indexOf('IDAT');
  assert.notEqual(typeOffset, -1);
  const length = png.readUInt32BE(typeOffset - 4);
  const imageData = png.subarray(typeOffset + 4, typeOffset + 4 + length);
  return pngWithImageDataChunks([imageData.subarray(0, 5), imageData.subarray(5)]);
}

function interlacedTinyPng(): Uint8Array {
  const png = Buffer.from(tinyPng());
  png[28] = 1;
  png.writeUInt32BE(testPngCrc32(png.subarray(12, 29)), 29);
  return Uint8Array.from(png);
}

function tinyJpeg(): Uint8Array {
  // Independently accepted by Electron's JPEG decoder; includes complete tables and scan data.
  return Uint8Array.from(Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSgBBwcHCggKEwoKEygaFhooKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKP/AABEIAAEAAQMBEQACEQEDEQH/xAGiAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgsQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+gEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoLEQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2gAMAwEAAhEDEQA/APOq+OP6RP8A/9k=', 'base64'));
}

function tablelessJpeg(): Uint8Array {
  return Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
    0x00, 0xff, 0xd9,
  ]);
}

function jpegWithTruncatedScan(): Uint8Array {
  const bytes = tinyJpeg();
  return Uint8Array.from([...bytes.slice(0, -5), ...bytes.slice(-2)]);
}

function tinyWebp(): Uint8Array {
  return Uint8Array.from(Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64'));
}

function transformedLosslessWebp(): Uint8Array {
  // Deterministic 17x9 RGBA fixture with a predictor transform and nontrivial prefix codes.
  return Uint8Array.from(Buffer.from('UklGRrAAAABXRUJQVlA4TKQAAAAvEAACEJkKRPQ/NhHR/4CDSJIU6ZiZ4f/Tv9CPtaCgbRs5tHuNIm4iSRaV/z8g4eloCcRPAjESTsdJIEbCi5GwOp4EkgFUm7YBszn1kGgf40wjjzLqbLOPMeZYc88z7njjmxIJIJAEAsi/P6BRSKRRCKRTCKBTCQgyAUBnZ2JhoJJAY2NmZaAQGGQSAwsalYQgEwA0dma+eOCNX5754I8XVkYKAQ==', 'base64'));
}

function losslessWebpWithUnusedSimpleSymbol(): Uint8Array {
  const bytes = transformedLosslessWebp();
  // Simple codes carry 8-bit values; libwebp ignores an out-of-alphabet distance leaf
  // when the same code still defines an in-range leaf.
  bytes[89] ^= 0x08;
  bytes[182] ^= 0x02;
  bytes[183] ^= 0x80;
  return bytes;
}

function tinyLossyWebp(): Uint8Array {
  // Official libwebp-test-data small_1x1.webp fixture.
  return Uint8Array.from(Buffer.from('UklGRlYAAABXRUJQVlA4IDoAAADwAgCdASoBAAEAAEcIhYWIhYSIAgICdaoD+AP6Ag1NGAD+/vNYf/5gZt2KO//mBv/80F4SW6//zLwASUNNVAgAAAB0ZXN0MXgxAA==', 'base64'));
}

function patternedLossyWebp(): Uint8Array {
  // Deterministic 16x16 RGBA gradient encoded by libwebp.
  return Uint8Array.from(Buffer.from('UklGRsAAAABXRUJQVlA4ILQAAACwAgCdASoQABAAAkA4JbACdDKlPYAIgAeDwj/nXgAA/vucZH542rD9UItBMVXAykB/n9gqNdXXV0UvS3+V7ik71gsTiFVzqnEvFYdTfspad039DqfsOp8MP05ukNg/sU94R4FfS+BZMlJsDkkAudAREdWaCRcx8fQRnk81yNinP4Zf/Jmf3EYv2P+3aO9cKq/xwGBKB/vWXd5981+yn+ExrPufv3x/2wHQYdF6f0/FZ57gAAA=', 'base64'));
}

function losslessWebpWithPayload(payload: Uint8Array): Uint8Array {
  const bytes = Buffer.alloc(20 + payload.length + (payload.length % 2));
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WEBP', 8, 'ascii');
  bytes.write('VP8L', 12, 'ascii');
  bytes.writeUInt32LE(payload.length, 16);
  payload.forEach((value, index) => { bytes[20 + index] = value; });
  return bytes;
}

function lossyWebpWithFrameTag(frameTag: number): Uint8Array {
  const bytes = tinyLossyWebp();
  bytes[20] = frameTag & 0xff;
  bytes[21] = (frameTag >>> 8) & 0xff;
  bytes[22] = (frameTag >>> 16) & 0xff;
  return bytes;
}

function lossyWebpWithCorruptFirstPartition(): Uint8Array {
  const bytes = tinyLossyWebp();
  bytes[30] = 0xff;
  return bytes;
}

function lossyWebpWithCorruptTokenPartition(): Uint8Array {
  const bytes = patternedLossyWebp();
  const payloadStart = 20;
  const frameTag = (bytes[payloadStart] ?? 0)
    + ((bytes[payloadStart + 1] ?? 0) << 8)
    + ((bytes[payloadStart + 2] ?? 0) << 16);
  const tokenStart = payloadStart + 10 + (frameTag >>> 5);
  bytes.fill(0xff, tokenStart, payloadStart + 180);
  return bytes;
}

function extendedTinyWebp(): Uint8Array {
  const imageChunk = tinyWebp().slice(12);
  const bytes = Buffer.alloc(30 + imageChunk.length);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WEBP', 8, 'ascii');
  bytes.write('VP8X', 12, 'ascii');
  bytes.writeUInt32LE(10, 16);
  imageChunk.forEach((value, index) => { bytes[30 + index] = value; });
  return bytes;
}

test('parses task headings and normalizes supported states', () => {
  const tasks = parseProjectTasks('# Tasks\n\n### P0-001 — Ship it\n\n- **State:** in progress\n- **Objective:** Finish safely.\n');
  assert.deepEqual(tasks, [{
    id: 'P0-001', title: 'Ship it', state: 'in progress', priority: 'P0', objective: 'Finish safely.',
    parentId: null, acceptanceCriteria: [], attachments: [],
  }]);
  assert.match(formatProjectTask({ title: ' Add model picker ', objective: ' Use the catalog. ', priority: 'P1' }, 'WB-002'), /- \*\*Priority:\*\* P1/);
});

test('round-trips structured tasks and ignores placeholder headings', () => {
  const markdown = `${formatProjectTask({
    title: 'Child task', objective: 'Keep the structure.', priority: 'P1', parentId: 'P0-001',
    acceptanceCriteria: ['First result exists', 'Second result passes'],
  }, 'WB-005', [{ path: '.workbench/task-images/WB-005-01.png', mediaType: 'image/png' }])}\n### P?-NNN — Short outcome\n\n- **State:** pending\n`;
  const tasks = parseProjectTasks(markdown);
  assert.equal(tasks.length, 1);
  assert.deepEqual(tasks[0], {
    id: 'WB-005', title: 'Child task', state: 'pending', priority: 'P1', objective: 'Keep the structure.',
    parentId: 'P0-001', acceptanceCriteria: ['First result exists', 'Second result passes'],
    attachments: [{ path: '.workbench/task-images/WB-005-01.png', mediaType: 'image/png' }],
  });
  assert.equal(nextProjectTaskId([...tasks, { ...tasks[0], id: 'P2-019' }]), 'WB-020');
});

test('preserves legacy random task ids and allows new children to reference them', () => {
  const markdown = `### WB-A1B2C3D4 — Legacy task\n\n- **State:** pending\n- **Objective:** Stay visible.\n`;
  const legacyTask = parseProjectTasks(markdown)[0];
  assert.equal(legacyTask?.id, 'WB-A1B2C3D4');
  const child = formatProjectTask({
    title: 'Child task',
    objective: 'Reference the legacy task.',
    priority: 'P1',
    parentId: 'WB-A1B2C3D4',
  }, 'WB-001');
  assert.equal(parseProjectTasks(`${markdown}\n${child}`)[1]?.parentId, 'WB-A1B2C3D4');
});

test('only parses parent and attachment metadata from their top-level fields', () => {
  const markdown = `### WB-010 — Literal metadata examples

- **State:** pending
- **Priority:** P2
- **Objective:** Explain literal Markdown safely.
- **Acceptance criteria:**
  - [ ] - **Parent:** WB-001
  - [ ] ![Not an attachment](.workbench/task-images/WB-010-01.png)
`;
  const parsed = parseProjectTasks(markdown)[0];
  assert.equal(parsed?.parentId, null);
  assert.deepEqual(parsed?.attachments, []);
  assert.deepEqual(parsed?.acceptanceCriteria, [
    '- **Parent:** WB-001',
    '![Not an attachment](.workbench/task-images/WB-010-01.png)',
  ]);
});

test('validates supported image bytes before workspace filesystem writes', async () => {
  await assert.rejects(validateProjectTaskImage({ bytes: Uint8Array.of(1, 2, 3) }), /PNG, JPEG, or WebP/);
  await assert.rejects(
    validateProjectTaskImage({ bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) }),
    /PNG, JPEG, or WebP/,
  );
  assert.equal((await validateProjectTaskImage({ bytes: tinyPng() })).mediaType, 'image/png');
  assert.equal((await validateProjectTaskImage({ bytes: interlacedTinyPng() })).mediaType, 'image/png');
  assert.equal((await validateProjectTaskImage({ bytes: splitImageDataPng() })).mediaType, 'image/png');
  assert.equal((await validateProjectTaskImage({ bytes: tinyJpeg() })).mediaType, 'image/jpeg');
  assert.equal((await validateProjectTaskImage({ bytes: tinyWebp() })).mediaType, 'image/webp');
  assert.equal((await validateProjectTaskImage({ bytes: transformedLosslessWebp() })).mediaType, 'image/webp');
  assert.equal((await validateProjectTaskImage({ bytes: losslessWebpWithUnusedSimpleSymbol() })).mediaType, 'image/webp');
  assert.equal((await validateProjectTaskImage({ bytes: tinyLossyWebp() })).mediaType, 'image/webp');
  assert.equal((await validateProjectTaskImage({ bytes: patternedLossyWebp() })).mediaType, 'image/webp');
  assert.equal((await validateProjectTaskImage({ bytes: extendedTinyWebp() })).mediaType, 'image/webp');
});

test('rejects JPEGs without decodable tables, scans, and encoded image data', async () => {
  const withoutScan = Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
    0xff, 0xd9,
  ]);
  await assert.rejects(validateProjectTaskImage({ bytes: withoutScan }), /PNG, JPEG, or WebP/);
  await assert.rejects(validateProjectTaskImage({ bytes: tablelessJpeg() }), /PNG, JPEG, or WebP/);
  await assert.rejects(validateProjectTaskImage({ bytes: jpegWithTruncatedScan() }), /PNG, JPEG, or WebP/);
  await assert.rejects(validateProjectTaskImage({ bytes: tinyJpeg().slice(0, -1) }), /PNG, JPEG, or WebP/);
});

test('bounds concurrent compressed-image decoding', async () => {
  const outcomes = await Promise.allSettled(
    Array.from({ length: 9 }, () => validateProjectTaskImage({ bytes: tinyJpeg() })),
  );
  assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 8);
  const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
  assert.match(String(rejected?.status === 'rejected' ? rejected.reason : ''), /Too many task images/);
});

test('rejects PNGs without image data or with corrupted chunk data', async () => {
  const png = tinyPng();
  const withoutImageData = new Uint8Array(45);
  withoutImageData.set(png.slice(0, 33));
  withoutImageData.set(png.slice(-12), 33);
  await assert.rejects(validateProjectTaskImage({ bytes: withoutImageData }), /PNG, JPEG, or WebP/);

  const corruptImageData = Uint8Array.from(png);
  const imageDataType = Buffer.from(corruptImageData).indexOf('IDAT');
  assert.notEqual(imageDataType, -1);
  corruptImageData[imageDataType + 4] ^= 0x01;
  await assert.rejects(validateProjectTaskImage({ bytes: corruptImageData }), /PNG, JPEG, or WebP/);
  await assert.rejects(
    validateProjectTaskImage({ bytes: pngWithImageData(Uint8Array.from({ length: 11 }, () => 0x41)) }),
    /PNG, JPEG, or WebP/,
  );
  await assert.rejects(
    validateProjectTaskImage({ bytes: pngWithImageData(deflateSync(Uint8Array.of(5, 0, 0))) }),
    /PNG, JPEG, or WebP/,
  );
  await assert.rejects(
    validateProjectTaskImage({ bytes: pngWithImageData(deflateSync(Uint8Array.of(0, 0))) }),
    /PNG, JPEG, or WebP/,
  );
});

test('rejects malformed WebP chunks, corrupt VP8 partitions, and oversized bytes before copying', async () => {
  const emptyVp8x = Buffer.alloc(20);
  emptyVp8x.write('RIFF', 0, 'ascii');
  emptyVp8x.writeUInt32LE(12, 4);
  emptyVp8x.write('WEBP', 8, 'ascii');
  emptyVp8x.write('VP8X', 12, 'ascii');
  emptyVp8x.writeUInt32LE(0, 16);
  await assert.rejects(validateProjectTaskImage({ bytes: emptyVp8x }), /PNG, JPEG, or WebP/);
  await assert.rejects(validateProjectTaskImage({ bytes: tinyWebp().slice(0, -1) }), /PNG, JPEG, or WebP/);
  const losslessPayload = tinyWebp().slice(20, 33);
  for (let length = 5; length < losslessPayload.length; length += 1) {
    await assert.rejects(
      validateProjectTaskImage({ bytes: losslessWebpWithPayload(losslessPayload.slice(0, length)) }),
      /PNG, JPEG, or WebP/,
    );
  }
  await assert.rejects(
    validateProjectTaskImage({ bytes: losslessWebpWithPayload(Uint8Array.of(0x2f, 0, 0, 0, 0, 0)) }),
    /PNG, JPEG, or WebP/,
  );
  const validFrameTag = 0x02f0;
  await assert.rejects(validateProjectTaskImage({ bytes: lossyWebpWithFrameTag(validFrameTag | 0x01) }), /PNG, JPEG, or WebP/);
  await assert.rejects(validateProjectTaskImage({ bytes: lossyWebpWithFrameTag(validFrameTag | 0x08) }), /PNG, JPEG, or WebP/);
  await assert.rejects(validateProjectTaskImage({ bytes: lossyWebpWithFrameTag(validFrameTag & ~0x10) }), /PNG, JPEG, or WebP/);
  await assert.rejects(validateProjectTaskImage({ bytes: lossyWebpWithFrameTag(0x10) }), /PNG, JPEG, or WebP/);
  await assert.rejects(validateProjectTaskImage({ bytes: lossyWebpWithFrameTag((49 << 5) | 0x10) }), /PNG, JPEG, or WebP/);
  await assert.rejects(validateProjectTaskImage({ bytes: lossyWebpWithCorruptFirstPartition() }), /PNG, JPEG, or WebP/);
  await assert.rejects(validateProjectTaskImage({ bytes: lossyWebpWithCorruptTokenPartition() }), /PNG, JPEG, or WebP/);

  const oversized = new Uint8Array((5 * 1024 * 1024) + 1);
  Object.defineProperty(oversized, Symbol.iterator, {
    value: () => { throw new Error('Oversized bytes were copied.'); },
  });
  await assert.rejects(validateProjectTaskImage({ bytes: oversized }), /5 MB or smaller/);
});
