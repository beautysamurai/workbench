import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

const WSLG_LOG_PATH = '/mnt/wslg/weston.log';
const WSLG_LAYOUT_MARKER = 'Client: DisplayLayoutChange';
const LOG_SCAN_CHUNK_BYTES = 512 * 1024;
const MAX_LAYOUT_BYTES = 512 * 1024;
const DEFAULT_SCALE_CHANGE_DEBOUNCE_MS = 500;
const SCALE_CHANGE_SETTLE_READS = 5;

export const DEVICE_SCALE_FACTOR_SWITCH = 'force-device-scale-factor';

interface ChromiumCommandLine {
  appendSwitch(name: string, value?: string): void;
  hasSwitch(name: string): boolean;
}

interface WslgScaleDetectionOptions {
  env?: NodeJS.ProcessEnv;
  logPath?: string;
  platform?: NodeJS.Platform;
  readLog?: () => string;
}

interface WslgScaleWatchOptions extends WslgScaleDetectionOptions {
  debounceMs?: number;
  schedule?: (callback: () => void, delayMs: number) => () => void;
}

type SubscribeToDisplayChanges = (listener: () => void) => () => void;
type WslgLayoutScale =
  | { kind: 'uniform'; scale: number }
  | { kind: 'mixed' }
  | { kind: 'indeterminate' };
type WslgScaleTarget = number | 'default';

const INDETERMINATE_LAYOUT = { kind: 'indeterminate' } as const;
const MIXED_LAYOUT = { kind: 'mixed' } as const;
const DEFAULT_SCALE_TARGET = 'default';

function scheduleWithTimeout(callback: () => void, delayMs: number): () => void {
  const timer = setTimeout(callback, delayMs);
  return () => clearTimeout(timer);
}

function isWslgEnvironment(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): boolean {
  return platform === 'linux'
    && Boolean(env.WSL_INTEROP)
    && Boolean(env.WAYLAND_DISPLAY);
}

function readRange(descriptor: number, position: number, length: number): Buffer {
  const buffer = Buffer.allocUnsafe(length);
  let bytesRead = 0;
  while (bytesRead < length) {
    const count = readSync(
      descriptor,
      buffer,
      bytesRead,
      length - bytesRead,
      position + bytesRead,
    );
    if (count === 0) throw new Error('WSLg log changed while it was being read.');
    bytesRead += count;
  }
  return buffer;
}

function readLatestWslgLayout(path = WSLG_LOG_PATH): string {
  const descriptor = openSync(path, 'r');
  try {
    const size = fstatSync(descriptor).size;
    const marker = Buffer.from(WSLG_LAYOUT_MARKER);
    let searchEnd = size;
    let followingPrefix = Buffer.alloc(0);

    while (searchEnd > 0) {
      const searchStart = Math.max(0, searchEnd - LOG_SCAN_CHUNK_BYTES);
      const chunk = readRange(descriptor, searchStart, searchEnd - searchStart);
      const searchable = followingPrefix.length > 0
        ? Buffer.concat([chunk, followingPrefix])
        : chunk;
      const markerIndex = searchable.lastIndexOf(marker);
      if (markerIndex >= 0 && markerIndex < chunk.length) {
        const markerPosition = searchStart + markerIndex;
        const layoutLength = Math.min(size - markerPosition, MAX_LAYOUT_BYTES);
        return readRange(descriptor, markerPosition, layoutLength).toString('utf8');
      }

      followingPrefix = chunk.subarray(0, Math.min(marker.length - 1, chunk.length));
      searchEnd = searchStart;
    }
    return '';
  } finally {
    closeSync(descriptor);
  }
}

function parseWslgLayoutScale(log: string): WslgLayoutScale {
  const latestLayoutStart = log.lastIndexOf(WSLG_LAYOUT_MARKER);
  if (latestLayoutStart < 0) return INDETERMINATE_LAYOUT;
  const latestLayout = log.slice(latestLayoutStart);
  const declaredCountMatch = latestLayout.match(
    /Client: DisplayLayoutChange: monitor count:0x([0-9a-f]+)/i,
  );
  if (!declaredCountMatch) return INDETERMINATE_LAYOUT;
  const declaredCount = Number.parseInt(declaredCountMatch[1], 16);
  const outputMarker = 'disp_monitor_validate_and_compute_layout:---OUTPUT---';
  const outputStart = latestLayout.indexOf(outputMarker);
  if (outputStart < 0) return INDETERMINATE_LAYOUT;
  const inputLayout = latestLayout.slice(0, outputStart);
  const headers = [...inputLayout.matchAll(
    /rdpMonitor\[(\d+)\]: x:[^\r\n]*is_primary:(\d+)/g,
  )];
  if (declaredCount < 1 || headers.length !== declaredCount) return INDETERMINATE_LAYOUT;

  const monitors = headers.map((header, index) => {
    const monitorIndex = header[1];
    const blockStart = header.index ?? 0;
    const blockEnd = headers[index + 1]?.index ?? inputLayout.length;
    const block = inputLayout.slice(blockStart, blockEnd);
    const percentagePattern = new RegExp(
      `rdpMonitor\\[${monitorIndex}\\]: desktopScaleFactor:(\\d+)`,
    );
    const clientScalePattern = new RegExp(
      `rdpMonitor\\[${monitorIndex}\\]: scale:[^,\\r\\n]+,\\s*client(?:\\s+scale|Scale)\\s*:\\s*([0-9.]+)`,
    );
    const percentage = Number(block.match(percentagePattern)?.[1]);
    const clientScale = Number(block.match(clientScalePattern)?.[1] ?? 1);
    const residualScale = percentage / 100 / clientScale;
    if (
      !Number.isInteger(percentage)
      || percentage < 100
      || percentage > 500
      || !Number.isFinite(residualScale)
      || residualScale < 0.5
      || residualScale > 5
    ) return null;
    return {
      primary: header[2] === '1',
      residualScale: Math.round(residualScale * 1_000) / 1_000,
    };
  });
  if (monitors.some((monitor) => monitor === null)) return INDETERMINATE_LAYOUT;

  const validMonitors = monitors.filter((monitor) => monitor !== null);
  const primary = validMonitors.find((monitor) => monitor.primary);
  if (!primary) return INDETERMINATE_LAYOUT;
  if (validMonitors.some((monitor) => monitor.residualScale !== primary.residualScale)) {
    return MIXED_LAYOUT;
  }
  return { kind: 'uniform', scale: primary.residualScale };
}

