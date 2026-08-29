import type { ContextItem, GitStatus, Workspace } from '../shared/types';
import { languageForPath } from './path-utils';

export interface ContextFileContent {
  item: ContextItem;
  absolutePath: string;
  content: string;
  truncated: boolean;
  error?: string;
}

export interface FormatContextInput {
  workspace: Workspace;
  git: GitStatus;
  files: ContextFileContent[];
  generatedAt: Date;
}

function codeFence(content: string): string {
  let length = 3;
  while (content.includes('`'.repeat(length))) {
    length += 1;
  }
  return '`'.repeat(length);
}

export function formatContextPack(input: FormatContextInput): string {
  const { workspace, git, files, generatedAt } = input;
  const sections: string[] = [
    '# Workbench Context Pack',
    '',
    `Generated: ${generatedAt.toISOString()}`,
    '',
    '## Workspace',
    '',
    `- Name: ${workspace.name}`,
    `- Description: ${workspace.description || '(none)'}`,
    `- WSL distribution: ${workspace.distro}`,
    `- Root: ${workspace.root}`,
  ];

  sections.push('', '## Git');
  if (!git.isRepository) {
    sections.push('', git.error ? `Not available: ${git.error}` : 'This workspace is not a Git repository.');
  } else {
    sections.push(
      '',
      `- Branch: ${git.branch ?? '(detached)'}`,
      `- Upstream: ${git.upstream ?? '(none)'}`,
      `- Ahead / behind: ${git.ahead} / ${git.behind}`,
      `- Staged / changed / untracked: ${git.staged} / ${git.changed} / ${git.untracked}`,
      `- Clean: ${git.clean ? 'yes' : 'no'}`,
    );
  }

  const notes = workspace.contextItems.filter((item) => item.type === 'note');
  if (notes.length > 0) {
    sections.push('', '## Notes');
    for (const note of notes) {
      sections.push('', `### ${note.label}`, '', note.value.trim());
    }
  }

  const links = workspace.contextItems.filter((item) => item.type === 'url');
  if (links.length > 0) {
    sections.push('', '## Links', '');
    for (const link of links) {
      sections.push(`- [${link.label}](${link.value.trim()})`);
    }
  }

  if (files.length > 0) {
    sections.push('', '## Files');
    for (const file of files) {
      sections.push('', `### ${file.item.label}`, '', `Path: \`${file.absolutePath}\``);
      if (file.error) {
        sections.push('', `Could not read this file: ${file.error}`);
        continue;
      }
      if (!file.item.includeContent) {
        sections.push('', 'Content was intentionally omitted.');
        continue;
      }
      const fence = codeFence(file.content);
      const language = languageForPath(file.absolutePath);
      sections.push('', `${fence}${language}`, file.content.trimEnd(), fence);
      if (file.truncated) {
        sections.push('', '_Content truncated by the Workbench context-size limit._');
      }
    }
  }

  sections.push(
    '',
    '## Request',
    '',
    '<Describe the task or question here before sending this pack to ChatGPT.>',
    '',
  );

  return sections.join('\n');
}
