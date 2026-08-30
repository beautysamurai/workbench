import assert from 'node:assert/strict';
import test from 'node:test';
import {
  handleWindowShortcut,
  WORKBENCH_MIN_WINDOW_HEIGHT,
  WORKBENCH_MIN_WINDOW_WIDTH,
} from '../src/main/window-behavior';

test('supports a small restored window and deterministic fullscreen shortcuts', () => {
  assert.equal(WORKBENCH_MIN_WINDOW_WIDTH, 720);
  assert.equal(WORKBENCH_MIN_WINDOW_HEIGHT, 520);

  let fullScreen = false;
  let bounds = { x: 40, y: 30, width: 720, height: 520 };
  let leaveListener: (() => void) | null = null;
  const window = {
    getNormalBounds: () => ({ x: 40, y: 30, width: 720, height: 520 }),
    isFullScreen: () => fullScreen,
    isMaximized: () => false,
    maximize: () => undefined,
    once: (_event: 'leave-full-screen', listener: () => void) => { leaveListener = listener; },
    setBounds: (next: typeof bounds) => { bounds = next; },
    setFullScreen: (next: boolean) => {
      fullScreen = next;
      if (next) bounds = { x: 0, y: 0, width: 3840, height: 2160 };
      else if (leaveListener) {
        const listener = leaveListener;
        leaveListener = null;
        listener();
      }
    },
  };

  assert.equal(handleWindowShortcut(window, { type: 'keyDown', key: 'F11' }), true);
  assert.equal(fullScreen, true);
  assert.equal(handleWindowShortcut(window, { type: 'keyUp', key: 'F11' }), false);
  assert.equal(fullScreen, true);
  assert.equal(handleWindowShortcut(window, { type: 'keyDown', key: 'Escape' }), true);
  assert.equal(fullScreen, false);
  assert.deepEqual(bounds, { x: 40, y: 30, width: 720, height: 520 });
  assert.equal(handleWindowShortcut(window, { type: 'keyDown', key: 'F11', control: true }), false);
});
