const CODE_LENGTH_ORDER = [17, 18, 0, 1, 2, 3, 4, 5, 16, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const CODE_LENGTH_EXTRA_BITS = [2, 3, 7];
const CODE_LENGTH_REPEAT_OFFSETS = [3, 3, 11];
const MAX_HUFFMAN_BITS = 15;
const MAX_COLOR_CACHE_BITS = 11;
const NUM_LITERAL_CODES = 256;
const NUM_LENGTH_CODES = 24;

// VP8L maps the first 120 distance codes onto nearby two-dimensional pixels.
// This is the canonical table from the WebP lossless bitstream specification.
const CODE_TO_PLANE = Uint8Array.from([
  0x18, 0x07, 0x17, 0x19, 0x28, 0x06, 0x27, 0x29, 0x16, 0x1a,
  0x26, 0x2a, 0x38, 0x05, 0x37, 0x39, 0x15, 0x1b, 0x36, 0x3a,
  0x25, 0x2b, 0x48, 0x04, 0x47, 0x49, 0x14, 0x1c, 0x35, 0x3b,
  0x46, 0x4a, 0x24, 0x2c, 0x58, 0x45, 0x4b, 0x34, 0x3c, 0x03,
  0x57, 0x59, 0x13, 0x1d, 0x56, 0x5a, 0x23, 0x2d, 0x44, 0x4c,
  0x55, 0x5b, 0x33, 0x3d, 0x68, 0x02, 0x67, 0x69, 0x12, 0x1e,
  0x66, 0x6a, 0x22, 0x2e, 0x54, 0x5c, 0x43, 0x4d, 0x65, 0x6b,
  0x32, 0x3e, 0x78, 0x01, 0x77, 0x79, 0x53, 0x5d, 0x11, 0x1f,
  0x64, 0x6c, 0x42, 0x4e, 0x76, 0x7a, 0x21, 0x2f, 0x75, 0x7b,
  0x31, 0x3f, 0x63, 0x6d, 0x52, 0x5e, 0x00, 0x74, 0x7c, 0x41,
  0x4f, 0x10, 0x20, 0x62, 0x6e, 0x30, 0x73, 0x7d, 0x51, 0x5f,
  0x40, 0x72, 0x7e, 0x61, 0x6f, 0x50, 0x71, 0x7f, 0x60, 0x70,
]);

class InvalidVp8l extends Error {}

class Vp8lBitReader {
  private bitPosition: number;

  private readonly bitEnd: number;

  constructor(
    private readonly bytes: Uint8Array,
    start: number,
    length: number,
  ) {
    this.bitPosition = start * 8;
    this.bitEnd = (start + length) * 8;
  }

  read(bitCount: number): number {
    if (bitCount < 0 || bitCount > 24 || this.bitPosition + bitCount > this.bitEnd) {
      throw new InvalidVp8l();
    }
    let value = 0;
    for (let bit = 0; bit < bitCount; bit += 1) {
      const byte = this.bytes[this.bitPosition >>> 3] ?? 0;
      value |= ((byte >>> (this.bitPosition & 7)) & 1) << bit;
      this.bitPosition += 1;
    }
    return value;
  }
}

interface HuffmanCode {
  singleSymbol: number | null;
  symbolsByLength: Array<Map<number, number> | undefined>;
  maxLength: number;
}

type HuffmanGroup = [HuffmanCode, HuffmanCode, HuffmanCode, HuffmanCode, HuffmanCode];

interface HuffmanMetadata {
  groups: Map<number, HuffmanGroup>;
  huffmanImage: Uint16Array | null;
  huffmanImageWidth: number;
  huffmanPrecision: number;
  colorCacheBits: number;
}

function reverseBits(value: number, length: number): number {
  let reversed = 0;
  for (let bit = 0; bit < length; bit += 1) {
    reversed = (reversed << 1) | ((value >>> bit) & 1);
  }
  return reversed;
}

function buildHuffmanCode(codeLengths: Uint8Array, maximumLength = MAX_HUFFMAN_BITS): HuffmanCode {
  const counts = new Uint32Array(maximumLength + 1);
  let symbolCount = 0;
  let singleSymbol: number | null = null;
  let maxLength = 0;
  for (let symbol = 0; symbol < codeLengths.length; symbol += 1) {
    const length = codeLengths[symbol] ?? 0;
    if (length > maximumLength) throw new InvalidVp8l();
    if (!length) continue;
    counts[length] += 1;
    symbolCount += 1;
    singleSymbol = symbol;
    maxLength = Math.max(maxLength, length);
  }
  if (symbolCount === 0) throw new InvalidVp8l();
  if (symbolCount === 1) {
    if (maxLength !== 1) throw new InvalidVp8l();
    return { singleSymbol, symbolsByLength: [], maxLength: 0 };
  }

  let openNodes = 1;
  for (let length = 1; length <= maximumLength; length += 1) {
    openNodes = (openNodes * 2) - (counts[length] ?? 0);
    if (openNodes < 0) throw new InvalidVp8l();
  }
  if (openNodes !== 0) throw new InvalidVp8l();

  const nextCode = new Uint32Array(maximumLength + 1);
  let code = 0;
  for (let length = 1; length <= maximumLength; length += 1) {
    code = (code + (counts[length - 1] ?? 0)) << 1;
    nextCode[length] = code;
  }
  const symbolsByLength: Array<Map<number, number> | undefined> = [];
  for (let symbol = 0; symbol < codeLengths.length; symbol += 1) {
    const length = codeLengths[symbol] ?? 0;
    if (!length) continue;
    const canonicalCode = nextCode[length] ?? 0;
    nextCode[length] = canonicalCode + 1;
    const streamCode = reverseBits(canonicalCode, length);
    const symbols = symbolsByLength[length] ?? new Map<number, number>();
    symbols.set(streamCode, symbol);
    symbolsByLength[length] = symbols;
  }
  return { singleSymbol: null, symbolsByLength, maxLength };
}

function readHuffmanSymbol(reader: Vp8lBitReader, code: HuffmanCode): number {
  if (code.singleSymbol !== null) return code.singleSymbol;
  let streamCode = 0;
  for (let length = 1; length <= code.maxLength; length += 1) {
    streamCode |= reader.read(1) << (length - 1);
    const symbol = code.symbolsByLength[length]?.get(streamCode);
    if (symbol !== undefined) return symbol;
  }
  throw new InvalidVp8l();
}

function readHuffmanCode(reader: Vp8lBitReader, alphabetSize: number): HuffmanCode {
  const codeLengths = new Uint8Array(alphabetSize);
  if (reader.read(1)) {
    const symbolCount = reader.read(1) + 1;
    const firstSymbolBitCount = reader.read(1) ? 8 : 1;
    const firstSymbol = reader.read(firstSymbolBitCount);
    if (firstSymbol >= alphabetSize) throw new InvalidVp8l();
    codeLengths[firstSymbol] = 1;
    if (symbolCount === 2) {
      const secondSymbol = reader.read(8);
      if (secondSymbol >= alphabetSize) throw new InvalidVp8l();
      codeLengths[secondSymbol] = 1;
    }
    return buildHuffmanCode(codeLengths);
  }

  const codeLengthCodeLengths = new Uint8Array(19);
  const codeLengthCodeCount = reader.read(4) + 4;
  for (let index = 0; index < codeLengthCodeCount; index += 1) {
    codeLengthCodeLengths[CODE_LENGTH_ORDER[index] ?? 0] = reader.read(3);
  }
  const codeLengthCode = buildHuffmanCode(codeLengthCodeLengths, 7);
  const usesMaximumSymbols = reader.read(1) === 1;
  const maximumSymbolBitCount = usesMaximumSymbols ? 2 + (2 * reader.read(3)) : 0;
  const maximumSymbols = usesMaximumSymbols ? 2 + reader.read(maximumSymbolBitCount) : alphabetSize;
  if (maximumSymbols > alphabetSize) throw new InvalidVp8l();

  let outputSymbol = 0;
  let encodedSymbol = 0;
  let previousLength = 8;
  while (outputSymbol < alphabetSize && encodedSymbol < maximumSymbols) {
    encodedSymbol += 1;
    const lengthCode = readHuffmanSymbol(reader, codeLengthCode);
    if (lengthCode < 16) {
      codeLengths[outputSymbol] = lengthCode;
      outputSymbol += 1;
      if (lengthCode) previousLength = lengthCode;
      continue;
    }
    const repeatSlot = lengthCode - 16;
    const extraBits = CODE_LENGTH_EXTRA_BITS[repeatSlot];
    const repeatOffset = CODE_LENGTH_REPEAT_OFFSETS[repeatSlot];
    if (extraBits === undefined || repeatOffset === undefined) throw new InvalidVp8l();
    const repeat = reader.read(extraBits) + repeatOffset;
    if (outputSymbol + repeat > alphabetSize) throw new InvalidVp8l();
    codeLengths.fill(lengthCode === 16 ? previousLength : 0, outputSymbol, outputSymbol + repeat);
    outputSymbol += repeat;
  }
  return buildHuffmanCode(codeLengths);
}

function subSampleSize(size: number, bits: number): number {
  return Math.floor((size + (1 << bits) - 1) / (1 << bits));
}

function prefixValue(reader: Vp8lBitReader, prefixCode: number): number {
  if (prefixCode < 4) return prefixCode + 1;
  const extraBits = (prefixCode - 2) >>> 1;
  const offset = (2 + (prefixCode & 1)) << extraBits;
  return offset + reader.read(extraBits) + 1;
}

function planeCodeToDistance(width: number, planeCode: number): number {
  if (planeCode > CODE_TO_PLANE.length) return planeCode - CODE_TO_PLANE.length;
  const mapped = CODE_TO_PLANE[planeCode - 1];
  if (mapped === undefined) throw new InvalidVp8l();
  const distance = (mapped >>> 4) * width + 8 - (mapped & 0x0f);
  return Math.max(distance, 1);
}

function colorCacheKey(pixel: number, bits: number): number {
  return Math.imul(pixel, 0x1e35a7bd) >>> (32 - bits);
}

function groupForPixel(metadata: HuffmanMetadata, width: number, position: number): HuffmanGroup {
  let groupId = 0;
  if (metadata.huffmanImage) {
    const x = position % width;
    const y = Math.floor(position / width);
    const imageX = x >>> metadata.huffmanPrecision;
    const imageY = y >>> metadata.huffmanPrecision;
    groupId = metadata.huffmanImage[(imageY * metadata.huffmanImageWidth) + imageX] ?? -1;
  }
  const group = metadata.groups.get(groupId);
  if (!group) throw new InvalidVp8l();
  return group;
}

function decodeImageData(
  reader: Vp8lBitReader,
  width: number,
  height: number,
  metadata: HuffmanMetadata,
  collectPixels: boolean,
): Uint32Array | null {
  const totalPixels = width * height;
  const pixels = collectPixels ? new Uint32Array(totalPixels) : null;
  const cache = metadata.colorCacheBits ? new Uint32Array(1 << metadata.colorCacheBits) : null;
  let position = 0;
  while (position < totalPixels) {
    const group = groupForPixel(metadata, width, position);
    const greenCode = readHuffmanSymbol(reader, group[0]);
    if (greenCode < NUM_LITERAL_CODES) {
      const red = readHuffmanSymbol(reader, group[1]);
      const blue = readHuffmanSymbol(reader, group[2]);
      const alpha = readHuffmanSymbol(reader, group[3]);
      const pixel = ((alpha << 24) | (red << 16) | (greenCode << 8) | blue) >>> 0;
      if (pixels) pixels[position] = pixel;
      if (cache) cache[colorCacheKey(pixel, metadata.colorCacheBits)] = pixel;
      position += 1;
      continue;
    }
    if (greenCode < NUM_LITERAL_CODES + NUM_LENGTH_CODES) {
      const length = prefixValue(reader, greenCode - NUM_LITERAL_CODES);
      const distanceCode = prefixValue(reader, readHuffmanSymbol(reader, group[4]));
      const distance = planeCodeToDistance(width, distanceCode);
      if (distance > position || length > totalPixels - position) throw new InvalidVp8l();
      if (pixels) {
        for (let copied = 0; copied < length; copied += 1) {
          const pixel = pixels[position + copied - distance] ?? 0;
          pixels[position + copied] = pixel;
          if (cache) cache[colorCacheKey(pixel, metadata.colorCacheBits)] = pixel;
        }
      }
      position += length;
      continue;
    }
    const cacheIndex = greenCode - NUM_LITERAL_CODES - NUM_LENGTH_CODES;
    if (!cache || cacheIndex >= cache.length) throw new InvalidVp8l();
    const pixel = cache[cacheIndex] ?? 0;
    if (pixels) pixels[position] = pixel;
    cache[colorCacheKey(pixel, metadata.colorCacheBits)] = pixel;
    position += 1;
  }
  return pixels;
}

function readHuffmanMetadata(
  reader: Vp8lBitReader,
  width: number,
  height: number,
  colorCacheBits: number,
  allowMetaCodes: boolean,
): HuffmanMetadata {
  let huffmanImage: Uint16Array | null = null;
  let huffmanImageWidth = 0;
  let huffmanPrecision = 0;
  let maximumGroupId = 0;
  const usedGroups = new Set<number>([0]);
  if (allowMetaCodes && reader.read(1)) {
    huffmanPrecision = reader.read(3) + 2;
    huffmanImageWidth = subSampleSize(width, huffmanPrecision);
    const huffmanImageHeight = subSampleSize(height, huffmanPrecision);
    const pixels = decodeImageStream(reader, huffmanImageWidth, huffmanImageHeight, false, true);
    if (!pixels) throw new InvalidVp8l();
    huffmanImage = new Uint16Array(pixels.length);
    usedGroups.clear();
    for (let index = 0; index < pixels.length; index += 1) {
      const group = ((pixels[index] ?? 0) >>> 8) & 0xffff;
      huffmanImage[index] = group;
      usedGroups.add(group);
      maximumGroupId = Math.max(maximumGroupId, group);
    }
  }

  const groups = new Map<number, HuffmanGroup>();
  const greenAlphabetSize = NUM_LITERAL_CODES + NUM_LENGTH_CODES
    + (colorCacheBits ? 1 << colorCacheBits : 0);
  for (let groupId = 0; groupId <= maximumGroupId; groupId += 1) {
    const group: HuffmanGroup = [
      readHuffmanCode(reader, greenAlphabetSize),
      readHuffmanCode(reader, NUM_LITERAL_CODES),
      readHuffmanCode(reader, NUM_LITERAL_CODES),
      readHuffmanCode(reader, NUM_LITERAL_CODES),
      readHuffmanCode(reader, 40),
    ];
    if (usedGroups.has(groupId)) groups.set(groupId, group);
  }
  return { groups, huffmanImage, huffmanImageWidth, huffmanPrecision, colorCacheBits };
}

function decodeImageStream(
  reader: Vp8lBitReader,
  initialWidth: number,
  initialHeight: number,
  allowTransforms: boolean,
  collectPixels: boolean,
): Uint32Array | null {
  let width = initialWidth;
  const height = initialHeight;
  let transformsSeen = 0;
  if (allowTransforms) {
    while (reader.read(1)) {
      const transform = reader.read(2);
      const transformMask = 1 << transform;
      if (transformsSeen & transformMask) throw new InvalidVp8l();
      transformsSeen |= transformMask;
      if (transform === 0 || transform === 1) {
        const sizeBits = reader.read(3) + 2;
        decodeImageStream(reader, subSampleSize(width, sizeBits), subSampleSize(height, sizeBits), false, false);
      } else if (transform === 3) {
        const colorCount = reader.read(8) + 1;
        const packingBits = colorCount > 16 ? 0 : colorCount > 4 ? 1 : colorCount > 2 ? 2 : 3;
        decodeImageStream(reader, colorCount, 1, false, false);
        width = subSampleSize(width, packingBits);
      }
    }
  }
  const hasColorCache = reader.read(1) === 1;
  const colorCacheBits = hasColorCache ? reader.read(4) : 0;
  if (hasColorCache && (colorCacheBits < 1 || colorCacheBits > MAX_COLOR_CACHE_BITS)) {
    throw new InvalidVp8l();
  }
  const metadata = readHuffmanMetadata(reader, width, height, colorCacheBits, allowTransforms);
  return decodeImageData(reader, width, height, metadata, collectPixels);
}

export function hasCompleteVp8lBitstream(bytes: Uint8Array, start: number, length: number): boolean {
  if (length <= 5 || start < 0 || start + length > bytes.length || bytes[start] !== 0x2f) return false;
  const dimensions = (bytes[start + 1] ?? 0)
    + ((bytes[start + 2] ?? 0) << 8)
    + ((bytes[start + 3] ?? 0) << 16)
    + ((bytes[start + 4] ?? 0) * 0x1000000);
  const width = (dimensions & 0x3fff) + 1;
  const height = ((dimensions >>> 14) & 0x3fff) + 1;
  if ((dimensions >>> 29) !== 0 || width * height > 40_000_000) return false;
  try {
    const reader = new Vp8lBitReader(bytes, start + 5, length - 5);
    decodeImageStream(reader, width, height, true, false);
    return true;
  } catch (error) {
    if (error instanceof InvalidVp8l) return false;
    throw error;
  }
}
