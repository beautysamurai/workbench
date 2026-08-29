const paths: Record<string, string> = {
  logo: '<path d="M5 4.5h6.5L14 8l2.5-3.5H23l-5.3 7.3L23.5 20H17l-3-4.2L11 20H4.5l5.8-8.2L5 4.5Z"/><path d="M28 5h8v4h-8zM28 12h8v4h-8zM28 19h8v4h-8z" opacity=".55"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.97 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3v-4h.08A1.7 1.7 0 0 0 4.6 8.94a1.7 1.7 0 0 0-.34-1.88L4.2 7l2.83-2.83.06.06a1.7 1.7 0 0 0 1.88.34H9A1.7 1.7 0 0 0 10 3.08V3h4v.08a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06L19.8 7l-.06.06a1.7 1.7 0 0 0-.34 1.88V9a1.7 1.7 0 0 0 1.52 1H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  command: '<path d="M9 6H6a3 3 0 1 0 3 3V6Zm0 0v12m0-3H6a3 3 0 1 0 3 3v-3Zm6-9h3a3 3 0 1 1-3 3V6Zm0 0v12m0-3h3a3 3 0 1 1-3 3v-3Z"/>',
  overview: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7 9 3 3-3 3m6 0h4"/>',
  sparkle: '<path d="m12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3Z"/><path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z"/>',
  context: '<path d="M8 3h8l4 4v14H4V3h4Z"/><path d="M16 3v5h5M8 12h8M8 16h6"/>',
  folder: '<path d="M3 6h7l2 2h9v11H3V6Z"/>',
  code: '<path d="m8 9-4 3 4 3m8-6 4 3-4 3m-5 3 2-12"/>',
  chart: '<path d="M4 20V10m6 10V4m6 16v-7m5 7H2"/>',
  book: '<path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H11v17H7.5A3.5 3.5 0 0 0 4 22V5.5ZM20 5.5A3.5 3.5 0 0 0 16.5 2H13v17h3.5A3.5 3.5 0 0 1 20 22V5.5Z"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V4h6v3m-12 5h18m-11 0v2h4v-2"/>',
  language: '<path d="M4 5h10M9 3v2m-4 4c2 3 4 5 8 7m0-7c-2 4-5 7-9 9m12-6 4 9m-6 0 4-9m-3 6h6"/>',
  branch: '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="6" cy="19" r="2"/><path d="M6 7v10m2-6c6 0 8-1 8-3V8"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  alert: '<path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v4m0 3h.01"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  external: '<path d="M14 4h6v6m0-6-9 9"/><path d="M19 13v7H4V5h7"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
  save: '<path d="M5 3h12l2 2v16H5V3Z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/>',
  edit: '<path d="m4 20 4.5-1 10-10-3.5-3.5-10 10L4 20Z"/><path d="m13.5 7 3.5 3.5"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6"/>',
  file: '<path d="M6 2h8l4 4v16H6V2Z"/><path d="M14 2v5h5"/>',
  note: '<path d="M5 3h14v18H5V3Z"/><path d="M8 8h8m-8 4h8m-8 4h5"/>',
  link: '<path d="m10 13 4-4m-6 8H6a4 4 0 0 1 0-8h3m6-2h3a4 4 0 0 1 0 8h-3"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  play: '<path d="m8 5 11 7-11 7V5Z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M18.5 10A7 7 0 0 0 6 7.5L4 10m2 4a7 7 0 0 0 12 2.5L20 14"/>',
  message: '<path d="M4 4h16v13H9l-5 4V4Z"/>',
  review: '<path d="M4 3h12l4 4v14H4V3Z"/><path d="M16 3v5h5M8 13l2 2 5-5"/>',
  archive: '<path d="M4 7h16v14H4V7Zm-1-4h18v4H3V3Zm7 8h4"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  shield: '<path d="M12 3 5 6v5c0 4.5 2.8 8.2 7 10 4.2-1.8 7-5.5 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
  send: '<path d="m22 2-7 20-4-9-9-4 20-7Z"/><path d="M22 2 11 13"/>',
  git: '<circle cx="12" cy="12" r="9"/><circle cx="9" cy="8" r="1.5"/><circle cx="15" cy="16" r="1.5"/><path d="M9 9.5v2c0 2 1 3 3 3h1.5M15 14.5V8"/>',
};

export function icon(name: string, size = 18, className = ''): string {
  const body = paths[name] ?? paths.folder;
  const fillIcons = new Set(['logo']);
  const paint = fillIcons.has(name)
    ? 'fill="currentColor" stroke="none"'
    : 'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';
  const viewBox = name === 'logo' ? '0 0 40 28' : '0 0 24 24';
  return `<svg class="icon ${className}" width="${size}" height="${size}" viewBox="${viewBox}" ${paint} aria-hidden="true">${body}</svg>`;
}
