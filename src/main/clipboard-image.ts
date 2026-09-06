import type { ProjectTaskImageDraft } from '../shared/types';
import { validateProjectTaskImage } from './project-system';

const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
const MAX_TASK_IMAGE_BYTES = 5 * 1024 * 1024;

interface ClipboardBlobLike {
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface ClipboardItemLike {
  readonly types: readonly string[];
  getType(type: string): Promise<unknown>;
}

function isClipboardBlob(value: unknown): value is ClipboardBlobLike {
  return typeof value === 'object'
    && value !== null
    && typeof (value as Partial<ClipboardBlobLike>).size === 'number'
    && typeof (value as Partial<ClipboardBlobLike>).arrayBuffer === 'function';
}

export async function taskImageFromClipboardItems(
  items: readonly ClipboardItemLike[],
): Promise<ProjectTaskImageDraft | null> {
  for (const item of items) {
    const mediaType = SUPPORTED_IMAGE_TYPES.find((candidate) => item.types.includes(candidate));
    if (!mediaType) continue;
    const blob = await item.getType(mediaType);
    if (!isClipboardBlob(blob)) throw new Error('Clipboard image data is invalid.');
    if (!Number.isSafeInteger(blob.size) || blob.size <= 0) throw new Error('Clipboard image data is invalid.');
    if (blob.size > MAX_TASK_IMAGE_BYTES) throw new Error('Each task image must be 5 MB or smaller.');
    const validated = await validateProjectTaskImage({
      mediaType,
      bytes: new Uint8Array(await blob.arrayBuffer()),
    });
    return {
      name: `Pasted image.${validated.extension}`,
      mediaType: validated.mediaType,
      bytes: validated.bytes,
    };
  }
  return null;
}
