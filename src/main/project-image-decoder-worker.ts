import { parentPort, workerData } from 'node:worker_threads';
import { TextDecoder } from 'node:util';
import { inflateSync } from 'node:zlib';
import { decode as decodeJpeg } from 'jpeg-js';
import * as webp from 'webp-wasm';

const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_PNG_INFLATED_BYTES = 160 * 1024 * 1024;
const MAX_PNG_ANIMATION_FRAMES = 128;
const MAX_PNG_COMPRESSED_METADATA_STREAMS = 128;
const MAX_PNG_METADATA_INFLATED_BYTES = 32 * 1024 * 1024;
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

interface PngImageDataStream {
  compressed: Uint8Array;
  passes: PngScanlinePass[];
}

interface PngCompressedMetadata {
  compressed: Uint8Array;
  kind: 'profile' | 'latin1' | 'utf8';
}

interface PngDecoderRequest {
  kind: 'png';
  animationFrames: PngImageDataStream[];
  bitDepth: number;
  colorType: number;
  compressed: Uint8Array;
  compressedMetadata: PngCompressedMetadata[];
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

interface ValidatedPngStreamSize {
  inflatedBytes: number;
  pixels: number;
}

function validPngImageStream(
  request: Partial<PngDecoderRequest>,
  stream: Partial<PngImageDataStream>,
  channels: number,
  maxInflatedBytes: number,
  maxPixels: number,
): ValidatedPngStreamSize | null {
  if (!(stream.compressed instanceof Uint8Array)
    || stream.compressed.length < 1
    || stream.compressed.length > MAX_TASK_IMAGE_BYTES
    || !Array.isArray(stream.passes)
    || stream.passes.length < 1
    || stream.passes.length > 7) return null;

  let expectedBytes = 0;
  let pixels = 0;
  for (const pass of stream.passes) {
    if (!pass
      || !Number.isSafeInteger(pass.width)
      || !Number.isSafeInteger(pass.rowBytes)
      || !Number.isSafeInteger(pass.rowCount)
      || pass.width < 1
      || pass.rowBytes < 1
      || pass.rowCount < 1
      || pass.rowBytes !== Math.ceil((pass.width * channels * (request.bitDepth ?? 0)) / 8)) return null;
    const passBytes = (pass.rowBytes + 1) * pass.rowCount;
    const passPixels = pass.width * pass.rowCount;
    if (!Number.isSafeInteger(passBytes)
      || !Number.isSafeInteger(passPixels)
      || expectedBytes > maxInflatedBytes - passBytes
      || pixels > maxPixels - passPixels) return null;
    expectedBytes += passBytes;
    pixels += passPixels;
  }

  try {
    const compressed = Uint8Array.from(stream.compressed);
    const result = inflateSync(compressed, {
      info: true,
      maxOutputLength: expectedBytes,
    }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
    if (result.engine.bytesWritten !== compressed.length || result.buffer.length !== expectedBytes) return null;
    let offset = 0;
    for (const pass of stream.passes) {
      let previous = new Uint8Array(pass.rowBytes);
      for (let row = 0; row < pass.rowCount; row += 1) {
        if (request.colorType !== 3) {
          if ((result.buffer[offset] ?? 5) > 4) return null;
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
        )) return null;
        previous = reconstructed;
        offset += pass.rowBytes + 1;
      }
    }
    return offset === result.buffer.length ? { inflatedBytes: expectedBytes, pixels } : null;
  } catch {
    return null;
  }
}

function validPngCompressedMetadata(streams: PngCompressedMetadata[]): boolean {
  const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
  let inflatedBytes = 0;
  for (const stream of streams) {
    if (!stream
      || !(stream.compressed instanceof Uint8Array)
      || (stream.kind !== 'profile' && stream.kind !== 'latin1' && stream.kind !== 'utf8')
      || inflatedBytes >= MAX_PNG_METADATA_INFLATED_BYTES) return false;
    try {
      const compressed = Uint8Array.from(stream.compressed);
      const result = inflateSync(compressed, {
        info: true,
        maxOutputLength: MAX_PNG_METADATA_INFLATED_BYTES - inflatedBytes,
      }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
      if (result.engine.bytesWritten !== compressed.length
        || (stream.kind === 'profile' && result.buffer.length === 0)
        || (stream.kind !== 'profile' && result.buffer.includes(0))) return false;
      if (stream.kind === 'utf8') utf8Decoder.decode(result.buffer);
      inflatedBytes += result.buffer.length;
    } catch {
      return false;
    }
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
  if (!Number.isSafeInteger(request.colorType)
    || !channels
    || !Number.isSafeInteger(request.bitDepth)
    || !(validBitDepths[request.colorType ?? -1]?.includes(request.bitDepth ?? 0) ?? false)
    || !Number.isSafeInteger(request.paletteEntries)
    || (request.paletteEntries ?? -1) < 0
    || (request.paletteEntries ?? 257) > 256
    || (request.colorType === 3 && ((request.paletteEntries ?? 0) < 1
      || (request.paletteEntries ?? 257) > (2 ** (request.bitDepth ?? 0))))
    || !Array.isArray(request.animationFrames)
    || request.animationFrames.length > MAX_PNG_ANIMATION_FRAMES
    || !Array.isArray(request.compressedMetadata)
    || request.compressedMetadata.length > MAX_PNG_COMPRESSED_METADATA_STREAMS) return false;

  const streams: Array<Partial<PngImageDataStream>> = [
    { compressed: request.compressed, passes: request.passes },
    ...request.animationFrames,
  ];
  let compressedBytes = 0;
  let inflatedBytes = 0;
  let pixels = 0;
  for (const stream of streams) {
    if (!(stream.compressed instanceof Uint8Array)
      || compressedBytes > MAX_TASK_IMAGE_BYTES - stream.compressed.length) return false;
    const size = validPngImageStream(
      request,
      stream,
      channels,
      MAX_PNG_INFLATED_BYTES - inflatedBytes,
      MAX_IMAGE_PIXELS - pixels,
    );
    if (!size) return false;
    compressedBytes += stream.compressed.length;
    inflatedBytes += size.inflatedBytes;
    pixels += size.pixels;
  }
  for (const metadata of request.compressedMetadata) {
    if (!(metadata?.compressed instanceof Uint8Array)
      || compressedBytes > MAX_TASK_IMAGE_BYTES - metadata.compressed.length) return false;
    compressedBytes += metadata.compressed.length;
  }
  return validPngCompressedMetadata(request.compressedMetadata);
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
