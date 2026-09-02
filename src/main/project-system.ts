import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type {
  ProjectSystemFile,
  ProjectSystemStatus,
  ProjectTask,
  ProjectTaskAttachment,
  ProjectTaskDraft,
  ProjectTaskImageDraft,
  ProjectTaskPriority,
  ProjectTaskState,
  Workspace,
} from '../shared/types';
import { shellQuote } from './path-utils';
import { runWslCommand } from './wsl';

const PROJECT_FILES = ['AGENTS.md', 'TASKS.md', 'WORKBENCH_PROGRESS.md'] as const;
const NUMERIC_TASK_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*-\d+$/;
const LEGACY_RANDOM_TASK_ID_PATTERN = /^WB-[A-F0-9]{8}$/i;
const LEGACY_UUID_TASK_ID_PATTERN = /^[A-F0-9]{8}-(?:[A-F0-9]{4}-){3}[A-F0-9]{12}$/i;
const PROJECT_TASK_PLACEHOLDER_ID_PATTERN = /^(?:WB-NNN|P\?-NNN)$/i;
const PROJECT_IMAGE_DIRECTORY = '.workbench/task-images';
const MAX_TASK_IMAGES = 4;
const MAX_TASK_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TASK_IMAGE_TOTAL_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_PNG_INFLATED_BYTES = 160 * 1024 * 1024;
const MAX_WEBP_IMAGE_CHUNKS = 128;
const MAX_PENDING_PROJECT_IMAGE_DECODES = 8;
const PROJECT_IMAGE_DECODE_TIMEOUT_MS = 15_000;
const projectTaskMutationQueues = new Map<string, Promise<ProjectSystemStatus>>();
let pendingProjectImageDecodes = 0;
let projectImageDecodeQueue: Promise<void> = Promise.resolve();

const PROJECT_TEMPLATES: Record<(typeof PROJECT_FILES)[number], string> = {
  'AGENTS.md': `# Project agent guide

Read TASKS.md before starting work. Keep changes scoped, verify relevant checks, preserve unrelated work, and record meaningful outcomes in WORKBENCH_PROGRESS.md.
`,
  'TASKS.md': `# Project tasks

States: \`pending\` · \`in progress\` · \`blocked\` · \`done\`

## Queue

Add tasks from Workbench or as headings in this form:

### WB-NNN — Example task

- **State:** pending
- **Priority:** P2
- **Objective:** Describe the desired outcome.
- **Acceptance criteria:**
  - [ ] Describe one observable completion condition.
`,
  'WORKBENCH_PROGRESS.md': `# Project progress

Append concise evidence for completed work: date, task, files changed, checks run, remaining risks, and next action.
`,
};

function cleanSingleLine(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : '';
}

function normalizeTaskState(value: string): ProjectTaskState {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'in progress' || normalized === 'blocked' || normalized === 'done') return normalized;
  return 'pending';
}

function isProjectTaskId(value: string): boolean {
  return NUMERIC_TASK_ID_PATTERN.test(value) || LEGACY_RANDOM_TASK_ID_PATTERN.test(value);
}

function isVisibleProjectTaskId(value: string): boolean {
  return Boolean(value) && !PROJECT_TASK_PLACEHOLDER_ID_PATTERN.test(value);
}

function normalizeTaskPriority(value: unknown, legacyId = ''): ProjectTaskPriority {
  const normalized = cleanSingleLine(value, 10).toUpperCase();
  if (normalized === 'P0' || normalized === 'P1' || normalized === 'P2' || normalized === 'P3') return normalized;
  const legacyPriority = /^(P[0-3])-/i.exec(legacyId)?.[1]?.toUpperCase();
  return legacyPriority === 'P0' || legacyPriority === 'P1' || legacyPriority === 'P2' || legacyPriority === 'P3'
    ? legacyPriority
    : 'P2';
}

function parseAcceptanceCriteria(block: string): string[] {
  const header = /^-\s+\*\*Acceptance criteria:\*\*\s*$/im.exec(block);
  if (!header?.index && header?.index !== 0) return [];
  const following = block.slice(header.index + header[0].length);
  const section = following.split(/^-[ \t]+\*\*[^\n]+/m, 1)[0] ?? '';
  return section.split(/\r?\n/).map((line) => {
    const value = /^\s*-\s+\[[ xX]\]\s+(.+)$/.exec(line)?.[1];
    return cleanSingleLine(value, 300);
  }).filter(Boolean).slice(0, 20);
}

function mediaTypeForPath(value: string): string | null {
  const extension = value.split('.').at(-1)?.toLowerCase();
  if (extension === 'png') return 'image/png';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'webp') return 'image/webp';
  return null;
}

function parseAttachments(block: string): ProjectTaskAttachment[] {
  const header = /^-\s+\*\*Attachments:\*\*\s*$/im.exec(block);
  if (header?.index === undefined) return [];
  const following = block.slice(header.index + header[0].length);
  const section = following.split(/^-[ \t]+\*\*[^\n]+/m, 1)[0] ?? '';
  return [...section.matchAll(/^\s*-\s+!\[[^\]]*\]\(([^)]+)\)\s*$/gm)].map((match) => {
    const attachmentPath = cleanSingleLine(match[1], 500);
    const mediaType = mediaTypeForPath(attachmentPath);
    return mediaType && /^\.workbench\/task-images\/[A-Za-z][A-Za-z0-9_-]*-\d+-(?:0[1-4])\.(?:png|jpg|webp)$/.test(attachmentPath)
      ? { path: attachmentPath, mediaType }
      : null;
  }).filter((attachment): attachment is ProjectTaskAttachment => attachment !== null).slice(0, MAX_TASK_IMAGES);
}

export function parseProjectTasks(markdown: string): ProjectTask[] {
  const heading = /^###\s+(.+?)\s+(?:—|-)\s+(.+)$/gm;
  const matches = [...markdown.matchAll(heading)];
  return matches.map((match, index) => {
    const blockStart = (match.index ?? 0) + match[0].length;
    const blockEnd = matches[index + 1]?.index ?? markdown.length;
    const block = markdown.slice(blockStart, blockEnd);
    const state = /^-\s+\*\*State:\*\*\s*([^\n]+)/im.exec(block)?.[1] ?? 'pending';
    const priority = /^-\s+\*\*Priority:\*\*\s*([^\n]+)/im.exec(block)?.[1] ?? '';
    const objective = /^-\s+\*\*Objective:\*\*\s*([^\n]+)/im.exec(block)?.[1] ?? '';
    const id = cleanSingleLine(match[1], 100);
    const parentId = cleanSingleLine(/^-\s+\*\*Parent:\*\*\s*([^\n]+)/im.exec(block)?.[1], 100);
    return {
      id,
      title: cleanSingleLine(match[2], 180),
      state: normalizeTaskState(state),
      priority: normalizeTaskPriority(priority, id),
      objective: cleanSingleLine(objective, 500),
      parentId: isVisibleProjectTaskId(parentId) ? parentId : null,
      acceptanceCriteria: parseAcceptanceCriteria(block),
      attachments: parseAttachments(block),
    };
  }).filter((task) => isVisibleProjectTaskId(task.id) && task.title);
}

export function nextProjectTaskId(tasks: ProjectTask[], highWater = 0): string {
  const maximum = tasks.reduce((current, task) => {
    const suffix = NUMERIC_TASK_ID_PATTERN.test(task.id) && !LEGACY_UUID_TASK_ID_PATTERN.test(task.id)
      ? Number(/-(\d+)$/.exec(task.id)?.[1] ?? 0)
      : 0;
    return Number.isSafeInteger(suffix) ? Math.max(current, suffix) : current;
  }, highWater);
  if (!Number.isSafeInteger(maximum) || maximum < 0 || maximum >= Number.MAX_SAFE_INTEGER) {
    throw new Error('Task id sequence is invalid or exhausted.');
  }
  return `WB-${String(maximum + 1).padStart(3, '0')}`;
}

