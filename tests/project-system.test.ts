import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatProjectTask,
  parseProjectTasks,
} from '../src/main/project-system';

test('parses task headings and normalizes supported states', () => {
  const tasks = parseProjectTasks('# Tasks\n\n### P0-001 — Ship it\n\n- **State:** in progress\n- **Objective:** Finish safely.\n');
  assert.deepEqual(tasks, [{ id: 'P0-001', title: 'Ship it', state: 'in progress', objective: 'Finish safely.' }]);
  assert.match(formatProjectTask({ title: ' Add model picker ', objective: ' Use the catalog. ' }, 'WB-001'), /### WB-001 — Add model picker/);
});
