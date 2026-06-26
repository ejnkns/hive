const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const GRAY = "\x1b[90m";
const BLACK = "\x1b[40m";
const width = process.stdout.columns || 80;

export const logger = {
  info: (msg: string) => {
    console.log(bzz(msg, `${YELLOW}bzz:info${RESET}`));
  },
  warn: (msg: string) => {
    console.warn(bzz(msg, `${YELLOW}bzz:warn${RESET}`));
  },
  error: (msg: string) => {
    console.error(bzz(msg, `${RED}bzz:error${RESET}`));
  },
  debug: (msg: string) => {
    if (process.env.DEBUG) console.log(bzz(msg, `${GRAY}bzz:debug${RESET}`));
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
  const version = `${GRAY}v${process.env.npm_package_version ?? ""}${RESET}`;
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
