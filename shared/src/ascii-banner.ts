import { bee, comb } from "./ascii-art.ts";
import { BOLD, GRAY, RESET, YELLOW } from "./logger.ts";

export const width: number = process.stdout.columns || 80;

export function printBanner() {
  const beeHive = `${YELLOW}${comb}${RESET}`;
  const title = `${YELLOW}[ ${BOLD}h i v e${RESET}${YELLOW} ]${RESET}`;
  const version = `${GRAY}v${process.env.npm_package_version ?? "0.1.0"}${RESET}`;
  const hr = `${GRAY}${(() => "─".repeat(width))()}${RESET}`;
  const flyPath = `
                             ${YELLOW}[ ${BOLD}h i v e${RESET} ${YELLOW}]${RESET}
${bee}`;

  const wide = `${beeHive}
           ${title}
${version}                         ${YELLOW}^^${RESET}`;

  const narrow = `${flyPath}${version}`;

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
