import { logger } from "../hive/shared/logger";

const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;

export function startHeartbeat(probe: () => Promise<void>): NodeJS.Timeout {
  const tick = () => {
    probe().catch((err: unknown) => {
      logger.debug(
        `heartbeat probe failure: ${err instanceof Error ? err.message : String(err)}`
      );
    });
  };

  const interval = setInterval(tick, HEARTBEAT_INTERVAL_MS);
  tick();
  return interval;
}