function cleanCriteria(values: unknown): string[] {
  return Array.isArray(values)
    ? values.map((value) => cleanSingleLine(value, 300)).filter(Boolean).slice(0, 20)
    : [];
}

function hasValidProjectTaskParentChain(tasks: ProjectTask[], parentId: string): boolean {
  const counts = new Map<string, number>();
  const byId = new Map<string, ProjectTask>();
  for (const task of tasks) {
    counts.set(task.id, (counts.get(task.id) ?? 0) + 1);
    if (!byId.has(task.id)) byId.set(task.id, task);
  }
  const seen = new Set<string>();
  let currentId: string | null = parentId;
  while (currentId) {
    if (seen.has(currentId) || counts.get(currentId) !== 1) return false;
    seen.add(currentId);
    const current: ProjectTask | undefined = byId.get(currentId);
    if (!current) return false;
    currentId = current.parentId;
  }
  return true;
}

export function formatProjectTask(
  task: ProjectTaskDraft,
  id: string,
  attachments: ProjectTaskAttachment[] = [],
): string {
  const title = cleanSingleLine(task.title, 180);
  const objective = cleanSingleLine(task.objective, 500);
  const priority = normalizeTaskPriority(task.priority);
  const parentId = cleanSingleLine(task.parentId, 100);
  const criteria = cleanCriteria(task.acceptanceCriteria);
  if (!title) throw new Error('Enter a task title.');
  if (!isProjectTaskId(id)) throw new Error('Task id is invalid.');
  if (parentId && !isVisibleProjectTaskId(parentId)) throw new Error('Parent task id is invalid.');
  const lines = [
    `### ${id} — ${title}`,
    '',
    '- **State:** pending',
    `- **Priority:** ${priority}`,
    ...(parentId ? [`- **Parent:** ${parentId}`] : []),
    `- **Objective:** ${objective || title}`,
  ];
  if (criteria.length) {
    lines.push('- **Acceptance criteria:**', ...criteria.map((criterion) => `  - [ ] ${criterion}`));
  }
  if (attachments.length) {
    lines.push(
      '- **Attachments:**',
      ...attachments.map((attachment, index) => `  - ![Task image ${index + 1}](${attachment.path})`),
    );
  }
  return `${lines.join('\n')}\n`;
}

interface ValidatedProjectImage {
  bytes: Uint8Array;
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
  extension: 'png' | 'jpg' | 'webp';
}

function startsWithBytes(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return signature.every((value, index) => bytes[offset + index] === value);
}

function uint32BigEndian(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) * 0x1000000)
    + ((bytes[offset + 1] ?? 0) << 16)
    + ((bytes[offset + 2] ?? 0) << 8)
    + (bytes[offset + 3] ?? 0);
}

function uint32LittleEndian(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0)
    + ((bytes[offset + 1] ?? 0) << 8)
    + ((bytes[offset + 2] ?? 0) << 16)
    + ((bytes[offset + 3] ?? 0) * 0x1000000);
}

function uint24LittleEndian(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0)
    + ((bytes[offset + 1] ?? 0) << 8)
    + ((bytes[offset + 2] ?? 0) << 16);
}

function validImageDimensions(width: number, height: number): boolean {
  return width > 0 && height > 0 && width <= 16_384 && height <= 16_384 && width * height <= MAX_IMAGE_PIXELS;
}

