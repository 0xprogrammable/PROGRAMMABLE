#!/usr/bin/env node

import {
  buildShardsSecurityPropertiesV2,
  writeShardsSecurityPropertiesV2,
} from "./shards-security-properties-v2-core.mjs";

const result = await buildShardsSecurityPropertiesV2();
await writeShardsSecurityPropertiesV2(result);
process.stdout.write(
  `generated ${result.input.output}: ${result.descriptor.status}; releaseReady=${result.descriptor.assurance.releaseReady}\n`,
);
