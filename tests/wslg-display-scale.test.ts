import assert from 'node:assert/strict';
import test from 'node:test';
import {
  configureWslgDisplayScale,
  detectWslgDisplayScale,
  parseWslgPrimaryDisplayScale,
} from '../src/main/wslg-display-scale';

const homogeneousScaleLayout = `
[10:00:00.000] Client: DisplayLayoutChange: monitor count:0x2
[10:00:00.001] disp_monitor_sanity_check_layout:---INPUT---
[10:00:00.001] rdpMonitor[0]: x:0, y:0, width:1920, height:1080, is_primary:0
[10:00:00.001] rdpMonitor[0]: desktopScaleFactor:150, deviceScaleFactor:140
[10:00:00.001] rdpMonitor[0]: scale:1, client scale :1.00
[10:00:00.001] rdpMonitor[1]: x:1920, y:0, width:3840, height:2160, is_primary:1
[10:00:00.001] rdpMonitor[1]: desktopScaleFactor:150, deviceScaleFactor:140
[10:00:00.001] rdpMonitor[1]: scale:1, client scale :1.00
[10:00:00.001] disp_monitor_validate_and_compute_layout:---OUTPUT---
[10:00:00.001] rdpMonitor[0]: x:0, y:0, width:1920, height:1080, is_primary:0
[10:00:00.001] rdpMonitor[0]: desktopScaleFactor:0, deviceScaleFactor:100
[10:00:00.001] rdpMonitor[1]: x:1920, y:0, width:3840, height:2160, is_primary:1
[10:00:00.001] rdpMonitor[1]: desktopScaleFactor:0, deviceScaleFactor:140
`;

test('parses the primary Windows desktop scale from the latest WSLg layout input', () => {
  const staleLayout = homogeneousScaleLayout.replaceAll('150', '200');
  assert.equal(parseWslgPrimaryDisplayScale(`${staleLayout}\n${homogeneousScaleLayout}`), 1.5);
  assert.equal(
    parseWslgPrimaryDisplayScale(
      homogeneousScaleLayout.replaceAll('desktopScaleFactor:150', 'desktopScaleFactor:200')
        .replaceAll('client scale :1.00', 'client scale :2.00'),
    ),
    1,
  );
  assert.equal(parseWslgPrimaryDisplayScale('desktopScaleFactor:150'), null);
  assert.equal(parseWslgPrimaryDisplayScale(homogeneousScaleLayout.replace('150', '600')), null);
});

test('does not force a process-wide scale for a mixed-scale monitor layout', () => {
  const mixedScaleLayout = homogeneousScaleLayout.replace(
    'rdpMonitor[0]: desktopScaleFactor:150',
    'rdpMonitor[0]: desktopScaleFactor:100',
  );
  assert.equal(parseWslgPrimaryDisplayScale(mixedScaleLayout), null);
});

test('detects scale only for a WSLg Linux process and tolerates an unavailable log', () => {
  const wslg = {
    env: { WSL_INTEROP: '/run/WSL/1_interop', WAYLAND_DISPLAY: 'wayland-0' },
    platform: 'linux' as NodeJS.Platform,
    readLog: () => homogeneousScaleLayout,
  };
  assert.equal(detectWslgDisplayScale(wslg), 1.5);
  assert.equal(detectWslgDisplayScale({ ...wslg, platform: 'win32' }), null);
  assert.equal(detectWslgDisplayScale({ ...wslg, readLog: () => { throw new Error('missing'); } }), null);
});

test('configures Chromium scale without overriding an explicit user switch', () => {
  const appended: Array<[string, string | undefined]> = [];
  const commandLine = {
    appendSwitch: (name: string, value?: string) => appended.push([name, value]),
    hasSwitch: () => false,
  };
  const options = {
    env: { WSL_INTEROP: '/run/WSL/1_interop', WAYLAND_DISPLAY: 'wayland-0' },
    platform: 'linux' as NodeJS.Platform,
    readLog: () => homogeneousScaleLayout,
  };

  assert.equal(configureWslgDisplayScale(commandLine, options), 1.5);
  assert.deepEqual(appended, [['force-device-scale-factor', '1.5']]);

  appended.length = 0;
  const mixedScaleLayout = homogeneousScaleLayout.replace(
    'rdpMonitor[0]: desktopScaleFactor:150',
    'rdpMonitor[0]: desktopScaleFactor:100',
  );
  assert.equal(configureWslgDisplayScale(commandLine, { ...options, readLog: () => mixedScaleLayout }), null);
  assert.deepEqual(appended, []);

  assert.equal(configureWslgDisplayScale({ ...commandLine, hasSwitch: () => true }, options), null);
  assert.deepEqual(appended, []);
});
