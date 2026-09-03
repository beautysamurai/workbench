import { parentPort, workerData } from 'node:worker_threads';
import { inflateSync } from 'node:zlib';
import { decode as decodeJpeg } from 'jpeg-js';
import * as webp from 'webp-wasm';

const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_PNG_INFLATED_BYTES = 160 * 1024 * 1024;
const MAX_TASK_IMAGE_BYTES = 5 * 1024 * 1024;

interface CompressedImageDecoderRequest {
  kind: 'jpeg' | 'webp';
  images: Uint8Array[];
}

interface PngScanlinePass {
  rowBytes: number;
  rowCount: number;
  width: number;
}

interface PngDecoderRequest {
  kind: 'png';
  bitDepth: number;
  colorType: number;
  compressed: Uint8Array;
  paletteEntries: number;
  passes: PngScanlinePass[];
}

type DecoderRequest = CompressedImageDecoderRequest | PngDecoderRequest;

interface DecodedImage {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

interface DecodedImageMetadata {
  width: number;
  height: number;
}

function decodedImageMetadata(value: unknown): DecodedImageMetadata {
  const image = value as Partial<DecodedImage>;
  const width = image.width ?? 0;
  const height = image.height ?? 0;
  const pixels = width * height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || width < 1 || height < 1 || width > 16_384 || height > 16_384
    || !Number.isSafeInteger(pixels) || pixels > MAX_IMAGE_PIXELS
    || (!(image.data instanceof Uint8Array) && !(image.data instanceof Uint8ClampedArray))
    || image.data.length !== pixels * 4) {
    throw new Error('The image decoder returned invalid pixel data.');
  }
  return { width, height };
}

async function decodeImage(kind: CompressedImageDecoderRequest['kind'], bytes: Uint8Array): Promise<DecodedImageMetadata> {
  const exactBytes = Uint8Array.from(bytes);
  if (kind === 'jpeg') {
    return decodedImageMetadata(decodeJpeg(exactBytes, {
      formatAsRGBA: true,
      maxMemoryUsageInMB: 256,
      maxResolutionInMP: 40,
      tolerantDecoding: false,
      useTArray: true,
    }));
  }
  return decodedImageMetadata(await webp.decode(exactBytes.buffer));
}

function paethPredictor(left: number, above: number, upperLeft: number): number {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function reconstructPngRow(
  bytes: Uint8Array,
  offset: number,
  rowBytes: number,
  bytesPerPixel: number,
  previous: Uint8Array,
): Uint8Array | null {
  const filter = bytes[offset] ?? 5;
  if (filter > 4) return null;
  const row = new Uint8Array(rowBytes);
  for (let index = 0; index < rowBytes; index += 1) {
    const encoded = bytes[offset + 1 + index] ?? 0;
    const left = index >= bytesPerPixel ? row[index - bytesPerPixel] ?? 0 : 0;
    const above = previous[index] ?? 0;
    const upperLeft = index >= bytesPerPixel ? previous[index - bytesPerPixel] ?? 0 : 0;
    const predictor = filter === 1
      ? left
      : filter === 2
        ? above
        : filter === 3
          ? Math.floor((left + above) / 2)
          : filter === 4
            ? paethPredictor(left, above, upperLeft)
            : 0;
    row[index] = (encoded + predictor) & 0xff;
  }
  return row;
}

function hasValidPaletteSamples(row: Uint8Array, width: number, bitDepth: number, entries: number): boolean {
  const mask = (1 << bitDepth) - 1;
  for (let sample = 0; sample < width; sample += 1) {
    const bitOffset = sample * bitDepth;
    const shift = 8 - bitDepth - (bitOffset % 8);
    const paletteIndex = ((row[Math.floor(bitOffset / 8)] ?? 0) >>> shift) & mask;
    if (paletteIndex >= entries) return false;
  }
  return true;
}

function validPngImageData(request: Partial<PngDecoderRequest>): boolean {
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[request.colorType ?? -1];
  const validBitDepths: Record<number, number[]> = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16],
  };
  if (!(request.compressed instanceof Uint8Array)
    || request.compressed.length < 1
    || request.compressed.length > MAX_TASK_IMAGE_BYTES
    || !Number.isSafeInteger(request.colorType)
    || !channels
    || !Number.isSafeInteger(request.bitDepth)
    || !(validBitDepths[request.colorType ?? -1]?.includes(request.bitDepth ?? 0) ?? false)
    || !Number.isSafeInteger(request.paletteEntries)
    || (request.paletteEntries ?? -1) < 0
    || (request.paletteEntries ?? 257) > 256
    || (request.colorType === 3 && ((request.paletteEntries ?? 0) < 1
      || (request.paletteEntries ?? 257) > (2 ** (request.bitDepth ?? 0))))
    || !Array.isArray(request.passes)
    || request.passes.length < 1
    || request.passes.length > 7) return false;

  let expectedBytes = 0;
  for (const pass of request.passes) {
    if (!pass
      || !Number.isSafeInteger(pass.width)
      || !Number.isSafeInteger(pass.rowBytes)
      || !Number.isSafeInteger(pass.rowCount)
      || pass.width < 1
      || pass.rowBytes < 1
      || pass.rowCount < 1
      || pass.rowBytes !== Math.ceil((pass.width * channels * (request.bitDepth ?? 0)) / 8)) return false;
    const passBytes = (pass.rowBytes + 1) * pass.rowCount;
    if (!Number.isSafeInteger(passBytes)
      || expectedBytes > MAX_PNG_INFLATED_BYTES - passBytes) return false;
    expectedBytes += passBytes;
  }

  try {
    const compressed = Uint8Array.from(request.compressed);
    const result = inflateSync(compressed, {
      info: true,
      maxOutputLength: expectedBytes,
    }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
    if (result.engine.bytesWritten !== compressed.length || result.buffer.length !== expectedBytes) return false;
    let offset = 0;
    for (const pass of request.passes) {
      let previous = new Uint8Array(pass.rowBytes);
      for (let row = 0; row < pass.rowCount; row += 1) {
        if (request.colorType !== 3) {
          if ((result.buffer[offset] ?? 5) > 4) return false;
          offset += pass.rowBytes + 1;
          continue;
        }
        const reconstructed = reconstructPngRow(
          result.buffer,
          offset,
          pass.rowBytes,
          Math.max(1, Math.ceil((channels * (request.bitDepth ?? 0)) / 8)),
          previous,
        );
        if (!reconstructed || !hasValidPaletteSamples(
          reconstructed,
          pass.width,
          request.bitDepth ?? 0,
          request.paletteEntries ?? 0,
        )) return false;
        previous = reconstructed;
        offset += pass.rowBytes + 1;
      }
    }
    return offset === result.buffer.length;
  } catch {
    return false;
  }
}

async function run(): Promise<void> {
  const request = workerData as Partial<DecoderRequest>;
  if (request.kind === 'png') {
    parentPort?.postMessage({ valid: validPngImageData(request) });
    return;
  }
  if ((request.kind !== 'jpeg' && request.kind !== 'webp')
    || !Array.isArray(request.images)
    || !request.images.length
    || request.images.length > 128
    || request.images.some((image) => !(image instanceof Uint8Array))) {
    throw new Error('The image decode request is invalid.');
  }
  const images: DecodedImageMetadata[] = [];
  for (const image of request.images) {
    images.push(await decodeImage(request.kind, image));
  }
  parentPort?.postMessage({ valid: true, images });
}

void run().catch(() => {
  parentPort?.postMessage({ valid: false });
}).finally(() => {
  parentPort?.close();
});
