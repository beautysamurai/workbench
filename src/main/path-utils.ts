import path from 'node:path';

export function toWslUnc(distro: string, linuxPath: string): string {
  const normalizedDistro = distro.trim();
  const normalizedPath = path.posix.normalize(linuxPath.trim() || '/');
  const windowsTail = normalizedPath === '/'
    ? ''
    : normalizedPath.replace(/^\/+/, '').split('/').join('\\');
  return `\\\\wsl.localhost\\${normalizedDistro}${windowsTail ? `\\${windowsTail}` : ''}`;
}

export function uncToWslPath(distro: string, uncPath: string): string | null {
  const normalized = uncPath.replace(/\//g, '\\');
  const prefixes = [
    `\\\\wsl.localhost\\${distro}\\`,
    `\\\\wsl$\\${distro}\\`,
  ];

  for (const prefix of prefixes) {
    if (normalized.toLowerCase().startsWith(prefix.toLowerCase())) {
      const tail = normalized.slice(prefix.length).split('\\').filter(Boolean).join('/');
      return `/${tail}`;
    }
  }
  return null;
}

export function resolveWorkspacePath(root: string, candidate: string): string {
  const trimmed = candidate.trim();
  if (path.posix.isAbsolute(trimmed)) {
    return path.posix.normalize(trimmed);
  }
  return path.posix.normalize(path.posix.join(root, trimmed));
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function languageForPath(filePath: string): string {
  const extension = path.posix.extname(filePath).toLowerCase();
  const mapping: Record<string, string> = {
    '.java': 'java',
    '.kt': 'kotlin',
    '.kts': 'kotlin',
    '.ts': 'typescript',
    '.tsx': 'tsx',
    '.js': 'javascript',
    '.jsx': 'jsx',
    '.py': 'python',
    '.rs': 'rust',
    '.go': 'go',
    '.c': 'c',
    '.h': 'c',
    '.cpp': 'cpp',
    '.hpp': 'cpp',
    '.json': 'json',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.toml': 'toml',
    '.xml': 'xml',
    '.html': 'html',
    '.css': 'css',
    '.scss': 'scss',
    '.sql': 'sql',
    '.sh': 'bash',
    '.zsh': 'bash',
    '.md': 'markdown',
    '.tex': 'latex',
    '.gradle': 'groovy',
  };
  return mapping[extension] ?? '';
}
