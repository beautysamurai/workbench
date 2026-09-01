import { parentPort, workerData } from 'node:worker_threads';
import { decode as decodeJpeg } from 'jpeg-js';
import * as webp from 'webp-wasm';

const MAX_IMAGE_PIXELS = 40_000_000;

interface DecoderRequest {
  kind: 'jpeg' | 'webp';
  images: Uint8Array[];
}

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

async function decodeImage(kind: DecoderRequest['kind'], bytes: Uint8Array): Promise<DecodedImageMetadata> {
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

async function run(): Promise<void> {
  const request = workerData as Partial<DecoderRequest>;
  if ((request.kind !== 'jpeg' && request.kind !== 'webp')
    || !Array.isArray(request.images) || !request.images.length || request.images.length > 128
    || request.images.some((image) => !(image instanceof Uint8Array))) {
    throw new Error('The image decode request is invalid.');
  }
  const images: DecodedImageMetadata[] = [];
  for (const image of request.images) {
    images.push(await decodeImage(request.kind, image));
  }
  parentPort?.postMessage({ images });
}

void run().catch(() => {
  parentPort?.postMessage({ images: [] });
}).finally(() => {
  parentPort?.close();
});
