#!/usr/bin/env node

import {
  assertShardsSecurityReleaseReady,
  buildShardsSecurityPropertiesV2,
  verifyShardsSecurityPropertiesV2,
} from "./shards-security-properties-v2-core.mjs";

const result = await buildShardsSecurityPropertiesV2();
await verifyShardsSecurityPropertiesV2(result);
assertShardsSecurityReleaseReady(result);
process.stdout.write(`verified ${result.input.output}: SECURITY_RELEASE_GATE_PASSED\n`);
