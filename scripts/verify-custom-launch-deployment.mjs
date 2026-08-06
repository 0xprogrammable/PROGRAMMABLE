#!/usr/bin/env node

import {
  parseCustomLaunchDeploymentProbeArguments,
  probeCustomLaunchDeployment,
} from "./custom-launch-deployment-probe-core.mjs";

try {
  const result = await probeCustomLaunchDeployment(
    parseCustomLaunchDeploymentProbeArguments(process.argv.slice(2)),
  );
  process.stdout.write(
    `Custom launch deployment ${result.status} at ${result.baseUrl}`
    + ` (authenticated canary: ${result.authenticatedCanary})\n`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown deployment probe failure";
  process.stderr.write(`Custom launch deployment probe failed: ${message}\n`);
  process.exitCode = 1;
}
