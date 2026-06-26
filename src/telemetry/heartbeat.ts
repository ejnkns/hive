const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;

export function startHeartbeat(probe: () => Promise<void>): NodeJS.Timeout {
  const tick = () => {
    probe().catch(() => {
      // heartbeat failures are non-fatal
    });
  };

  const interval = setInterval(tick, HEARTBEAT_INTERVAL_MS);
  tick();
  return interval;
}
