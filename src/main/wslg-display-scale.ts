import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

const WSLG_LOG_PATH = '/mnt/wslg/weston.log';
const MAX_LOG_BYTES = 512 * 1024;
const DEVICE_SCALE_SWITCH = 'force-device-scale-factor';

interface ChromiumCommandLine {
  appendSwitch(name: string, value?: string): void;
  hasSwitch(name: string): boolean;
}

interface WslgScaleDetectionOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  readLog?: () => string;
}

function readLogTail(path = WSLG_LOG_PATH): string {
  const descriptor = openSync(path, 'r');
  try {
    const size = fstatSync(descriptor).size;
    const length = Math.min(size, MAX_LOG_BYTES);
    const buffer = Buffer.alloc(length);
    let bytesRead = 0;
    while (bytesRead < length) {
      const count = readSync(
        descriptor,
        buffer,
        bytesRead,
        length - bytesRead,
        size - length + bytesRead,
      );
      if (count === 0) break;
      bytesRead += count;
    }
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    closeSync(descriptor);
  }
}

export function parseWslgPrimaryDisplayScale(log: string): number | null {
  const layoutMarker = 'Client: DisplayLayoutChange';
  const latestLayoutStart = log.lastIndexOf(layoutMarker);
  const latestLayout = latestLayoutStart >= 0 ? log.slice(latestLayoutStart) : log;
  const outputMarker = 'disp_monitor_validate_and_compute_layout:---OUTPUT---';
  const outputStart = latestLayout.indexOf(outputMarker);
  const inputLayout = outputStart >= 0 ? latestLayout.slice(0, outputStart) : latestLayout;
  const headers = [...inputLayout.matchAll(
    /rdpMonitor\[(\d+)\]: x:[^\r\n]*is_primary:(\d+)/g,
  )];
  if (headers.length === 0) return null;

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
  if (monitors.some((monitor) => monitor === null)) return null;

  const validMonitors = monitors.filter((monitor) => monitor !== null);
  const primary = validMonitors.find((monitor) => monitor.primary);
  if (!primary) return null;
  if (validMonitors.some((monitor) => monitor.residualScale !== primary.residualScale)) return null;
  return primary.residualScale;
}

export function detectWslgDisplayScale({
  env = process.env,
  platform = process.platform,
  readLog = readLogTail,
}: WslgScaleDetectionOptions = {}): number | null {
  const isWslg = platform === 'linux'
    && Boolean(env.WSL_INTEROP)
    && Boolean(env.WAYLAND_DISPLAY);
  if (!isWslg) return null;

  try {
    return parseWslgPrimaryDisplayScale(readLog());
  } catch {
    return null;
  }
}

export function configureWslgDisplayScale(
  commandLine: ChromiumCommandLine,
  options: WslgScaleDetectionOptions = {},
): number | null {
  if (commandLine.hasSwitch(DEVICE_SCALE_SWITCH)) return null;

  // WSLg can leave fractional Windows scaling unapplied to its Chromium client.
  // Align Chromium before `ready` so fullscreen geometry and pointer input agree.
  const scale = detectWslgDisplayScale(options);
  if (scale === null || scale === 1) return null;
  commandLine.appendSwitch(DEVICE_SCALE_SWITCH, String(scale));
  return scale;
}
