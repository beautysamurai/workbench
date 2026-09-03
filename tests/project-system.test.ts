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

function pngChunk(type: string, payload: Uint8Array): Buffer {
  const chunk = Buffer.alloc(payload.length + 12);
  chunk.writeUInt32BE(payload.length, 0);
  chunk.write(type, 4, 'ascii');
  chunk.set(payload, 8);
  chunk.writeUInt32BE(testPngCrc32(chunk.subarray(4, 8 + payload.length)), 8 + payload.length);
  return chunk;
}

function compressibleRgbaPng(width: number, height: number): Uint8Array {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  return Uint8Array.from(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]));
}

function indexedPng(
  width: number,
  bitDepth: 1 | 2 | 4 | 8,
  paletteEntries: number,
  filteredScanlines: Uint8Array,
  interlace = 0,
): Uint8Array {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(1, 4);
  header[8] = bitDepth;
  header[9] = 3;
  header[12] = interlace;
  return Uint8Array.from(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('PLTE', Buffer.alloc(paletteEntries * 3)),
    pngChunk('IDAT', deflateSync(filteredScanlines)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]));
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

function compressibleLosslessWebp(): Uint8Array {
  // Deterministic 2048x2048 transparent lossless image encoded by libwebp in 216 bytes.
  return Uint8Array.from(Buffer.from('UklGRtAAAABXRUJQVlA4TMQAAAAv/8f/EQcQEREQEiT+/24mov8Z//nPf/7zn//85z//+c9//vOf//znP//5z3/+85///Oc///nPf/7zn//85z//+c9//vOf//znP//5z3/+85///Oc///nPf/7zn//85z//+c9//vOf//znP//5z3/+85///Oc///nPf/7zn//85z//+c9//vOf//znP//5z3/+85///Oc///nPf/7zn//85z//+c9//vOf//znP//5z3/+85///Oc///nPf/7zn//85/8e', 'base64'));
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

function alphaLossyWebp(): Uint8Array {
  // Deterministic 2x2 lossy image with a compressed ALPH chunk, encoded by libwebp.
  return Uint8Array.from(Buffer.from('UklGRmgAAABXRUJQVlA4WAoAAAAQAAAAAQAAAQAAQUxQSAUAAAAAAECA/wBWUDggPAAAAPABAJ0BKgIAAgACADQlmAJ0ugADCQb9SAD+9Bfrd6pLfv/mw6oy4HOCDoAujj/q7E+FCCfoUbKJfMAAAA==', 'base64'));
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

function webpChunk(type: string, payload: Uint8Array): Buffer {
  const chunk = Buffer.alloc(8 + payload.length + (payload.length % 2));
  chunk.write(type, 0, 'ascii');
  chunk.writeUInt32LE(payload.length, 4);
  chunk.set(payload, 8);
  return chunk;
}

function webpContainer(chunks: Uint8Array[]): Uint8Array {
  const payload = Buffer.concat(chunks);
  const bytes = Buffer.alloc(12 + payload.length);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WEBP', 8, 'ascii');
  bytes.set(payload, 12);
  return bytes;
}

function webpChunks(bytes: Uint8Array): Buffer[] {
  const chunks: Buffer[] = [];
  let offset = 12;
  while (offset < bytes.length) {
    const length = Buffer.from(bytes).readUInt32LE(offset + 4);
    const end = offset + 8 + length + (length % 2);
    chunks.push(Buffer.from(bytes.slice(offset, end)));
    offset = end;
  }
  assert.equal(offset, bytes.length);
  return chunks;
}

function animatedWebpWithFrameChunks(frameChunks: Uint8Array[]): Uint8Array {
  const alpha = Buffer.from(alphaLossyWebp());
  const canvas = Buffer.from(alpha.subarray(20, 30));
  canvas[0] |= 0x02;
  const frameHeader = Buffer.alloc(16);
  frameHeader.writeUIntLE(1, 6, 3);
  frameHeader.writeUIntLE(1, 9, 3);
  return webpContainer([
    webpChunk('VP8X', canvas),
    webpChunk('ANIM', Buffer.alloc(6)),
    webpChunk('ANMF', Buffer.concat([frameHeader, ...frameChunks])),
  ]);
}

function animatedTinyWebp(
  canvasWidth = 1,
  canvasHeight = 1,
  frameX = 0,
  frameY = 0,
  includeCanvas = true,
): Uint8Array {
  assert.equal(frameX % 2, 0);
  assert.equal(frameY % 2, 0);
  const canvas = Buffer.alloc(10);
  canvas[0] = 0x02;
  canvas.writeUIntLE(canvasWidth - 1, 4, 3);
  canvas.writeUIntLE(canvasHeight - 1, 7, 3);
  const frameHeader = Buffer.alloc(16);
  frameHeader.writeUIntLE(frameX / 2, 0, 3);
  frameHeader.writeUIntLE(frameY / 2, 3, 3);
  const frame = Buffer.concat([frameHeader, tinyWebp().slice(12)]);
  return webpContainer([
    ...(includeCanvas ? [webpChunk('VP8X', canvas)] : []),
    webpChunk('ANIM', Buffer.alloc(6)),
    webpChunk('ANMF', frame),
  ]);
}

function animatedAlphaWebp(): Uint8Array {
  const alpha = Buffer.from(alphaLossyWebp());
  const canvas = Buffer.from(alpha.subarray(20, 30));
  canvas[0] |= 0x02;
  const frameHeader = Buffer.alloc(16);
  frameHeader.writeUIntLE(1, 6, 3);
  frameHeader.writeUIntLE(1, 9, 3);
  return webpContainer([
    webpChunk('VP8X', canvas),
    webpChunk('ANIM', Buffer.alloc(6)),
    webpChunk('ANMF', Buffer.concat([frameHeader, alpha.subarray(30)])),
  ]);
}

function lossyWebpWithAlphaPayload(payload: Uint8Array): Uint8Array {
  const lossy = Buffer.from(tinyLossyWebp());
  const vp8Length = lossy.readUInt32LE(16);
  const canvas = Buffer.alloc(10);
  canvas[0] = 0x10;
  return webpContainer([
    webpChunk('VP8X', canvas),
    webpChunk('ALPH', payload),
    lossy.subarray(12, 20 + vp8Length + (vp8Length % 2)),
  ]);
}

function animatedWebpWithAlphaPayload(payload: Uint8Array): Uint8Array {
  const alpha = Buffer.from(lossyWebpWithAlphaPayload(payload));
  const canvas = Buffer.from(alpha.subarray(20, 30));
  canvas[0] |= 0x02;
  return webpContainer([
    webpChunk('VP8X', canvas),
    webpChunk('ANIM', Buffer.alloc(6)),
    webpChunk('ANMF', Buffer.concat([Buffer.alloc(16), alpha.subarray(30)])),
  ]);
}

function losslessWebpWithDimensions(width: number, height: number): Uint8Array {
  const bytes = Buffer.from(tinyWebp());
  bytes.writeUInt32LE(((width - 1) | ((height - 1) << 14)) >>> 0, 21);
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

test('keeps arbitrary legacy task ids visible while ignoring template placeholders', () => {
  const markdown = `### TASK-A — Named legacy task

- **State:** pending

### a50e8400-e29b-41d4-a716-446655440000 — UUID legacy task

- **State:** done

### WB-NNN — Template example

- **State:** pending

### P?-NNN — Template placeholder

- **State:** pending
`;
  const tasks = parseProjectTasks(markdown);
  assert.deepEqual(tasks.map((task) => task.id), ['TASK-A', 'a50e8400-e29b-41d4-a716-446655440000']);
  assert.equal(nextProjectTaskId(tasks), 'WB-001');
  const child = formatProjectTask({
    title: 'Named child',
    priority: 'P1',
    parentId: 'TASK-A',
  }, 'WB-001');
  assert.equal(parseProjectTasks(`${markdown}\n${child}`).at(-1)?.parentId, 'TASK-A');
  assert.throws(() => formatProjectTask({
    title: 'Template child',
    priority: 'P1',
    parentId: 'WB-NNN',
  }, 'WB-001'), /Parent task id is invalid/);
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
  assert.equal((await validateProjectTaskImage({ bytes: compressibleLosslessWebp() })).mediaType, 'image/webp');
  assert.equal((await validateProjectTaskImage({ bytes: losslessWebpWithDimensions(8192, 4882) })).mediaType, 'image/webp');
  assert.equal((await validateProjectTaskImage({ bytes: transformedLosslessWebp() })).mediaType, 'image/webp');
  assert.equal((await validateProjectTaskImage({ bytes: losslessWebpWithUnusedSimpleSymbol() })).mediaType, 'image/webp');
  assert.equal((await validateProjectTaskImage({ bytes: tinyLossyWebp() })).mediaType, 'image/webp');
  assert.equal((await validateProjectTaskImage({ bytes: patternedLossyWebp() })).mediaType, 'image/webp');
  assert.equal((await validateProjectTaskImage({ bytes: alphaLossyWebp() })).mediaType, 'image/webp');
  assert.equal((await validateProjectTaskImage({ bytes: extendedTinyWebp() })).mediaType, 'image/webp');
  assert.equal((await validateProjectTaskImage({ bytes: animatedTinyWebp() })).mediaType, 'image/webp');
  assert.equal((await validateProjectTaskImage({ bytes: animatedAlphaWebp() })).mediaType, 'image/webp');
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

test('bounds concurrent JPEG and lossless WebP decoding', async () => {
  const jpegOutcomes = await Promise.allSettled(
    Array.from({ length: 9 }, () => validateProjectTaskImage({ bytes: tinyJpeg() })),
  );
  assert.equal(jpegOutcomes.filter((outcome) => outcome.status === 'fulfilled').length, 8);
  const rejectedJpeg = jpegOutcomes.find((outcome) => outcome.status === 'rejected');
  assert.match(String(rejectedJpeg?.status === 'rejected' ? rejectedJpeg.reason : ''), /Too many task images/);

  const losslessOutcomes = await Promise.allSettled(
    Array.from({ length: 9 }, () => validateProjectTaskImage({ bytes: tinyWebp() })),
  );
  assert.equal(losslessOutcomes.filter((outcome) => outcome.status === 'fulfilled').length, 8);
  const rejectedLossless = losslessOutcomes.find((outcome) => outcome.status === 'rejected');
  assert.match(String(rejectedLossless?.status === 'rejected' ? rejectedLossless.reason : ''), /Too many task images/);
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

test('reconstructs indexed PNG scanlines and rejects missing palette entries', async () => {
  assert.equal((await validateProjectTaskImage({
    bytes: indexedPng(1, 8, 1, Uint8Array.of(0, 0)),
  })).mediaType, 'image/png');
  await assert.rejects(
    validateProjectTaskImage({ bytes: indexedPng(1, 8, 1, Uint8Array.of(0, 1)) }),
    /PNG, JPEG, or WebP/,
  );
  await assert.rejects(
    validateProjectTaskImage({ bytes: indexedPng(1, 1, 1, Uint8Array.of(0, 0x80), 1) }),
    /PNG, JPEG, or WebP/,
  );
  assert.equal((await validateProjectTaskImage({
    bytes: indexedPng(2, 8, 2, Uint8Array.of(1, 1, 0xff)),
  })).mediaType, 'image/png');
  await assert.rejects(
    validateProjectTaskImage({ bytes: indexedPng(2, 8, 2, Uint8Array.of(1, 1, 1)) }),
    /PNG, JPEG, or WebP/,
  );
});

test('inflates highly compressible PNG image data without blocking the calling thread', async () => {
  const png = compressibleRgbaPng(2048, 2048);
  assert.ok(png.length < 5 * 1024 * 1024);
  const validation = validateProjectTaskImage({ bytes: png });
  const firstResult = await Promise.race([
    validation.then(() => 'validated'),
    new Promise<string>((resolve) => queueMicrotask(() => resolve('yielded'))),
  ]);
  assert.equal(firstResult, 'yielded');
  assert.equal((await validation).mediaType, 'image/png');
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
  await assert.rejects(validateProjectTaskImage({ bytes: lossyWebpWithAlphaPayload(new Uint8Array()) }), /PNG, JPEG, or WebP/);
  await assert.rejects(validateProjectTaskImage({ bytes: animatedWebpWithAlphaPayload(new Uint8Array()) }), /PNG, JPEG, or WebP/);
  await assert.rejects(validateProjectTaskImage({ bytes: animatedTinyWebp(1, 1, 2) }), /PNG, JPEG, or WebP/);
  await assert.rejects(validateProjectTaskImage({ bytes: animatedTinyWebp(1, 1, 0, 0, false) }), /PNG, JPEG, or WebP/);

  const oversized = new Uint8Array((5 * 1024 * 1024) + 1);
  Object.defineProperty(oversized, Symbol.iterator, {
    value: () => { throw new Error('Oversized bytes were copied.'); },
  });
  await assert.rejects(validateProjectTaskImage({ bytes: oversized }), /5 MB or smaller/);
});

test('rejects out-of-order and duplicate WebP alpha chunks tolerated by the decoder', async () => {
  const [canvas, alpha, image] = webpChunks(alphaLossyWebp());
  assert.ok(canvas && alpha && image);
  for (const bytes of [
    webpContainer([canvas, image, alpha]),
    webpContainer([canvas, alpha, alpha, image]),
    animatedWebpWithFrameChunks([image, alpha]),
    animatedWebpWithFrameChunks([alpha, alpha, image]),
  ]) {
    await assert.rejects(validateProjectTaskImage({ bytes }), /PNG, JPEG, or WebP/);
  }
});
