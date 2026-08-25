#!/usr/bin/env node

import { formatCliError, main } from "../src/cli.mjs";

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${formatCliError(error)}\n`);
  process.exitCode = 1;
});
