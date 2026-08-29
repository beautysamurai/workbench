import path from 'node:path';
import type { ContextBuildResult, WorkbenchSettings, Workspace } from '../shared/types';
import { formatContextPack, type ContextFileContent } from './context-format';
import { resolveWorkspacePath, shellQuote } from './path-utils';
import { getGitStatus, isPathInsideWorkspace, runWslCommand } from './wsl';

function humanError(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

async function readContextFile(
  workspace: Workspace,
  item: Workspace['contextItems'][number],
  maxBytes: number,
): Promise<ContextFileContent> {
  const absolutePath = resolveWorkspacePath(workspace.root, item.value);
  if (!isPathInsideWorkspace(workspace, absolutePath)) {
    return {
      item,
      absolutePath,
      content: '',
      truncated: false,
      error: 'Files outside the workspace root are blocked.',
    };
  }

  if (!item.includeContent) {
    return { item, absolutePath, content: '', truncated: false };
  }

  const command = [
    `root=${shellQuote(workspace.root)}`,
    `target=${shellQuote(absolutePath)}`,
    'if [ ! -f "$target" ]; then printf "File not found" >&2; exit 2; fi',
    'root_real=$(realpath -- "$root") || { printf "Workspace root not found" >&2; exit 3; }',
    'target_real=$(realpath -- "$target") || { printf "File not found" >&2; exit 2; }',
    'case "$target_real" in "$root_real"|"$root_real"/*) ;; *) printf "Resolved path is outside the workspace root" >&2; exit 4 ;; esac',
    'size=$(wc -c < "$target_real")',
    'printf "\n__WORKBENCH_SIZE__=%s\n" "$size" >&2',
    `head -c ${Math.max(1, Math.floor(maxBytes))} -- "$target_real"`,
  ].join('; ');

  try {
    const result = await runWslCommand(workspace.distro, command, 30_000);
    const sizeMatch = /__WORKBENCH_SIZE__=(\d+)/.exec(result.stderr);
    const size = sizeMatch ? Number(sizeMatch[1]) : Buffer.byteLength(result.stdout, 'utf8');
    const stderr = result.stderr.replace(/\n?__WORKBENCH_SIZE__=\d+\n?/g, '').trim();
    if (result.code !== 0) {
      return {
        item,
        absolutePath,
        content: '',
        truncated: false,
        error: stderr || `Could not read file (exit ${result.code ?? 'unknown'}).`,
      };
    }
    if (result.stdout.includes('\u0000')) {
      return {
        item,
        absolutePath,
        content: '',
        truncated: false,
        error: 'Binary files are not included in context packs.',
      };
    }
    return {
      item,
      absolutePath,
      content: result.stdout,
      truncated: size > maxBytes,
    };
  } catch (error) {
    return {
      item,
      absolutePath,
      content: '',
      truncated: false,
      error: humanError(error),
    };
  }
}

export async function buildContextPack(
  workspace: Workspace,
  settings: WorkbenchSettings,
): Promise<ContextBuildResult> {
  const git = await getGitStatus(workspace);
  const fileItems = workspace.contextItems.filter((item) => item.type === 'file');
  const files = await Promise.all(
    fileItems.map((item) => readContextFile(workspace, item, settings.maxContextFileBytes)),
  );
  const warnings: string[] = [];
  for (const file of files) {
    if (file.error) warnings.push(`${file.item.label}: ${file.error}`);
    if (file.truncated) warnings.push(`${file.item.label}: truncated at ${settings.maxContextFileBytes} bytes.`);
  }
  return {
    markdown: formatContextPack({ workspace, git, files, generatedAt: new Date() }),
    includedFiles: files.filter((file) => !file.error && file.item.includeContent).length,
    truncatedFiles: files.filter((file) => file.truncated).length,
    warnings,
  };
}

export function suggestedContextFileName(workspace: Workspace): string {
  const safeName = workspace.name
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'workspace';
  return path.win32.basename(`${safeName}-context.md`);
}
