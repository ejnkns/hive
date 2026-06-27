import { BLACK, BOLD, GRAY, RESET, YELLOW } from "../logger";

export const width: number = process.stdout.columns || 80;

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
  const title = `${YELLOW}[ ${BOLD}h i v e${RESET}${YELLOW} ]${RESET}`;
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
${version}                         ${YELLOW}^^${RESET}`;

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
