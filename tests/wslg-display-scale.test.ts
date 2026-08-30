import assert from 'node:assert/strict';
import test from 'node:test';
import {
  configureWslgDisplayScale,
  detectWslgDisplayScale,
  parseWslgPrimaryDisplayScale,
  watchWslgDisplayScaleChanges,
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

const mixedScaleLayout = homogeneousScaleLayout.replace(
  'rdpMonitor[0]: desktopScaleFactor:150',
  'rdpMonitor[0]: desktopScaleFactor:100',
);

const wslgOptions = {
  env: { WSL_INTEROP: '/run/WSL/1_interop', WAYLAND_DISPLAY: 'wayland-0' },
  platform: 'linux' as NodeJS.Platform,
};

function createTestScheduler(): {
  schedule: (callback: () => void, delayMs: number) => () => void;
  flush: () => void;
} {
  const tasks: Array<{ callback: () => void; canceled: boolean }> = [];
  return {
    schedule: (callback) => {
      const task = { callback, canceled: false };
      tasks.push(task);
      return () => { task.canceled = true; };
    },
    flush: () => {
      let task = tasks.shift();
      while (task) {
        if (!task.canceled) task.callback();
        task = tasks.shift();
      }
    },
  };
}

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
  assert.equal(parseWslgPrimaryDisplayScale(mixedScaleLayout), null);
});

test('rejects incomplete or count-mismatched WSLg layout records', () => {
  const incompleteLayout = homogeneousScaleLayout.slice(
    0,
    homogeneousScaleLayout.indexOf('[10:00:00.001] rdpMonitor[1]: x:'),
  );
  assert.equal(parseWslgPrimaryDisplayScale(incompleteLayout), null);
  assert.equal(
    parseWslgPrimaryDisplayScale(homogeneousScaleLayout.replace('monitor count:0x2', 'monitor count:0x3')),
    null,
  );
});

test('detects scale only for a WSLg Linux process and tolerates an unavailable log', () => {
  const wslg = {
    ...wslgOptions,
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
    ...wslgOptions,
    readLog: () => homogeneousScaleLayout,
  };

  assert.equal(configureWslgDisplayScale(commandLine, options), 1.5);
  assert.deepEqual(appended, [['force-device-scale-factor', '1.5']]);

  appended.length = 0;
  assert.equal(configureWslgDisplayScale(commandLine, { ...options, readLog: () => mixedScaleLayout }), null);
  assert.deepEqual(appended, []);

  assert.equal(configureWslgDisplayScale({ ...commandLine, hasSwitch: () => true }, options), null);
  assert.deepEqual(appended, []);
});

test('reports each confirmed WSLg scale once and keeps watching when deferred', () => {
  let listener: () => void = () => { assert.fail('display change listener was not registered'); };
  let layout = homogeneousScaleLayout;
  let reads = 0;
  let notifications = 0;
  let unsubscribes = 0;
  const scheduler = createTestScheduler();
  const dispose = watchWslgDisplayScaleChanges(
    (nextListener) => {
      listener = nextListener;
      return () => { unsubscribes += 1; };
    },
    1.5,
    () => { notifications += 1; },
    {
      ...wslgOptions,
      readLog: () => {
        reads += 1;
        return layout;
      },
      schedule: scheduler.schedule,
    },
  );

  scheduler.flush();
  assert.equal(reads, 5);
  assert.equal(notifications, 0);
  reads = 0;

  listener();
  listener();
  scheduler.flush();
  assert.equal(reads, 5);
  assert.equal(notifications, 0);

  layout = mixedScaleLayout;
  listener();
  scheduler.flush();
  assert.equal(notifications, 1);
  assert.equal(unsubscribes, 0);

  listener();
  scheduler.flush();
  assert.equal(notifications, 1);

  layout = homogeneousScaleLayout.replaceAll(
    'desktopScaleFactor:150',
    'desktopScaleFactor:125',
  );
  listener();
  scheduler.flush();
  assert.equal(notifications, 2);
  dispose();
  assert.equal(unsubscribes, 1);

  listener();
  scheduler.flush();
  assert.equal(notifications, 2);
});

test('keeps indeterminate WSLg reads distinct from a valid default scale', () => {
  let reads = 0;
  let notifications = 0;
  const scheduler = createTestScheduler();
  const dispose = watchWslgDisplayScaleChanges(
    () => () => {},
    1.5,
    () => { notifications += 1; },
    {
      ...wslgOptions,
      readLog: () => {
        reads += 1;
        throw new Error('Weston log unavailable');
      },
      schedule: scheduler.schedule,
    },
  );

  scheduler.flush();
  assert.equal(reads, 5);
  assert.equal(notifications, 0);
  dispose();
});

test('keeps polling when the first post-event WSLg layout is still stale', () => {
  let listener: () => void = () => { assert.fail('display change listener was not registered'); };
  let reads = 0;
  let eventPhase = false;
  let eventReads = 0;
  let notifications = 0;
  const scheduler = createTestScheduler();
  const dispose = watchWslgDisplayScaleChanges(
    (nextListener) => {
      listener = nextListener;
      return () => {};
    },
    1.5,
    () => { notifications += 1; },
    {
      ...wslgOptions,
      readLog: () => {
        reads += 1;
        if (!eventPhase) return homogeneousScaleLayout;
        eventReads += 1;
        return eventReads === 1 ? homogeneousScaleLayout : mixedScaleLayout;
      },
      schedule: scheduler.schedule,
    },
  );

  scheduler.flush();
  assert.equal(reads, 5);
  assert.equal(notifications, 0);
  eventPhase = true;
  listener();
  scheduler.flush();
  assert.equal(eventReads, 3);
  assert.equal(notifications, 1);
  dispose();
});

test('settles again after ready when pre-ready scale detection missed', () => {
  let reads = 0;
  let notifications = 0;
  const scheduler = createTestScheduler();
  const dispose = watchWslgDisplayScaleChanges(
    () => () => {},
    null,
    () => { notifications += 1; },
    {
      ...wslgOptions,
      readLog: () => {
        reads += 1;
        return homogeneousScaleLayout;
      },
      schedule: scheduler.schedule,
    },
  );

  scheduler.flush();
  assert.equal(reads, 2);
  assert.equal(notifications, 1);
  dispose();
});

test('does not subscribe to display changes outside WSLg', () => {
  let subscriptions = 0;
  const dispose = watchWslgDisplayScaleChanges(
    () => {
      subscriptions += 1;
      return () => {};
    },
    null,
    () => assert.fail('unexpected scale change'),
    { ...wslgOptions, platform: 'win32' },
  );

  assert.equal(subscriptions, 0);
  dispose();
});
