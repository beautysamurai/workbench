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
}

interface PngDecoderRequest {
  kind: 'png';
  compressed: Uint8Array;
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

function validPngImageData(request: Partial<PngDecoderRequest>): boolean {
  if (!(request.compressed instanceof Uint8Array)
    || request.compressed.length < 1
    || request.compressed.length > MAX_TASK_IMAGE_BYTES
    || !Array.isArray(request.passes)
    || request.passes.length < 1
    || request.passes.length > 7) return false;

  let expectedBytes = 0;
  for (const pass of request.passes) {
    if (!pass
      || !Number.isSafeInteger(pass.rowBytes)
      || !Number.isSafeInteger(pass.rowCount)
      || pass.rowBytes < 1
      || pass.rowCount < 1) return false;
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
      for (let row = 0; row < pass.rowCount; row += 1) {
        if ((result.buffer[offset] ?? 5) > 4) return false;
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
