const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const GRAY = "\x1b[90m";
const BLACK = "\x1b[40m";
const width: number = 80; //process.stdout.columns || 80;

export type LogEntry = {
  level: "info" | "warn" | "error" | "debug";
  message: string;
  timestamp: number;
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

function bufferAndEmit(
  level: "info" | "warn" | "error" | "debug",
  message: string
) {
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
    // if (process.env.DEBUG) {
    console.log(bzz(msg, `${GRAY}bzz:debug${RESET}`));
    // }
  },
};

function bzz(msg: string, prefix: string) {
  return `[${prefix}] ${msg}`;
}

export function printBanner() {
  const beeHive = `${YELLOW}     ^^     .-=-=-=-.  ^^
^^        (\`-=-=-=-=-\`)         ^^
        (\`-=-=-=-=-=-=-\`)  ^^         ^^
  ^^   (\`-=-=-=-=-=-=-=-\`)   ^^                            ^^
      ( \`-=-=-=-(@)-=-=-\` )      ^^
      (\`-=-=-=-=-=-=-=-=-\`)  ^^
      (\`-=-=-=-=-=-=-=-=-\`)              ^^
      (\`-=-=-=-=-=-=-=-=-\`)                      ^^
      (\`-=-=-=-=-=-=-=-=-\`)  ^^
       (\`-=-=-=-=-=-=-=-\`)          ^^
        (\`-=-=-=-=-=-=-\`)  ^^                 ^^
          (\`-=-=-=-=-\`)
           \`-=-=-=-=-\`
                                  ^^${RESET}`;
  const title = `${YELLOW}${BOLD}h i v e${RESET}`;
  const version = ""; //`${GRAY}v${process.env.npm_package_version ?? ""}${RESET}`;
  const hr = `${GRAY}${(() => "─".repeat(width))()}${RESET}`;
  const flyPath = `                            ${YELLOW}${BOLD}h i v e${RESET}
   ,-.      .' '.        .\` 
   \\_/      .   .       .
${YELLOW}:${RESET}${BLACK}>${YELLOW}(${RESET}${BLACK}|${RESET}${YELLOW}|${RESET}${BLACK}|${RESET}${BLACK}${RESET}${YELLOW}}${RESET}.      .        .
   / \\  '. . ' ' . . '
   \`-'
`;

  const wide = `${beeHive}
             ${title}
${version}                    ${YELLOW}^^${RESET}`;

  const narrow = `${flyPath}
${version}`;

  if (width > 64) {
    console.log(wide);
  } else if (width > 50) {
    console.log(narrow);
  } else {
    const middle = Math.round(width / 2) - 4;
    console.log(`
${" ".repeat(middle)}${title}

${version}
`);
  }

  console.log(hr);
}
