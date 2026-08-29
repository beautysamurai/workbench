const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const from = path.join(root, 'src', 'renderer');
const to = path.join(root, 'dist', 'renderer');

fs.mkdirSync(path.join(to, 'renderer'), { recursive: true });
fs.copyFileSync(path.join(from, 'index.html'), path.join(to, 'index.html'));
fs.copyFileSync(path.join(from, 'styles.css'), path.join(to, 'renderer', 'styles.css'));
