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
const PROJECT_IMAGE_DIRECTORY = '.workbench/task-images';
const MAX_TASK_IMAGES = 4;
const MAX_TASK_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TASK_IMAGE_TOTAL_BYTES = 12 * 1024 * 1024;
const projectTaskMutationQueues = new Map<string, Promise<ProjectSystemStatus>>();

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
      parentId: isProjectTaskId(parentId) ? parentId : null,
      acceptanceCriteria: parseAcceptanceCriteria(block),
      attachments: parseAttachments(block),
    };
  }).filter((task) => isProjectTaskId(task.id) && task.title);
}

export function nextProjectTaskId(tasks: ProjectTask[], highWater = 0): string {
  const maximum = tasks.reduce((current, task) => {
    const suffix = Number(/-(\d+)$/.exec(task.id)?.[1] ?? 0);
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
  if (parentId && !isProjectTaskId(parentId)) throw new Error('Parent task id is invalid.');
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
  return width > 0 && height > 0 && width <= 16_384 && height <= 16_384 && width * height <= 40_000_000;
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

function isStructuredPng(bytes: Uint8Array): boolean {
  if (bytes.length < 45 || !startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return false;
  let offset = 8;
  let colorType = -1;
  let bitDepth = 0;
  let hasPalette = false;
  let hasImageData = false;
  let imageDataEnded = false;
  let imageDataBytes = 0;

  while (offset < bytes.length) {
    if (offset + 12 > bytes.length || !isPngChunkType(bytes, offset + 4)) return false;
    const length = uint32BigEndian(bytes, offset);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (dataEnd < dataStart || chunkEnd > bytes.length) return false;
    if (pngCrc32(bytes, offset + 4, dataEnd) !== uint32BigEndian(bytes, dataEnd)) return false;

    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    if (offset === 8) {
      if (type !== 'IHDR' || length !== 13 || !validPngHeader(bytes, dataStart)) return false;
      bitDepth = bytes[dataStart + 8] ?? 0;
      colorType = bytes[dataStart + 9] ?? -1;
    } else if (type === 'IHDR') {
      return false;
    } else if (type === 'PLTE') {
      const entries = length / 3;
      if (hasPalette || hasImageData || colorType === 0 || colorType === 4
        || length === 0 || length % 3 !== 0 || entries > 256
        || (colorType === 3 && entries > (2 ** bitDepth))) return false;
      hasPalette = true;
    } else if (type === 'IDAT') {
      if (imageDataEnded) return false;
      hasImageData = true;
      imageDataBytes += length;
    } else if (type === 'IEND') {
      return length === 0
        && hasImageData
        && imageDataBytes > 0
        && (colorType !== 3 || hasPalette)
        && chunkEnd === bytes.length;
    } else {
      if ((bytes[offset + 4] ?? 0) >= 0x41 && (bytes[offset + 4] ?? 0) <= 0x5a) return false;
      if (hasImageData) imageDataEnded = true;
    }
    offset = chunkEnd;
  }
  return false;
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

function isStructuredVp8Payload(bytes: Uint8Array, start: number, length: number): boolean {
  if (length <= 10 || !startsWithBytes(bytes, [0x9d, 0x01, 0x2a], start + 3)) return false;
  const frameTag = uint24LittleEndian(bytes, start);
  const isKeyFrame = (frameTag & 0x01) === 0;
  const version = (frameTag >>> 1) & 0x07;
  const showFrame = ((frameTag >>> 4) & 0x01) === 1;
  const firstPartitionLength = frameTag >>> 5;
  const bytesAfterFrameHeader = length - 10;
  if (!isKeyFrame || version > 3 || !showFrame
    || firstPartitionLength === 0 || firstPartitionLength >= bytesAfterFrameHeader) return false;
  const width = ((bytes[start + 6] ?? 0) + ((bytes[start + 7] ?? 0) << 8)) & 0x3fff;
  const height = ((bytes[start + 8] ?? 0) + ((bytes[start + 9] ?? 0) << 8)) & 0x3fff;
  return validImageDimensions(width, height);
}

function isStructuredVp8lPayload(bytes: Uint8Array, start: number, length: number): boolean {
  if (length <= 5 || bytes[start] !== 0x2f) return false;
  const dimensions = uint32LittleEndian(bytes, start + 1);
  const width = (dimensions & 0x3fff) + 1;
  const height = ((dimensions >>> 14) & 0x3fff) + 1;
  return (dimensions >>> 29) === 0 && validImageDimensions(width, height);
}

function isStructuredVp8xPayload(bytes: Uint8Array, start: number, length: number): boolean {
  if (length !== 10
    || ((bytes[start] ?? 0) & 0xc1) !== 0
    || bytes[start + 1] !== 0
    || bytes[start + 2] !== 0
    || bytes[start + 3] !== 0) return false;
  const width = uint24LittleEndian(bytes, start + 4) + 1;
  const height = uint24LittleEndian(bytes, start + 7) + 1;
  return validImageDimensions(width, height);
}

function hasStructuredWebpImageChunks(
  bytes: Uint8Array,
  start: number,
  end: number,
  nested = false,
): boolean {
  let offset = start;
  let hasImage = false;
  while (offset < end) {
    if (offset + 8 > end) return false;
    const chunkType = String.fromCharCode(...bytes.slice(offset, offset + 4));
    const chunkLength = uint32LittleEndian(bytes, offset + 4);
    const payloadStart = offset + 8;
    const payloadEnd = payloadStart + chunkLength;
    const paddedEnd = payloadEnd + (chunkLength % 2);
    if (payloadEnd < payloadStart || paddedEnd > end) return false;

    if (chunkType === 'VP8 ') {
      if (!isStructuredVp8Payload(bytes, payloadStart, chunkLength)) return false;
      hasImage = true;
    } else if (chunkType === 'VP8L') {
      if (!isStructuredVp8lPayload(bytes, payloadStart, chunkLength)) return false;
      hasImage = true;
    } else if (chunkType === 'VP8X') {
      if (nested || offset !== start || !isStructuredVp8xPayload(bytes, payloadStart, chunkLength)) return false;
    } else if (chunkType === 'ANMF') {
      if (nested || chunkLength < 24) return false;
      const width = uint24LittleEndian(bytes, payloadStart + 6) + 1;
      const height = uint24LittleEndian(bytes, payloadStart + 9) + 1;
      if (!validImageDimensions(width, height)
        || !hasStructuredWebpImageChunks(bytes, payloadStart + 16, payloadEnd, true)) return false;
      hasImage = true;
    }
    offset = paddedEnd;
  }
  return offset === end && hasImage;
}

function isStructuredWebp(bytes: Uint8Array): boolean {
  return bytes.length >= 20
    && startsWithBytes(bytes, [0x52, 0x49, 0x46, 0x46])
    && startsWithBytes(bytes, [0x57, 0x45, 0x42, 0x50], 8)
    && uint32LittleEndian(bytes, 4) + 8 === bytes.length
    && hasStructuredWebpImageChunks(bytes, 12, bytes.length);
}

export function validateProjectTaskImage(value: unknown): ValidatedProjectImage {
  const candidate = (value ?? {}) as Partial<ProjectTaskImageDraft>;
  if (!(candidate.bytes instanceof Uint8Array)) throw new Error('Pasted image data is invalid.');
  if (!candidate.bytes.byteLength) throw new Error('Pasted image is empty.');
  if (candidate.bytes.byteLength > MAX_TASK_IMAGE_BYTES) throw new Error('Each task image must be 5 MB or smaller.');
  const bytes = Uint8Array.from(candidate.bytes);
  if (isStructuredPng(bytes)) {
    return { bytes, mediaType: 'image/png', extension: 'png' };
  }
  if (isStructuredJpeg(bytes)) {
    return { bytes, mediaType: 'image/jpeg', extension: 'jpg' };
  }
  if (isStructuredWebp(bytes)) {
    return { bytes, mediaType: 'image/webp', extension: 'webp' };
  }
  throw new Error('Task images must be PNG, JPEG, or WebP files.');
}

function rootSetup(workspace: Workspace): string[] {
  return [
    `root=${shellQuote(workspace.root)}`,
    'root_real=$(realpath -- "$root") || { printf "Workspace root not found" >&2; exit 2; }',
    'if [ ! -d "$root_real" ]; then printf "Workspace root is not a directory" >&2; exit 2; fi',
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

async function inspectFiles(workspace: Workspace): Promise<ProjectSystemFile[]> {
  const statements = PROJECT_FILES.flatMap((name) => [
    `target="$root_real/${name}"`,
    `if [ ! -e "$target" ] && [ ! -L "$target" ]; then printf '${name}\\tmissing\\n'; else target_real=$(realpath -- "$target" 2>/dev/null || true); case "$target_real" in "$root_real"/*) if [ -f "$target_real" ]; then printf '${name}\\tpresent\\n'; else printf '${name}\\tunsafe\\n'; fi ;; *) printf '${name}\\tunsafe\\n' ;; esac; fi`,
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
    'target="$root_real/TASKS.md"',
    'if [ ! -e "$target" ]; then exit 0; fi',
    'target_real=$(realpath -- "$target") || { printf "TASKS.md cannot be resolved" >&2; exit 3; }',
    'case "$target_real" in "$root_real"/*) ;; *) printf "TASKS.md resolves outside the workspace" >&2; exit 4 ;; esac',
    'if [ ! -f "$target_real" ]; then printf "TASKS.md is not a regular file" >&2; exit 4; fi',
    'cat -- "$target_real"',
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
    'workbench_dir="$root_real/.workbench"',
    'if [ ! -e "$workbench_dir" ] && [ ! -L "$workbench_dir" ]; then exit 0; fi',
    'if [ -L "$workbench_dir" ] || [ ! -d "$workbench_dir" ]; then printf "Task metadata directory is unsafe" >&2; exit 6; fi',
    'workbench_dir_real=$(realpath -- "$workbench_dir") || { printf "Task metadata directory cannot be resolved" >&2; exit 6; }',
    'case "$workbench_dir_real" in "$root_real"/*) ;; *) printf "Task metadata directory resolves outside the workspace" >&2; exit 6 ;; esac',
    'counter="$workbench_dir_real/task-sequence"',
    'if [ ! -e "$counter" ] && [ ! -L "$counter" ]; then exit 0; fi',
    'if [ -L "$counter" ] || [ ! -f "$counter" ]; then printf "Task id sequence is unsafe" >&2; exit 6; fi',
    'counter_real=$(realpath -- "$counter") || { printf "Task id sequence cannot be resolved" >&2; exit 6; }',
    'case "$counter_real" in "$root_real"/*) ;; *) printf "Task id sequence resolves outside the workspace" >&2; exit 6 ;; esac',
    'cat -- "$counter_real"',
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
      `target="$root_real/${name}"`,
      'if [ -L "$target" ]; then target_real=$(realpath -- "$target" 2>/dev/null || true); case "$target_real" in "$root_real"/*) ;; *) printf "Refusing unsafe project-file symlink: %s" "$target" >&2; exit 4 ;; esac; fi',
      'if [ -e "$target" ] && [ ! -f "$target" ]; then printf "Project workflow path is not a regular file: %s" "$target" >&2; exit 4; fi',
      `if [ ! -e "$target" ] && [ ! -L "$target" ]; then (umask 022; set -C; printf %s ${shellQuote(PROJECT_TEMPLATES[name])} > "$target") 2>/dev/null || true; fi`,
      'if [ -L "$target" ]; then target_real=$(realpath -- "$target" 2>/dev/null || true); case "$target_real" in "$root_real"/*) ;; *) printf "Refusing unsafe project-file symlink: %s" "$target" >&2; exit 4 ;; esac; fi',
      'if [ ! -f "$target" ]; then printf "Project workflow path is not a regular file: %s" "$target" >&2; exit 4; fi',
    );
  }
  await runProjectScript(workspace, statements);
  return inspectProjectSystem(workspace);
}

function projectWorkbenchDirectoryStatements(): string[] {
  return [
    'workbench_dir="$root_real/.workbench"',
    'if [ -L "$workbench_dir" ]; then printf "Refusing unsafe task metadata directory" >&2; exit 6; elif [ -e "$workbench_dir" ] && [ ! -d "$workbench_dir" ]; then printf "Task metadata path is not a directory" >&2; exit 6; elif [ ! -e "$workbench_dir" ]; then mkdir -- "$workbench_dir" 2>/dev/null || true; fi',
    'if [ -L "$workbench_dir" ] || [ ! -d "$workbench_dir" ]; then printf "Task metadata directory is unsafe" >&2; exit 6; fi',
    'workbench_dir_real=$(realpath -- "$workbench_dir") || { printf "Task metadata directory cannot be resolved" >&2; exit 6; }',
    'case "$workbench_dir_real" in "$root_real"/*) ;; *) printf "Task metadata directory resolves outside the workspace" >&2; exit 6 ;; esac',
  ];
}

function projectTaskLockStatements(): string[] {
  return [
    ...projectWorkbenchDirectoryStatements(),
    'command -v flock >/dev/null 2>&1 || { printf "Workspace task locking requires flock" >&2; exit 9; }',
    'lock_file="$workbench_dir_real/task-sequence.lock"',
    'if [ -L "$lock_file" ] || { [ -e "$lock_file" ] && [ ! -f "$lock_file" ]; }; then printf "Task id lock is unsafe" >&2; exit 9; fi',
    'if [ ! -e "$lock_file" ]; then (umask 077; set -C; : > "$lock_file") 2>/dev/null || true; fi',
    'if [ -L "$lock_file" ] || [ ! -f "$lock_file" ]; then printf "Task id lock is unsafe" >&2; exit 9; fi',
    'lock_real=$(realpath -- "$lock_file") || { printf "Task id lock cannot be resolved" >&2; exit 9; }',
    'case "$lock_real" in "$root_real"/*) ;; *) printf "Task id lock resolves outside the workspace" >&2; exit 9 ;; esac',
    'exec 9<> "$lock_real" || { printf "Task id lock cannot be opened" >&2; exit 9; }',
    'flock -w 10 -x 9 || { printf "Timed out waiting for the workspace task lock" >&2; exit 9; }',
  ];
}

function projectImageDirectoryStatements(): string[] {
  return [
    ...projectWorkbenchDirectoryStatements(),
    'image_dir="$workbench_dir_real/task-images"',
    'if [ -L "$image_dir" ]; then printf "Refusing unsafe task-image directory" >&2; exit 6; elif [ -e "$image_dir" ] && [ ! -d "$image_dir" ]; then printf "Task-image path is not a directory" >&2; exit 6; elif [ ! -e "$image_dir" ]; then mkdir -- "$image_dir" 2>/dev/null || true; fi',
    'if [ -L "$image_dir" ] || [ ! -d "$image_dir" ]; then printf "Task-image directory is unsafe" >&2; exit 6; fi',
    'image_dir_real=$(realpath -- "$image_dir") || { printf "Task-image directory cannot be resolved" >&2; exit 6; }',
    'case "$image_dir_real" in "$root_real"/*) ;; *) printf "Task-image directory resolves outside the workspace" >&2; exit 6 ;; esac',
  ];
}

async function reserveProjectTaskId(workspace: Workspace, tasks: ProjectTask[]): Promise<string> {
  const minimum = Number(/-(\d+)$/.exec(nextProjectTaskId(tasks))?.[1] ?? 1);
  const output = await runProjectScript(workspace, [
    ...projectTaskLockStatements(),
    'counter="$workbench_dir_real/task-sequence"',
    'if [ -L "$counter" ] || { [ -e "$counter" ] && [ ! -f "$counter" ]; }; then printf "Task id sequence is unsafe" >&2; exit 9; fi',
    'sequence=0',
    'if [ -f "$counter" ]; then sequence=$(cat -- "$counter"); fi',
    'case "$sequence" in ""|*[!0-9]*) printf "Task id sequence is corrupt" >&2; exit 9 ;; esac',
    'if [ "${#sequence}" -gt 16 ]; then printf "Task id sequence is exhausted" >&2; exit 9; fi',
    `minimum=${minimum}`,
    'next="$minimum"',
    'if [ "$sequence" -ge "$next" ]; then next=$((sequence + 1)); fi',
    'if [ "$next" -ge 9007199254740991 ]; then printf "Task id sequence is exhausted" >&2; exit 9; fi',
    'temporary="$workbench_dir_real/.task-sequence.$$"',
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
    `target="$image_dir_real/${filename}"`,
    'if [ -e "$target" ] || [ -L "$target" ]; then printf "Task image already exists" >&2; exit 7; fi',
    `temporary="$image_dir_real/.${filename}.$$"`,
    'trap \'rm -f -- "$temporary"\' EXIT',
    'umask 077',
    'set -C',
    'cat > "$temporary" || { printf "Task image could not be written" >&2; exit 8; }',
    'set +C',
    `actual=$(wc -c < "$temporary"); if [ "$actual" -ne ${bytes.length} ]; then printf "Task image write was incomplete" >&2; exit 8; fi`,
    'chmod 0644 "$temporary"',
    'mv -n -- "$temporary" "$target"',
    'if [ -e "$temporary" ]; then printf "Task image already exists" >&2; exit 7; fi',
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
    ...filenames.map((filename) => `rm -f -- "$image_dir_real/${filename}"`),
  ]);
}

async function addProjectTaskNow(workspace: Workspace, draft: ProjectTaskDraft): Promise<ProjectSystemStatus> {
  if (!draft || typeof draft !== 'object') throw new Error('Task details are invalid.');
  if (draft.priority !== 'P0' && draft.priority !== 'P1' && draft.priority !== 'P2' && draft.priority !== 'P3') {
    throw new Error('Choose a task priority.');
  }
  if (!cleanSingleLine(draft.title, 180)) throw new Error('Enter a task title.');
  await initializeProjectSystem(workspace);
  const existingTasks = parseProjectTasks(await readTasks(workspace));
  const parentId = cleanSingleLine(draft.parentId, 100);
  if (parentId && !hasValidProjectTaskParentChain(existingTasks, parentId)) {
    throw new Error('Choose an existing parent task.');
  }
  const rawImages = Array.isArray(draft.images) ? draft.images : [];
  if (rawImages.length > MAX_TASK_IMAGES) throw new Error(`Attach no more than ${MAX_TASK_IMAGES} images.`);
  const images = rawImages.map(validateProjectTaskImage);
  const totalBytes = images.reduce((total, image) => total + image.bytes.length, 0);
  if (totalBytes > MAX_TASK_IMAGE_TOTAL_BYTES) throw new Error('Task images must total 12 MB or less.');
  const taskId = await reserveProjectTaskId(workspace, existingTasks);
  const attachments: ProjectTaskAttachment[] = images.map((image, index) => ({
    path: `${PROJECT_IMAGE_DIRECTORY}/${taskId}-${String(index + 1).padStart(2, '0')}.${image.extension}`,
    mediaType: image.mediaType,
  }));
  const written: ProjectTaskAttachment[] = [];
  try {
    for (const [index, image] of images.entries()) {
      const attachment = attachments[index];
      if (!attachment) continue;
      await writeProjectTaskImage(workspace, attachment, image.bytes);
      written.push(attachment);
    }
    const task = formatProjectTask({ ...draft, parentId: parentId || null }, taskId, attachments);
    await runProjectScript(workspace, [
      ...projectTaskLockStatements(),
      'target="$root_real/TASKS.md"',
      'target_real=$(realpath -- "$target") || { printf "TASKS.md cannot be resolved" >&2; exit 3; }',
      'case "$target_real" in "$root_real"/*) ;; *) printf "TASKS.md resolves outside the workspace" >&2; exit 4 ;; esac',
      'if [ ! -f "$target_real" ]; then printf "TASKS.md is not a regular file" >&2; exit 4; fi',
      `if grep -Eq ${shellQuote(`^###[[:space:]]+${taskId}([[:space:]]|$)`)} "$target_real"; then printf "Task id already exists" >&2; exit 5; fi`,
      `printf '\\n%s\\n' ${shellQuote(task)} >> "$target_real"`,
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
  return inspectProjectSystem(workspace);
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
