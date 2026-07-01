export const YELLOW = "\x1b[33m";
export const RED = "\x1b[31m";
export const BOLD = "\x1b[1m";
export const RESET = "\x1b[0m";
export const GRAY = "\x1b[90m";
export const BLACK = "\x1b[40m";

export type LogEntry = {
  level: "info" | "warn" | "error" | "debug";
  message: string;
  timestamp: number;
};

export const logger = {
  info: (msg: string) => {
    bufferAndEmit("info", msg);
    console.log(bzz(msg, `${YELLOW}bzz:info${RESET}`));
  },
  warn: (msg: string) => {
    bufferAndEmit("warn", msg);
    console.warn(bzz(msg, `${YELLOW}bzz:warn${RESET}`));
  },
  error: (msg: string, error?: unknown) => {
    const errorString = (() => {
      if (!error) return "(error is null or undefined)";
      switch (typeof error) {
        case "string":
          return error;
        case "object":
          if (error instanceof Error) return error.message;
          return JSON.stringify(error);
        default:
          // eslint-disable-next-line @typescript-eslint/no-base-to-string
          return String(error);
      }
    })();
    bufferAndEmit("error", `${msg}: ${errorString}`);
    console.error(bzz(errorString, `${RED}bzz:error${RESET}`));
  },
  debug: (msg: string) => {
    bufferAndEmit("debug", msg);
    if (typeof process !== "undefined" && process.env?.DEBUG) {
      console.log(bzz(msg, `${GRAY}bzz:debug${RESET}`));
    }
  },
};

const logBuffer: LogEntry[] = [];
const logListeners = new Set<(entry: LogEntry) => void>();

export function addLogListener(listener: (entry: LogEntry) => void) {
  logListeners.add(listener);
  return () => {
    logListeners.delete(listener);
  };
}

export function getRecentLogs(): LogEntry[] {
  return logBuffer;
}

function bufferAndEmit(level: "info" | "warn" | "error" | "debug", message: string) {
  const entry: LogEntry = { level, message, timestamp: Date.now() };
  logBuffer.push(entry);
  if (logBuffer.length > 100) {
    logBuffer.shift();
  }
  for (const listener of logListeners) {
    try {
      listener(entry);
    } catch {
      // ignore
    }
  }
}

function bzz(msg: string, prefix: string) {
  return `[${prefix}] ${msg}`;
}
