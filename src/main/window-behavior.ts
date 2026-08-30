export const WORKBENCH_MIN_WINDOW_WIDTH = 720;
export const WORKBENCH_MIN_WINDOW_HEIGHT = 520;

export interface FullScreenWindow {
  getNormalBounds(): WindowBounds;
  isFullScreen(): boolean;
  isMaximized(): boolean;
  maximize(): void;
  once(event: 'leave-full-screen', listener: () => void): unknown;
  setBounds(bounds: WindowBounds): void;
  setFullScreen(fullScreen: boolean): void;
}

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowShortcutInput {
  type?: string;
  key: string;
  alt?: boolean;
  control?: boolean;
  meta?: boolean;
  shift?: boolean;
}

function hasModifier(input: WindowShortcutInput): boolean {
  return Boolean(input.alt || input.control || input.meta || input.shift);
}

const restoreStates = new WeakMap<FullScreenWindow, { bounds: WindowBounds; maximized: boolean }>();

function enterFullScreen(window: FullScreenWindow): void {
  restoreStates.set(window, {
    bounds: window.getNormalBounds(),
    maximized: window.isMaximized(),
  });
  window.setFullScreen(true);
}

function leaveFullScreen(window: FullScreenWindow): void {
  const restore = restoreStates.get(window);
  if (restore) {
    window.once('leave-full-screen', () => {
      if (restore.maximized) window.maximize();
      else window.setBounds(restore.bounds);
      restoreStates.delete(window);
    });
  }
  window.setFullScreen(false);
}

export function handleWindowShortcut(window: FullScreenWindow, input: WindowShortcutInput): boolean {
  if (input.type && input.type !== 'keyDown') return false;
  const key = input.key.toLowerCase();
  if (key === 'f11' && !hasModifier(input)) {
    if (window.isFullScreen()) leaveFullScreen(window);
    else enterFullScreen(window);
    return true;
  }
  if (key === 'escape' && !hasModifier(input) && window.isFullScreen()) {
    leaveFullScreen(window);
    return true;
  }
  return false;
}