export function parseWslgPrimaryDisplayScale(log: string): number | null {
  const layout = parseWslgLayoutScale(log);
  return layout.kind === 'uniform' ? layout.scale : null;
}

function detectWslgLayoutScale({
  env = process.env,
  logPath = WSLG_LOG_PATH,
  platform = process.platform,
  readLog,
}: WslgScaleDetectionOptions = {}): WslgLayoutScale {
  if (!isWslgEnvironment(env, platform)) return INDETERMINATE_LAYOUT;

  try {
    return parseWslgLayoutScale(readLog ? readLog() : readLatestWslgLayout(logPath));
  } catch {
    return INDETERMINATE_LAYOUT;
  }
}

export function detectWslgDisplayScale(
  options: WslgScaleDetectionOptions = {},
): number | null {
  const layout = detectWslgLayoutScale(options);
  return layout.kind === 'uniform' ? layout.scale : null;
}

export function configureWslgDisplayScale(
  commandLine: ChromiumCommandLine,
  options: WslgScaleDetectionOptions = {},
): number | null {
  if (commandLine.hasSwitch(DEVICE_SCALE_FACTOR_SWITCH)) return null;

  // WSLg can leave fractional Windows scaling unapplied to its Chromium client.
  // Align Chromium before `ready` so fullscreen geometry and pointer input agree.
  const layout = detectWslgLayoutScale(options);
  if (layout.kind !== 'uniform' || layout.scale === 1) return null;
  const scale = layout.scale;
  commandLine.appendSwitch(DEVICE_SCALE_FACTOR_SWITCH, String(scale));
  return scale;
}

export function watchWslgDisplayScaleChanges(
  subscribe: SubscribeToDisplayChanges,
  initialScale: number | null,
  onScaleChanged: () => void,
  {
    env = process.env,
    platform = process.platform,
    debounceMs = DEFAULT_SCALE_CHANGE_DEBOUNCE_MS,
    schedule = scheduleWithTimeout,
    ...detectionOptions
  }: WslgScaleWatchOptions = {},
): () => void {
  if (!isWslgEnvironment(env, platform)) return () => {};

  const initialTarget: WslgScaleTarget = initialScale ?? DEFAULT_SCALE_TARGET;
  let candidateTarget: WslgScaleTarget | undefined;
  let reportedTarget: WslgScaleTarget | undefined;
  let settleReadsRemaining = 0;
  let confirmationExtended = false;
  let cancelInspection: (() => void) | null = null;
  let stopped = false;
  let unsubscribe = () => {};

  const dispose = (): void => {
    if (stopped) return;
    stopped = true;
    cancelInspection?.();
    cancelInspection = null;
    unsubscribe();
  };

  const inspectScale = (): void => {
    cancelInspection = null;
    if (stopped) return;

    const detectedLayout = detectWslgLayoutScale({
      ...detectionOptions,
      env,
      platform,
    });
    settleReadsRemaining -= 1;
    if (detectedLayout.kind === 'indeterminate') {
      candidateTarget = undefined;
      if (settleReadsRemaining > 0) {
        cancelInspection = schedule(inspectScale, debounceMs);
      }
      return;
    }

    const detectedTarget: WslgScaleTarget = detectedLayout.kind === 'uniform'
      && detectedLayout.scale !== 1
      ? detectedLayout.scale
      : DEFAULT_SCALE_TARGET;
    if (detectedTarget === initialTarget) {
      candidateTarget = undefined;
      if (settleReadsRemaining > 0) {
        cancelInspection = schedule(inspectScale, debounceMs);
      } else {
        reportedTarget = undefined;
      }
      return;
    }

    // Confirm a new valid target twice. Indeterminate reads never represent
    // scale 1 because Weston may still be appending the latest layout.
    if (candidateTarget !== detectedTarget) {
      candidateTarget = detectedTarget;
      if (settleReadsRemaining > 0 || !confirmationExtended) {
        confirmationExtended = settleReadsRemaining <= 0;
        cancelInspection = schedule(inspectScale, debounceMs);
      }
      return;
    }

    candidateTarget = undefined;
    if (reportedTarget === detectedTarget) return;
    reportedTarget = detectedTarget;
    onScaleChanged();
  };

  const handleDisplayChange = (): void => {
    if (stopped) return;
    candidateTarget = undefined;
    settleReadsRemaining = SCALE_CHANGE_SETTLE_READS;
    confirmationExtended = false;
    cancelInspection?.();
    cancelInspection = schedule(inspectScale, debounceMs);
  };

  unsubscribe = subscribe(handleDisplayChange);
  handleDisplayChange();
  return dispose;
}