const PNG_CRC_TABLE = Uint32Array.from({ length: 256 }, (_unused, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function pngCrc32(bytes: Uint8Array, start: number, end: number): number {
  let value = 0xffffffff;
  for (let index = start; index < end; index += 1) {
    value = (value >>> 8) ^ (PNG_CRC_TABLE[(value ^ (bytes[index] ?? 0)) & 0xff] ?? 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function isPngChunkType(bytes: Uint8Array, offset: number): boolean {
  for (let index = offset; index < offset + 4; index += 1) {
    const value = bytes[index] ?? 0;
    if (!((value >= 0x41 && value <= 0x5a) || (value >= 0x61 && value <= 0x7a))) return false;
  }
  return ((bytes[offset + 2] ?? 0) & 0x20) === 0;
}

function validPngHeader(bytes: Uint8Array, dataStart: number): boolean {
  const bitDepth = bytes[dataStart + 8] ?? 0;
  const colorType = bytes[dataStart + 9] ?? -1;
  const validBitDepths: Record<number, number[]> = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16],
  };
  return validImageDimensions(uint32BigEndian(bytes, dataStart), uint32BigEndian(bytes, dataStart + 4))
    && (validBitDepths[colorType]?.includes(bitDepth) ?? false)
    && bytes[dataStart + 10] === 0
    && bytes[dataStart + 11] === 0
    && (bytes[dataStart + 12] === 0 || bytes[dataStart + 12] === 1);
}

interface PngScanlinePass {
  rowBytes: number;
  rowCount: number;
}

interface StructuredPngImageData {
  compressed: Uint8Array;
  passes: PngScanlinePass[];
}

function pngPassSize(size: number, start: number, step: number): number {
  return size <= start ? 0 : Math.ceil((size - start) / step);
}

function pngScanlinePasses(
  width: number,
  height: number,
  bitDepth: number,
  colorType: number,
  interlace: number,
): PngScanlinePass[] | null {
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType];
  if (!channels) return null;
  const bitsPerPixel = channels * bitDepth;
  const definitions = interlace === 0
    ? [[0, 0, 1, 1]]
    : [
      [0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4],
      [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2],
    ];
  const passes: PngScanlinePass[] = [];
  let inflatedBytes = 0;
  for (const [xStart = 0, yStart = 0, xStep = 1, yStep = 1] of definitions) {
    const passWidth = pngPassSize(width, xStart, xStep);
    const rowCount = pngPassSize(height, yStart, yStep);
    if (!passWidth || !rowCount) continue;
    const rowBytes = Math.ceil((passWidth * bitsPerPixel) / 8);
    const passBytes = (rowBytes + 1) * rowCount;
    if (!Number.isSafeInteger(passBytes) || inflatedBytes > MAX_PNG_INFLATED_BYTES - passBytes) return null;
    inflatedBytes += passBytes;
    passes.push({ rowBytes, rowCount });
  }
  return passes.length ? passes : null;
}

function inspectStructuredPng(bytes: Uint8Array): StructuredPngImageData | null {
  if (bytes.length < 45 || !startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return null;
  let offset = 8;
  let colorType = -1;
  let bitDepth = 0;
  let width = 0;
  let height = 0;
  let interlace = 0;
  let hasPalette = false;
  let hasImageData = false;
  let imageDataEnded = false;
  let imageDataBytes = 0;
  const imageDataChunks: Uint8Array[] = [];

  while (offset < bytes.length) {
    if (offset + 12 > bytes.length || !isPngChunkType(bytes, offset + 4)) return null;
    const length = uint32BigEndian(bytes, offset);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (dataEnd < dataStart || chunkEnd > bytes.length) return null;
    if (pngCrc32(bytes, offset + 4, dataEnd) !== uint32BigEndian(bytes, dataEnd)) return null;

    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    if (offset === 8) {
      if (type !== 'IHDR' || length !== 13 || !validPngHeader(bytes, dataStart)) return null;
      bitDepth = bytes[dataStart + 8] ?? 0;
      colorType = bytes[dataStart + 9] ?? -1;
      width = uint32BigEndian(bytes, dataStart);
      height = uint32BigEndian(bytes, dataStart + 4);
      interlace = bytes[dataStart + 12] ?? 0;
    } else if (type === 'IHDR') {
      return null;
    } else if (type === 'PLTE') {
      const entries = length / 3;
      if (hasPalette || hasImageData || colorType === 0 || colorType === 4
        || length === 0 || length % 3 !== 0 || entries > 256
        || (colorType === 3 && entries > (2 ** bitDepth))) return null;
      hasPalette = true;
    } else if (type === 'IDAT') {
      if (imageDataEnded) return null;
      hasImageData = true;
      imageDataBytes += length;
      imageDataChunks.push(bytes.subarray(dataStart, dataEnd));
    } else if (type === 'IEND') {
      if (length !== 0
        || !hasImageData
        || imageDataBytes <= 0
        || (colorType === 3 && !hasPalette)
        || chunkEnd !== bytes.length) return null;
      const passes = pngScanlinePasses(width, height, bitDepth, colorType, interlace);
      if (!passes) return null;
      const compressed = Buffer.allocUnsafe(imageDataBytes);
      let compressedOffset = 0;
      for (const chunk of imageDataChunks) {
        compressed.set(chunk, compressedOffset);
        compressedOffset += chunk.length;
      }
      return { compressed, passes };
    } else {
      if ((bytes[offset + 4] ?? 0) >= 0x41 && (bytes[offset + 4] ?? 0) <= 0x5a) return null;
      if (hasImageData) imageDataEnded = true;
    }
    offset = chunkEnd;
  }
  return null;
}

function isStructuredJpeg(bytes: Uint8Array): boolean {
  if (bytes.length < 25 || !startsWithBytes(bytes, [0xff, 0xd8])) return false;
  const startOfFrameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  let hasFrame = false;
  let hasScan = false;
  const frameComponentIds = new Set<number>();
  const scannedComponentIds = new Set<number>();

  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return false;
    const marker = bytes[offset] ?? 0;
    offset += 1;

    if (marker === 0xd9) {
      return hasFrame && hasScan && offset === bytes.length
        && [...frameComponentIds].every((componentId) => scannedComponentIds.has(componentId));
    }
    if (marker === 0x00 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) return false;
    if (marker === 0x01) continue;
    if (offset + 2 > bytes.length) return false;
    const segmentLength = ((bytes[offset] ?? 0) << 8) + (bytes[offset + 1] ?? 0);
    const dataStart = offset + 2;
    const segmentEnd = offset + segmentLength;
    if (segmentLength < 2 || segmentEnd < dataStart || segmentEnd > bytes.length) return false;

    if (startOfFrameMarkers.has(marker)) {
      const componentCount = bytes[dataStart + 5] ?? 0;
      const precision = bytes[dataStart] ?? 0;
      const height = ((bytes[dataStart + 1] ?? 0) << 8) + (bytes[dataStart + 2] ?? 0);
      const width = ((bytes[dataStart + 3] ?? 0) << 8) + (bytes[dataStart + 4] ?? 0);
      if (hasFrame || precision < 2 || precision > 16 || componentCount < 1 || componentCount > 4
        || segmentLength !== 8 + (componentCount * 3) || !validImageDimensions(width, height)) return false;
      for (let component = 0; component < componentCount; component += 1) {
        const componentOffset = dataStart + 6 + (component * 3);
        const componentId = bytes[componentOffset] ?? 0;
        const sampling = bytes[componentOffset + 1] ?? 0;
        const quantizationTable = bytes[componentOffset + 2] ?? 0xff;
        if (frameComponentIds.has(componentId)
          || (sampling >>> 4) < 1 || (sampling >>> 4) > 4
          || (sampling & 0x0f) < 1 || (sampling & 0x0f) > 4
          || quantizationTable > 3) return false;
        frameComponentIds.add(componentId);
      }
      hasFrame = true;
      offset = segmentEnd;
      continue;
    }

    if (marker !== 0xda) {
      offset = segmentEnd;
      continue;
    }

    const scanComponentCount = bytes[dataStart] ?? 0;
    if (!hasFrame || scanComponentCount < 1 || scanComponentCount > 4
      || segmentLength !== 6 + (scanComponentCount * 2)) return false;
    const scanComponentIds = new Set<number>();
    for (let component = 0; component < scanComponentCount; component += 1) {
      const componentOffset = dataStart + 1 + (component * 2);
      const componentId = bytes[componentOffset] ?? 0;
      const tableSelectors = bytes[componentOffset + 1] ?? 0xff;
      if (!frameComponentIds.has(componentId) || scanComponentIds.has(componentId)
        || (tableSelectors >>> 4) > 3 || (tableSelectors & 0x0f) > 3) return false;
      scanComponentIds.add(componentId);
    }

    let scanOffset = segmentEnd;
    let scanBytes = 0;
    let nextMarker = -1;
    while (scanOffset < bytes.length) {
      if (bytes[scanOffset] !== 0xff) {
        scanBytes += 1;
        scanOffset += 1;
        continue;
      }
      const markerStart = scanOffset;
      while (bytes[scanOffset] === 0xff) scanOffset += 1;
      if (scanOffset >= bytes.length) return false;
      const scanMarker = bytes[scanOffset] ?? 0;
      scanOffset += 1;
      if (scanMarker === 0x00) {
        scanBytes += 1;
        continue;
      }
      if (scanMarker >= 0xd0 && scanMarker <= 0xd7) continue;
      nextMarker = markerStart;
      break;
    }
    if (scanBytes === 0 || nextMarker < 0) return false;
    for (const componentId of scanComponentIds) scannedComponentIds.add(componentId);
    hasScan = true;
    offset = nextMarker;
  }
  return false;
}

interface DecodedImageMetadata {
  width: number;
  height: number;
}

interface CompressedImageDecodeRequest {
  kind: 'jpeg' | 'webp';
  images: Uint8Array[];
}

interface PngImageDecodeRequest {
  kind: 'png';
  compressed: Uint8Array;
  passes: PngScanlinePass[];
}

type ProjectImageDecoderRequest = CompressedImageDecodeRequest | PngImageDecodeRequest;

interface ProjectImageDecoderMessage {
  valid: boolean;
  images?: DecodedImageMetadata[];
}

function isDecodedImageMetadata(value: unknown): value is DecodedImageMetadata {
  const candidate = value as Partial<DecodedImageMetadata>;
  return !!candidate
    && Number.isSafeInteger(candidate.width)
    && Number.isSafeInteger(candidate.height)
    && validImageDimensions(candidate.width ?? 0, candidate.height ?? 0);
}

async function runProjectImageDecoderNow(
  request: ProjectImageDecoderRequest,
): Promise<ProjectImageDecoderMessage | null> {
  if (request.kind !== 'png' && (!request.images.length || request.images.length > MAX_WEBP_IMAGE_CHUNKS)) {
    throw new Error('Task image decoding could not start.');
  }
  try {
    return await new Promise((resolve, reject) => {
      let settled = false;
      const worker = new Worker(path.join(__dirname, 'project-image-decoder-worker.js'), {
        resourceLimits: {
          maxOldGenerationSizeMb: 256,
          maxYoungGenerationSizeMb: 32,
          stackSizeMb: 4,
        },
        workerData: request.kind === 'png'
          ? {
            kind: request.kind,
            compressed: Uint8Array.from(request.compressed),
            passes: request.passes.map((pass) => ({ ...pass })),
          }
          : {
            kind: request.kind,
            images: request.images.map((image) => Uint8Array.from(image)),
          },
      });
      const finish = (result: ProjectImageDecoderMessage | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const fail = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error('Task image decoding did not complete.'));
      };
      const timer = setTimeout(() => {
        void worker.terminate().finally(fail);
      }, PROJECT_IMAGE_DECODE_TIMEOUT_MS);
      worker.once('message', (value: unknown) => {
        const message = value as Partial<ProjectImageDecoderMessage>;
        if (message?.valid === false && message.images === undefined) {
          finish(null);
        } else if (message?.valid !== true) {
          fail();
        } else if (request.kind === 'png' && message.images === undefined) {
          finish({ valid: true });
        } else if (request.kind !== 'png'
          && Array.isArray(message.images)
          && message.images.length === request.images.length
          && message.images.every(isDecodedImageMetadata)) {
          finish({ valid: true, images: message.images });
        } else {
          fail();
        }
      });
      worker.once('error', fail);
      worker.once('exit', () => fail());
    });
  } catch {
    throw new Error('Task image decoding failed or timed out. Try pasting the image again.');
  }
}

async function runProjectImageDecoder(
  request: ProjectImageDecoderRequest,
): Promise<ProjectImageDecoderMessage | null> {
  if (pendingProjectImageDecodes >= MAX_PENDING_PROJECT_IMAGE_DECODES) {
    throw new Error('Too many task images are being validated. Wait for the current images and try again.');
  }
  pendingProjectImageDecodes += 1;
  const pending = projectImageDecodeQueue.then(() => runProjectImageDecoderNow(request));
  projectImageDecodeQueue = pending.then(() => undefined, () => undefined);
  try {
    return await pending;
  } finally {
    pendingProjectImageDecodes -= 1;
  }
}

async function hasValidPngImageData(image: StructuredPngImageData): Promise<boolean> {
  return (await runProjectImageDecoder({
    kind: 'png',
    compressed: image.compressed,
    passes: image.passes,
  }))?.valid === true;
}

async function decodeProjectImages(
  kind: CompressedImageDecodeRequest['kind'],
  images: Uint8Array[],
): Promise<DecodedImageMetadata[] | null> {
  return (await runProjectImageDecoder({ kind, images }))?.images ?? null;
}

function structuredVp8Payload(
  bytes: Uint8Array,
  start: number,
  length: number,
): DecodedImageMetadata | null {
  if (length <= 10 || !startsWithBytes(bytes, [0x9d, 0x01, 0x2a], start + 3)) return null;
  const frameTag = uint24LittleEndian(bytes, start);
  const isKeyFrame = (frameTag & 0x01) === 0;
  const version = (frameTag >>> 1) & 0x07;
  const showFrame = ((frameTag >>> 4) & 0x01) === 1;
  const firstPartitionLength = frameTag >>> 5;
  const bytesAfterFrameHeader = length - 10;
  if (!isKeyFrame || version > 3 || !showFrame
    || firstPartitionLength === 0 || firstPartitionLength >= bytesAfterFrameHeader) return null;
  const width = ((bytes[start + 6] ?? 0) + ((bytes[start + 7] ?? 0) << 8)) & 0x3fff;
  const height = ((bytes[start + 8] ?? 0) + ((bytes[start + 9] ?? 0) << 8)) & 0x3fff;
  return validImageDimensions(width, height) ? { width, height } : null;
}

function structuredVp8lDimensions(
  bytes: Uint8Array,
  start: number,
  length: number,
): DecodedImageMetadata | null {
  if (length <= 5 || bytes[start] !== 0x2f) return null;
  const dimensions = uint32LittleEndian(bytes, start + 1);
  if ((dimensions >>> 29) !== 0) return null;
  const width = (dimensions & 0x3fff) + 1;
  const height = ((dimensions >>> 14) & 0x3fff) + 1;
  return validImageDimensions(width, height) ? { width, height } : null;
}

interface StructuredVp8xPayload extends DecodedImageMetadata {
  flags: number;
}

function structuredVp8xPayload(bytes: Uint8Array, start: number, length: number): StructuredVp8xPayload | null {
  if (length !== 10
    || ((bytes[start] ?? 0) & 0xc1) !== 0
    || bytes[start + 1] !== 0
    || bytes[start + 2] !== 0
    || bytes[start + 3] !== 0) return null;
  const width = uint24LittleEndian(bytes, start + 4) + 1;
  const height = uint24LittleEndian(bytes, start + 7) + 1;
  return validImageDimensions(width, height) ? { flags: bytes[start] ?? 0, width, height } : null;
}

interface WebpValidationContext {
  animationFrames: number;
  canvas: StructuredVp8xPayload | null;
  decodeCandidates: Array<DecodedImageMetadata & { bytes: Uint8Array }>;
  hasAnimationControl: boolean;
  imageChunks: number;
  imagePixels: number;
  lastImage: DecodedImageMetadata | null;
  topLevelImages: number;
}

interface WebpChunkSequence {
  hasAlpha: boolean;
}

function recordWebpImage(
  context: WebpValidationContext,
  image: DecodedImageMetadata,
): boolean {
  const pixels = image.width * image.height;
  if (context.imageChunks >= MAX_WEBP_IMAGE_CHUNKS
    || context.imagePixels > MAX_IMAGE_PIXELS - pixels) return false;
  context.imageChunks += 1;
  context.imagePixels += pixels;
  context.lastImage = image;
  return true;
}

function wrappedWebpFrame(
  bytes: Uint8Array,
  start: number,
  end: number,
  width: number,
  height: number,
  hasAlpha: boolean,
): Uint8Array {
  const extendedBytes = hasAlpha ? 18 : 0;
  const wrapped = Buffer.alloc(12 + extendedBytes + (end - start));
  wrapped.write('RIFF', 0, 'ascii');
  wrapped.writeUInt32LE(wrapped.length - 8, 4);
  wrapped.write('WEBP', 8, 'ascii');
  if (hasAlpha) {
    wrapped.write('VP8X', 12, 'ascii');
    wrapped.writeUInt32LE(10, 16);
    wrapped[20] = 0x10;
    wrapped.writeUIntLE(width - 1, 24, 3);
    wrapped.writeUIntLE(height - 1, 27, 3);
  }
  wrapped.set(bytes.subarray(start, end), 12 + extendedBytes);
  return wrapped;
}

function hasStructuredWebpImageChunks(
  bytes: Uint8Array,
  start: number,
  end: number,
  context: WebpValidationContext,
  nested = false,
): WebpChunkSequence | null {
  let offset = start;
  let hasImage = false;
  let hasAlpha = false;
  while (offset < end) {
    if (offset + 8 > end) return null;
    const chunkType = String.fromCharCode(...bytes.slice(offset, offset + 4));
    const chunkLength = uint32LittleEndian(bytes, offset + 4);
    const payloadStart = offset + 8;
    const payloadEnd = payloadStart + chunkLength;
    const paddedEnd = payloadEnd + (chunkLength % 2);
    if (payloadEnd < payloadStart || paddedEnd > end) return null;
    if (hasAlpha && !hasImage && chunkType !== 'VP8 ') return null;

    if (chunkType === 'VP8 ') {
      const payload = structuredVp8Payload(bytes, payloadStart, chunkLength);
      if (!payload || !recordWebpImage(context, payload)) return null;
      if (!nested) context.topLevelImages += 1;
      hasImage = true;
    } else if (chunkType === 'VP8L') {
      if (hasAlpha) return null;
      const dimensions = structuredVp8lDimensions(bytes, payloadStart, chunkLength);
      if (!dimensions || !recordWebpImage(context, dimensions)) return null;
      if (!nested) context.topLevelImages += 1;
      hasImage = true;
    } else if (chunkType === 'ALPH') {
      if (hasAlpha
        || hasImage
        || chunkLength === 0
        || !context.canvas
        || (context.canvas.flags & 0x10) === 0) return null;
      hasAlpha = true;
    } else if (chunkType === 'VP8X') {
      const canvas = structuredVp8xPayload(bytes, payloadStart, chunkLength);
      if (nested || offset !== start || !canvas) return null;
      context.canvas = canvas;
    } else if (chunkType === 'ANIM') {
      if (nested
        || chunkLength !== 6
        || !context.canvas
        || (context.canvas.flags & 0x02) === 0
        || context.hasAnimationControl
        || context.animationFrames > 0
        || hasImage) return null;
      context.hasAnimationControl = true;
    } else if (chunkType === 'ANMF') {
      if (nested || chunkLength < 24) return null;
      const x = uint24LittleEndian(bytes, payloadStart) * 2;
      const y = uint24LittleEndian(bytes, payloadStart + 3) * 2;
      const width = uint24LittleEndian(bytes, payloadStart + 6) + 1;
      const height = uint24LittleEndian(bytes, payloadStart + 9) + 1;
      const frameFlags = bytes[payloadStart + 15] ?? 0;
      const canvas = context.canvas;
      const imageChunksBefore = context.imageChunks;
      const frameStart = payloadStart + 16;
      const frame = hasStructuredWebpImageChunks(bytes, frameStart, payloadEnd, context, true);
      if (!canvas
        || (canvas.flags & 0x02) === 0
        || !context.hasAnimationControl
        || (frameFlags & 0xfc) !== 0
        || !validImageDimensions(width, height)
        || width > canvas.width
        || height > canvas.height
        || x > canvas.width - width
        || y > canvas.height - height
        || !frame
        || context.imageChunks !== imageChunksBefore + 1
        || context.lastImage?.width !== width
        || context.lastImage?.height !== height) return null;
      context.animationFrames += 1;
      context.decodeCandidates.push({
        bytes: wrappedWebpFrame(bytes, frameStart, payloadEnd, width, height, frame.hasAlpha),
        width,
        height,
      });
      hasImage = true;
    }
    offset = paddedEnd;
  }
  return offset === end && hasImage ? { hasAlpha } : null;
}

function inspectStructuredWebp(bytes: Uint8Array): WebpValidationContext | null {
  if (bytes.length < 20
    || !startsWithBytes(bytes, [0x52, 0x49, 0x46, 0x46])
    || !startsWithBytes(bytes, [0x57, 0x45, 0x42, 0x50], 8)
    || uint32LittleEndian(bytes, 4) + 8 !== bytes.length) return null;
  const context: WebpValidationContext = {
    animationFrames: 0,
    canvas: null,
    decodeCandidates: [],
    hasAnimationControl: false,
    imageChunks: 0,
    imagePixels: 0,
    lastImage: null,
    topLevelImages: 0,
  };
  const sequence = hasStructuredWebpImageChunks(bytes, 12, bytes.length, context);
  if (!sequence) return null;
  if (context.animationFrames > 0) {
    return context.topLevelImages === 0
      && context.hasAnimationControl
      && !sequence.hasAlpha
      && context.decodeCandidates.length === context.animationFrames
      ? context
      : null;
  }
  if (context.hasAnimationControl
    || context.topLevelImages !== 1
    || !context.lastImage
    || ((context.canvas?.flags ?? 0) & 0x02) !== 0) return null;
  const dimensions = context.canvas ?? context.lastImage;
  context.decodeCandidates.push({ bytes, width: dimensions.width, height: dimensions.height });
  return context;
}

async function hasDecodedJpegScan(bytes: Uint8Array): Promise<boolean> {
  const decoded = await decodeProjectImages('jpeg', [bytes]);
  return decoded?.length === 1;
}

async function hasDecodedWebpImages(context: WebpValidationContext): Promise<boolean> {
  if (!context.decodeCandidates.length) return false;
  const decoded = await decodeProjectImages(
    'webp',
    context.decodeCandidates.map((candidate) => candidate.bytes),
  );
  return decoded?.length === context.decodeCandidates.length && context.decodeCandidates.every((candidate, index) => (
    decoded[index]?.width === candidate.width && decoded[index]?.height === candidate.height
  ));
}

export async function validateProjectTaskImage(value: unknown): Promise<ValidatedProjectImage> {
  const candidate = (value ?? {}) as Partial<ProjectTaskImageDraft>;
  if (!(candidate.bytes instanceof Uint8Array)) throw new Error('Pasted image data is invalid.');
  if (!candidate.bytes.byteLength) throw new Error('Pasted image is empty.');
  if (candidate.bytes.byteLength > MAX_TASK_IMAGE_BYTES) throw new Error('Each task image must be 5 MB or smaller.');
  const bytes = Uint8Array.from(candidate.bytes);
  const png = inspectStructuredPng(bytes);
  if (png && await hasValidPngImageData(png)) {
    return { bytes, mediaType: 'image/png', extension: 'png' };
  }
  if (isStructuredJpeg(bytes) && await hasDecodedJpegScan(bytes)) {
    return { bytes, mediaType: 'image/jpeg', extension: 'jpg' };
  }
  const webp = inspectStructuredWebp(bytes);
  if (webp && await hasDecodedWebpImages(webp)) {
    return { bytes, mediaType: 'image/webp', extension: 'webp' };
  }
  throw new Error('Task images must be PNG, JPEG, or WebP files.');
}

function rootSetup(workspace: Workspace): string[] {
  return [
    `root=${shellQuote(workspace.root)}`,
    'root_real=$(realpath -- "$root") || { printf "Workspace root not found" >&2; exit 2; }',
    'if [ ! -d "$root_real" ]; then printf "Workspace root is not a directory" >&2; exit 2; fi',
    'root_identity=$(stat -Lc "%d:%i" -- "$root" 2>/dev/null) || { printf "Workspace root is unsafe" >&2; exit 2; }',
    'exec 5< "$root" || { printf "Workspace root cannot be opened" >&2; exit 2; }',
    'root_fd="/proc/$$/fd/5"',
    'opened_root_real=$(realpath -- "$root_fd") || { printf "Workspace root handle cannot be resolved" >&2; exit 2; }',
    'opened_root_identity=$(stat -Lc "%d:%i" -- "$root_fd" 2>/dev/null) || { printf "Workspace root is unsafe" >&2; exit 2; }',
    'if [ ! -d "$root_fd" ] || [ "$opened_root_real" != "$root_real" ] || [ "$opened_root_identity" != "$root_identity" ]; then printf "Workspace root changed during validation" >&2; exit 2; fi',
  ];
}

async function runProjectScript(workspace: Workspace, statements: string[], input?: Uint8Array): Promise<string> {
  const result = await runWslCommand(
    workspace.distro,
    [...rootSetup(workspace), ...statements].join('; '),
    30_000,
    input,
    false,
  );
  if (result.code !== 0) {
    throw new Error(result.timedOut ? 'Project Markdown operation timed out.' : result.stderr.trim() || 'Project Markdown operation failed.');
  }
  return result.stdout;
}

function projectTasksFileHandleStatements(mode: 'read' | 'append'): string[] {
  const descriptor = 4;
  return [
    'target="$root_fd/TASKS.md"',
    mode === 'read'
      ? 'if [ ! -e "$target" ] && [ ! -L "$target" ]; then exit 0; fi'
      : 'if [ ! -e "$target" ] && [ ! -L "$target" ]; then printf "TASKS.md does not exist" >&2; exit 3; fi',
    'if [ -L "$target" ]; then target_real=$(realpath -- "$target" 2>/dev/null || true); else target_real=$(realpath -- "$target") || { printf "TASKS.md cannot be resolved" >&2; exit 3; }; fi',
    'case "$target_real" in "$root_real"/*) ;; *) printf "TASKS.md resolves outside the workspace" >&2; exit 4 ;; esac',
    'if [ ! -f "$target" ]; then printf "TASKS.md is not a regular file" >&2; exit 4; fi',
    'target_identity=$(stat -Lc "%d:%i" -- "$target" 2>/dev/null) || { printf "TASKS.md is unsafe" >&2; exit 4; }',
    mode === 'read'
      ? `exec ${descriptor}< "$target" || { printf "TASKS.md cannot be opened" >&2; exit 4; }`
      : `exec ${descriptor}>> "$target" || { printf "TASKS.md cannot be opened" >&2; exit 4; }`,
    `target_fd="/proc/$$/fd/${descriptor}"`,
    'opened_target_real=$(realpath -- "$target_fd") || { printf "TASKS.md handle cannot be resolved" >&2; exit 4; }',
    'opened_target_identity=$(stat -Lc "%d:%i" -- "$target_fd" 2>/dev/null) || { printf "TASKS.md is unsafe" >&2; exit 4; }',
    'if [ "$opened_target_real" != "$target_real" ] || [ "$opened_target_identity" != "$target_identity" ]; then printf "TASKS.md changed during validation" >&2; exit 4; fi',
    'if [ ! -f "$target_fd" ] || [ "$(stat -Lc %h -- "$target_fd" 2>/dev/null)" != 1 ]; then printf "TASKS.md is multiply linked" >&2; exit 4; fi',
  ];
}

async function inspectFiles(workspace: Workspace): Promise<ProjectSystemFile[]> {
  const statements = PROJECT_FILES.flatMap((name) => [
    `target="$root_fd/${name}"`,
    `if [ ! -e "$target" ] && [ ! -L "$target" ]; then printf '${name}\\tmissing\\n'; else target_real=$(realpath -- "$target" 2>/dev/null || true); case "$target_real" in "$root_real"/*) if [ -f "$target_real" ] && [ "$(stat -c %h -- "$target_real" 2>/dev/null)" = 1 ]; then printf '${name}\\tpresent\\n'; else printf '${name}\\tunsafe\\n'; fi ;; *) printf '${name}\\tunsafe\\n' ;; esac; fi`,
  ]);
  const output = await runProjectScript(workspace, statements);
  const states = new Map(output.split(/\r?\n/).filter(Boolean).map((line) => line.split('\t', 2) as [string, string]));
  return PROJECT_FILES.map((name) => ({
    name,
    exists: states.get(name) !== 'missing',
    safe: states.get(name) !== 'unsafe',
  }));
}

async function readTasks(workspace: Workspace): Promise<string> {
  return runProjectScript(workspace, [
    ...projectTasksFileHandleStatements('read'),
    'cat -- "$target_fd"',
  ]);
}

function parseProjectTaskHighWater(value: string): number {
  const normalized = value.trim();
  if (!normalized) return 0;
  if (!/^\d{1,16}$/.test(normalized)) throw new Error('Task id sequence is corrupt.');
  const highWater = Number(normalized);
  if (!Number.isSafeInteger(highWater) || highWater < 0 || highWater >= Number.MAX_SAFE_INTEGER) {
    throw new Error('Task id sequence is invalid or exhausted.');
  }
  return highWater;
}

async function readProjectTaskHighWater(workspace: Workspace): Promise<number> {
  const output = await runProjectScript(workspace, [
    ...projectWorkbenchDirectoryStatements(false),
    'counter="$workbench_dir_fd/task-sequence"',
    'if [ ! -e "$counter" ] && [ ! -L "$counter" ]; then exit 0; fi',
    'if [ -L "$counter" ] || [ ! -f "$counter" ]; then printf "Task id sequence is unsafe" >&2; exit 6; fi',
    'counter_real=$(realpath -- "$counter") || { printf "Task id sequence cannot be resolved" >&2; exit 6; }',
    'case "$counter_real" in "$root_real"/*) ;; *) printf "Task id sequence resolves outside the workspace" >&2; exit 6 ;; esac',
    'counter_identity=$(stat -Lc "%d:%i" -- "$counter" 2>/dev/null) || { printf "Task id sequence is unsafe" >&2; exit 6; }',
    'exec 6< "$counter" || { printf "Task id sequence cannot be opened" >&2; exit 6; }',
    'counter_fd="/proc/$$/fd/6"',
    'opened_counter_real=$(realpath -- "$counter_fd") || { printf "Task id sequence handle cannot be resolved" >&2; exit 6; }',
    'opened_counter_identity=$(stat -Lc "%d:%i" -- "$counter_fd" 2>/dev/null) || { printf "Task id sequence is unsafe" >&2; exit 6; }',
    'if [ "$opened_counter_real" != "$counter_real" ] || [ "$opened_counter_identity" != "$counter_identity" ]; then printf "Task id sequence changed during validation" >&2; exit 6; fi',
    'if [ ! -f "$counter_fd" ] || [ "$(stat -Lc %h -- "$counter_fd" 2>/dev/null)" != 1 ]; then printf "Task id sequence is multiply linked" >&2; exit 6; fi',
    'cat -- "$counter_fd"',
  ]);
  return parseProjectTaskHighWater(output);
}

export async function inspectProjectSystem(workspace: Workspace): Promise<ProjectSystemStatus> {
  const files = await inspectFiles(workspace);
  const tasksFile = files.find((file) => file.name === 'TASKS.md');
  const tasks = tasksFile?.exists && tasksFile.safe ? parseProjectTasks(await readTasks(workspace)) : [];
  const highWater = await readProjectTaskHighWater(workspace);
  return { files, tasks, nextTaskId: nextProjectTaskId(tasks, highWater), ready: files.every((file) => file.exists && file.safe) };
}

export async function initializeProjectSystem(workspace: Workspace): Promise<ProjectSystemStatus> {
  const statements: string[] = [];
  for (const name of PROJECT_FILES) {
    statements.push(
      `target="$root_fd/${name}"`,
      'if [ -L "$target" ]; then target_real=$(realpath -- "$target" 2>/dev/null || true); case "$target_real" in "$root_real"/*) ;; *) printf "Refusing unsafe project-file symlink: %s" "$target" >&2; exit 4 ;; esac; fi',
      'if [ -e "$target" ] && [ ! -f "$target" ]; then printf "Project workflow path is not a regular file: %s" "$target" >&2; exit 4; fi',
      `if [ ! -e "$target" ] && [ ! -L "$target" ]; then (umask 022; set -C; printf %s ${shellQuote(PROJECT_TEMPLATES[name])} > "$target") 2>/dev/null || true; fi`,
      'if [ -L "$target" ]; then target_real=$(realpath -- "$target" 2>/dev/null || true); case "$target_real" in "$root_real"/*) ;; *) printf "Refusing unsafe project-file symlink: %s" "$target" >&2; exit 4 ;; esac; fi',
      'if [ ! -f "$target" ]; then printf "Project workflow path is not a regular file: %s" "$target" >&2; exit 4; fi',
      'target_real=$(realpath -- "$target") || { printf "Project workflow path cannot be resolved: %s" "$target" >&2; exit 4; }',
      'case "$target_real" in "$root_real"/*) ;; *) printf "Project workflow path resolves outside the workspace: %s" "$target" >&2; exit 4 ;; esac',
      'if [ "$(stat -c %h -- "$target_real" 2>/dev/null)" != 1 ]; then printf "Project workflow file is multiply linked: %s" "$target" >&2; exit 4; fi',
    );
  }
  await runProjectScript(workspace, statements);
  return inspectProjectSystem(workspace);
}

function projectWorkbenchDirectoryStatements(createIfMissing = true): string[] {
  return [
    'workbench_dir="$root_fd/.workbench"',
    createIfMissing
      ? 'if [ -L "$workbench_dir" ]; then printf "Refusing unsafe task metadata directory" >&2; exit 6; elif [ -e "$workbench_dir" ] && [ ! -d "$workbench_dir" ]; then printf "Task metadata path is not a directory" >&2; exit 6; elif [ ! -e "$workbench_dir" ]; then mkdir -- "$workbench_dir" 2>/dev/null || true; fi'
      : 'if [ -L "$workbench_dir" ]; then printf "Refusing unsafe task metadata directory" >&2; exit 6; elif [ -e "$workbench_dir" ] && [ ! -d "$workbench_dir" ]; then printf "Task metadata path is not a directory" >&2; exit 6; elif [ ! -e "$workbench_dir" ]; then exit 0; fi',
    'if [ -L "$workbench_dir" ] || [ ! -d "$workbench_dir" ]; then printf "Task metadata directory is unsafe" >&2; exit 6; fi',
    'workbench_dir_real=$(realpath -- "$workbench_dir") || { printf "Task metadata directory cannot be resolved" >&2; exit 6; }',
    'case "$workbench_dir_real" in "$root_real"/*) ;; *) printf "Task metadata directory resolves outside the workspace" >&2; exit 6 ;; esac',
    'workbench_dir_identity=$(stat -Lc "%d:%i" -- "$workbench_dir" 2>/dev/null) || { printf "Task metadata directory is unsafe" >&2; exit 6; }',
    'exec 7< "$workbench_dir" || { printf "Task metadata directory cannot be opened" >&2; exit 6; }',
    'workbench_dir_fd="/proc/$$/fd/7"',
    'opened_workbench_dir_real=$(realpath -- "$workbench_dir_fd") || { printf "Task metadata directory handle cannot be resolved" >&2; exit 6; }',
    'opened_workbench_dir_identity=$(stat -Lc "%d:%i" -- "$workbench_dir_fd" 2>/dev/null) || { printf "Task metadata directory is unsafe" >&2; exit 6; }',
    'if [ ! -d "$workbench_dir_fd" ] || [ "$opened_workbench_dir_real" != "$workbench_dir_real" ] || [ "$opened_workbench_dir_identity" != "$workbench_dir_identity" ]; then printf "Task metadata directory changed during validation" >&2; exit 6; fi',
  ];
}

function projectTaskLockStatements(): string[] {
  return [
    ...projectWorkbenchDirectoryStatements(),
    'command -v flock >/dev/null 2>&1 || { printf "Workspace task locking requires flock" >&2; exit 9; }',
    'lock_file="$workbench_dir_fd/task-sequence.lock"',
    'if [ -L "$lock_file" ] || { [ -e "$lock_file" ] && [ ! -f "$lock_file" ]; }; then printf "Task id lock is unsafe" >&2; exit 9; fi',
    'if [ ! -e "$lock_file" ]; then (umask 077; set -C; : > "$lock_file") 2>/dev/null || true; fi',
    'if [ -L "$lock_file" ] || [ ! -f "$lock_file" ]; then printf "Task id lock is unsafe" >&2; exit 9; fi',
    'lock_real=$(realpath -- "$lock_file") || { printf "Task id lock cannot be resolved" >&2; exit 9; }',
    'case "$lock_real" in "$root_real"/*) ;; *) printf "Task id lock resolves outside the workspace" >&2; exit 9 ;; esac',
    'lock_identity=$(stat -Lc "%d:%i" -- "$lock_file" 2>/dev/null) || { printf "Task id lock is unsafe" >&2; exit 9; }',
    'exec 9<> "$lock_file" || { printf "Task id lock cannot be opened" >&2; exit 9; }',
    'lock_fd="/proc/$$/fd/9"',
    'opened_lock_real=$(realpath -- "$lock_fd") || { printf "Task id lock handle cannot be resolved" >&2; exit 9; }',
    'opened_lock_identity=$(stat -Lc "%d:%i" -- "$lock_fd" 2>/dev/null) || { printf "Task id lock is unsafe" >&2; exit 9; }',
    'if [ "$opened_lock_real" != "$lock_real" ] || [ "$opened_lock_identity" != "$lock_identity" ]; then printf "Task id lock changed during validation" >&2; exit 9; fi',
    'if [ ! -f "$lock_fd" ] || [ "$(stat -Lc %h -- "$lock_fd" 2>/dev/null)" != 1 ]; then printf "Task id lock is multiply linked" >&2; exit 9; fi',
    'flock -w 10 -x 9 || { printf "Timed out waiting for the workspace task lock" >&2; exit 9; }',
  ];
}

function projectImageDirectoryStatements(): string[] {
  return [
    ...projectWorkbenchDirectoryStatements(),
    'image_dir="$workbench_dir_fd/task-images"',
    'if [ -L "$image_dir" ]; then printf "Refusing unsafe task-image directory" >&2; exit 6; elif [ -e "$image_dir" ] && [ ! -d "$image_dir" ]; then printf "Task-image path is not a directory" >&2; exit 6; elif [ ! -e "$image_dir" ]; then mkdir -- "$image_dir" 2>/dev/null || true; fi',
    'if [ -L "$image_dir" ] || [ ! -d "$image_dir" ]; then printf "Task-image directory is unsafe" >&2; exit 6; fi',
    'image_dir_real=$(realpath -- "$image_dir") || { printf "Task-image directory cannot be resolved" >&2; exit 6; }',
    'case "$image_dir_real" in "$root_real"/*) ;; *) printf "Task-image directory resolves outside the workspace" >&2; exit 6 ;; esac',
    'image_dir_identity=$(stat -Lc "%d:%i" -- "$image_dir" 2>/dev/null) || { printf "Task-image directory is unsafe" >&2; exit 6; }',
    'exec 8< "$image_dir" || { printf "Task-image directory cannot be opened" >&2; exit 6; }',
    'image_dir_fd="/proc/$$/fd/8"',
    'opened_image_dir_real=$(realpath -- "$image_dir_fd") || { printf "Task-image directory handle cannot be resolved" >&2; exit 6; }',
    'opened_image_dir_identity=$(stat -Lc "%d:%i" -- "$image_dir_fd" 2>/dev/null) || { printf "Task-image directory is unsafe" >&2; exit 6; }',
    'if [ ! -d "$image_dir_fd" ] || [ "$opened_image_dir_real" != "$image_dir_real" ] || [ "$opened_image_dir_identity" != "$image_dir_identity" ]; then printf "Task-image directory changed during validation" >&2; exit 6; fi',
  ];
}

async function reserveProjectTaskId(workspace: Workspace, tasks: ProjectTask[]): Promise<string> {
  const minimum = Number(/-(\d+)$/.exec(nextProjectTaskId(tasks))?.[1] ?? 1);
  const output = await runProjectScript(workspace, [
    ...projectTaskLockStatements(),
    'counter="$workbench_dir_fd/task-sequence"',
    'if [ -L "$counter" ] || { [ -e "$counter" ] && [ ! -f "$counter" ]; }; then printf "Task id sequence is unsafe" >&2; exit 9; fi',
    'sequence=0',
    'if [ -f "$counter" ]; then counter_real=$(realpath -- "$counter") || { printf "Task id sequence cannot be resolved" >&2; exit 9; }; case "$counter_real" in "$root_real"/*) ;; *) printf "Task id sequence resolves outside the workspace" >&2; exit 9 ;; esac; counter_identity=$(stat -Lc "%d:%i" -- "$counter" 2>/dev/null) || { printf "Task id sequence is unsafe" >&2; exit 9; }; exec 6< "$counter" || { printf "Task id sequence cannot be opened" >&2; exit 9; }; counter_fd="/proc/$$/fd/6"; opened_counter_real=$(realpath -- "$counter_fd") || { printf "Task id sequence handle cannot be resolved" >&2; exit 9; }; opened_counter_identity=$(stat -Lc "%d:%i" -- "$counter_fd" 2>/dev/null) || { printf "Task id sequence is unsafe" >&2; exit 9; }; if [ "$opened_counter_real" != "$counter_real" ] || [ "$opened_counter_identity" != "$counter_identity" ]; then printf "Task id sequence changed during validation" >&2; exit 9; fi; if [ ! -f "$counter_fd" ] || [ "$(stat -Lc %h -- "$counter_fd" 2>/dev/null)" != 1 ]; then printf "Task id sequence is multiply linked" >&2; exit 9; fi; sequence=$(cat -- "$counter_fd"); fi',
    'case "$sequence" in ""|*[!0-9]*) printf "Task id sequence is corrupt" >&2; exit 9 ;; esac',
    'if [ "${#sequence}" -gt 16 ]; then printf "Task id sequence is exhausted" >&2; exit 9; fi',
    `minimum=${minimum}`,
    'next="$minimum"',
    'if [ "$sequence" -ge "$next" ]; then next=$((sequence + 1)); fi',
    'if [ "$next" -ge 9007199254740991 ]; then printf "Task id sequence is exhausted" >&2; exit 9; fi',
    'temporary="$workbench_dir_fd/.task-sequence.$$"',
    'trap \'rm -f -- "$temporary"\' EXIT',
    'if ! (umask 077; set -C; printf "%s\\n" "$next" > "$temporary") 2>/dev/null; then printf "Task id sequence could not be reserved" >&2; exit 9; fi',
    'mv -fT -- "$temporary" "$counter" || { printf "Task id sequence could not be updated" >&2; exit 9; }',
    'trap - EXIT',
    'printf "%s\\n" "$next"',
  ]);
  const reserved = parseProjectTaskHighWater(output);
  return `WB-${String(reserved).padStart(3, '0')}`;
}

function taskImageFilename(attachment: ProjectTaskAttachment): string {
  const filename = attachment.path.split('/').at(-1) ?? '';
  if (!/^[A-Za-z][A-Za-z0-9_-]*-\d+-(?:0[1-4])\.(?:png|jpg|webp)$/.test(filename)) {
    throw new Error('Task image filename is invalid.');
  }
  return filename;
}

async function writeProjectTaskImage(
  workspace: Workspace,
  attachment: ProjectTaskAttachment,
  bytes: Uint8Array,
): Promise<void> {
  const filename = taskImageFilename(attachment);
  await runProjectScript(workspace, [
    ...projectImageDirectoryStatements(),
    `target="$image_dir_fd/${filename}"`,
    'if [ -e "$target" ] || [ -L "$target" ]; then printf "Task image already exists" >&2; exit 7; fi',
    `temporary="$image_dir_fd/.${filename}.$$"`,
    'trap \'rm -f -- "$temporary"\' EXIT',
    'umask 077',
    'set -C',
    'exec 3> "$temporary" || { set +C; printf "Task image could not be created" >&2; exit 8; }',
    'set +C',
    'temporary_fd="/proc/$$/fd/3"',
    'temporary_identity=$(stat -Lc "%d:%i" -- "$temporary_fd" 2>/dev/null) || { printf "Task image temporary file is unsafe" >&2; exit 8; }',
    'if [ ! -f "$temporary_fd" ] || [ "$(stat -Lc %h -- "$temporary_fd" 2>/dev/null)" != 1 ]; then printf "Task image temporary file is unsafe" >&2; exit 8; fi',
    'cat >&3 || { printf "Task image could not be written" >&2; exit 8; }',
    `actual=$(stat -Lc %s -- "$temporary_fd" 2>/dev/null) || { printf "Task image temporary file is unsafe" >&2; exit 8; }; if [ "$actual" -ne ${bytes.length} ]; then printf "Task image write was incomplete" >&2; exit 8; fi`,
    'if [ "$(stat -Lc "%d:%i" -- "$temporary_fd" 2>/dev/null)" != "$temporary_identity" ] || [ "$(stat -Lc %h -- "$temporary_fd" 2>/dev/null)" != 1 ]; then printf "Task image temporary file changed during writing" >&2; exit 8; fi',
    'chmod 0644 "$temporary_fd" || { printf "Task image permissions could not be set" >&2; exit 8; }',
    'if ! ln -LT -- "$temporary_fd" "$target" 2>/dev/null; then if [ -e "$target" ] || [ -L "$target" ]; then printf "Task image already exists" >&2; exit 7; else printf "Task image could not be installed" >&2; exit 8; fi; fi',
    'target_identity=$(stat -Lc "%d:%i" -- "$target" 2>/dev/null) || { rm -f -- "$target"; printf "Task image installation is unsafe" >&2; exit 8; }',
    'if [ -L "$target" ] || [ ! -f "$target" ] || [ "$target_identity" != "$temporary_identity" ]; then rm -f -- "$target"; printf "Task image installation changed during validation" >&2; exit 8; fi',
    'rm -f -- "$temporary" || { rm -f -- "$target"; printf "Task image temporary file could not be removed" >&2; exit 8; }',
    'if [ "$(stat -Lc "%d:%i" -- "$temporary_fd" 2>/dev/null)" != "$temporary_identity" ] || [ "$(stat -Lc %h -- "$temporary_fd" 2>/dev/null)" != 1 ] || [ "$(stat -Lc "%d:%i" -- "$target" 2>/dev/null)" != "$temporary_identity" ]; then rm -f -- "$target"; printf "Task image installation changed during validation" >&2; exit 8; fi',
    'exec 3>&-',
    'trap - EXIT',
  ], bytes);
}

async function cleanupProjectTaskImages(
  workspace: Workspace,
  attachments: ProjectTaskAttachment[],
): Promise<void> {
  if (!attachments.length) return;
  const filenames = attachments.map(taskImageFilename);
  await runProjectScript(workspace, [
    ...projectImageDirectoryStatements(),
    ...filenames.map((filename) => `rm -f -- "$image_dir_fd/${filename}"`),
  ]);
}

async function addProjectTaskNow(workspace: Workspace, draft: ProjectTaskDraft): Promise<ProjectSystemStatus> {
  if (!draft || typeof draft !== 'object') throw new Error('Task details are invalid.');
  if (draft.priority !== 'P0' && draft.priority !== 'P1' && draft.priority !== 'P2' && draft.priority !== 'P3') {
    throw new Error('Choose a task priority.');
  }
  if (!cleanSingleLine(draft.title, 180)) throw new Error('Enter a task title.');
  const initializedStatus = await initializeProjectSystem(workspace);
  const existingTasks = parseProjectTasks(await readTasks(workspace));
  const parentId = cleanSingleLine(draft.parentId, 100);
  if (parentId && !hasValidProjectTaskParentChain(existingTasks, parentId)) {
    throw new Error('Choose an existing parent task.');
  }
  const rawImages = Array.isArray(draft.images) ? draft.images : [];
  if (rawImages.length > MAX_TASK_IMAGES) throw new Error(`Attach no more than ${MAX_TASK_IMAGES} images.`);
  const images: ValidatedProjectImage[] = [];
  for (const rawImage of rawImages) {
    images.push(await validateProjectTaskImage(rawImage));
  }
  const totalBytes = images.reduce((total, image) => total + image.bytes.length, 0);
  if (totalBytes > MAX_TASK_IMAGE_TOTAL_BYTES) throw new Error('Task images must total 12 MB or less.');
  const taskId = await reserveProjectTaskId(workspace, existingTasks);
  const attachments: ProjectTaskAttachment[] = images.map((image, index) => ({
    path: `${PROJECT_IMAGE_DIRECTORY}/${taskId}-${String(index + 1).padStart(2, '0')}.${image.extension}`,
    mediaType: image.mediaType,
  }));
  const task = formatProjectTask({ ...draft, parentId: parentId || null }, taskId, attachments);
  const createdTask = parseProjectTasks(task)[0];
  if (!createdTask || createdTask.id !== taskId) throw new Error('Task details could not be formatted.');
  const committedTasks = [...existingTasks, createdTask];
  const committedStatus: ProjectSystemStatus = {
    files: initializedStatus.files,
    tasks: committedTasks,
    nextTaskId: nextProjectTaskId(committedTasks, Number(/-(\d+)$/.exec(taskId)?.[1] ?? 0)),
    ready: initializedStatus.ready,
  };
  const written: ProjectTaskAttachment[] = [];
  try {
    for (const [index, image] of images.entries()) {
      const attachment = attachments[index];
      if (!attachment) continue;
      await writeProjectTaskImage(workspace, attachment, image.bytes);
      written.push(attachment);
    }
    await runProjectScript(workspace, [
      ...projectTaskLockStatements(),
      ...projectTasksFileHandleStatements('append'),
      `if grep -Eq ${shellQuote(`^###[[:space:]]+${taskId}([[:space:]]|$)`)} "$target_fd"; then printf "Task id already exists" >&2; exit 5; fi`,
      `printf '\\n%s\\n' ${shellQuote(task)} >&4`,
    ]);
  } catch (error) {
    try {
      await cleanupProjectTaskImages(workspace, written);
    } catch (cleanupError) {
      const primary = error instanceof Error ? error.message : String(error);
      const cleanup = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      throw new Error(`${primary} Cleanup of newly written task images also failed: ${cleanup}`);
    }
    throw error;
  }
  try {
    return await inspectProjectSystem(workspace);
  } catch {
    return committedStatus;
  }
}

export function addProjectTask(workspace: Workspace, draft: ProjectTaskDraft): Promise<ProjectSystemStatus> {
  const queueKey = `${workspace.distro}\u0000${workspace.root}`;
  const previous = projectTaskMutationQueues.get(queueKey);
  const operation = (previous?.catch(() => undefined) ?? Promise.resolve())
    .then(() => addProjectTaskNow(workspace, draft));
  projectTaskMutationQueues.set(queueKey, operation);
  return operation.finally(() => {
    if (projectTaskMutationQueues.get(queueKey) === operation) projectTaskMutationQueues.delete(queueKey);
  });
}
