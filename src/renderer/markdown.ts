export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function inline(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

export function renderMarkdown(value: string): string {
  const blocks: string[] = [];
  const placeholder = (html: string): string => {
    const index = blocks.push(html) - 1;
    return `\u0000BLOCK${index}\u0000`;
  };

  let source = value.replace(/```([\w-]*)\n([\s\S]*?)```/g, (_match, language: string, code: string) =>
    placeholder(`<pre class="code-block"><div class="code-label">${escapeHtml(language || 'text')}</div><code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`),
  );

  const lines = source.split(/\r?\n/);
  const html: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let paragraph: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length) {
      html.push(`<p>${inline(paragraph.join(' '))}</p>`);
      paragraph = [];
    }
  };
  const closeList = (): void => {
    if (list) html.push(`</${list}>`);
    list = null;
  };

  for (const line of lines) {
    const blockMatch = /^\u0000BLOCK(\d+)\u0000$/.exec(line.trim());
    if (blockMatch) {
      flushParagraph();
      closeList();
      html.push(blocks[Number(blockMatch[1])]);
      continue;
    }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length + 1;
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    const unordered = /^\s*[-*]\s+(.+)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (unordered || ordered) {
      flushParagraph();
      const desired = unordered ? 'ul' : 'ol';
      if (list !== desired) {
        closeList();
        list = desired;
        html.push(`<${list}>`);
      }
      html.push(`<li>${inline((unordered ?? ordered)![1])}</li>`);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }
    if (line.startsWith('> ')) {
      flushParagraph();
      closeList();
      html.push(`<blockquote>${inline(line.slice(2))}</blockquote>`);
      continue;
    }
    paragraph.push(line.trim());
  }
  flushParagraph();
  closeList();

  return html.join('\n').replace(/\u0000BLOCK(\d+)\u0000/g, (_match, index) => blocks[Number(index)]);
}

export function renderDiff(value: string): string {
  const lines = value.split(/\r?\n/).map((line) => {
    let className = 'diff-line';
    if (line.startsWith('+++') || line.startsWith('---')) className += ' diff-file';
    else if (line.startsWith('+')) className += ' diff-add';
    else if (line.startsWith('-')) className += ' diff-remove';
    else if (line.startsWith('@@')) className += ' diff-hunk';
    return `<span class="${className}">${escapeHtml(line)}</span>`;
  });
  return `<pre class="diff-block"><code>${lines.join('\n')}</code></pre>`;
}
