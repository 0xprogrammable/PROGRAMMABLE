import assert from "node:assert/strict"
import test from "node:test"

import { decodeAbiParameters, parseAbiParameters } from "viem"

import { configSchema, encodeCycleReport } from "./codec.ts"

const MAINNET_SELECTOR = 5_009_297_550_715_157_269n

test("encodes the exact onchain report tuple", () => {
  const report = encodeCycleReport(MAINNET_SELECTOR, 1_785_597_600n, -1234)
  const decoded = decodeAbiParameters(
    parseAbiParameters("uint64 chainSelector, uint64 scheduledAt, int24 referenceTick"),
    report,
  )

  assert.deepEqual(decoded, [MAINNET_SELECTOR, 1_785_597_600n, -1234])
})

test("rejects the wrong chain and invalid scalar bounds", () => {
  assert.throws(() => encodeCycleReport(1n, 1n, 0), /Unexpected Ethereum Mainnet chain selector/)
  assert.throws(() => encodeCycleReport(MAINNET_SELECTOR, 0n, 0), /does not fit uint64/)
  assert.throws(() => encodeCycleReport(MAINNET_SELECTOR, 1n, 1 << 23), /does not fit int24/)
})

test("production config is fail closed until the executor is deployed", () => {
  const disabled = configSchema.parse({
    enabled: false,
    schedule: "0 0 0 * * *",
    chainSelectorName: "ethereum-mainnet",
    receiver: "0x0000000000000000000000000000000000000000",
    gasLimit: "12000000",
  })
  assert.equal(disabled.enabled, false)

  assert.throws(() => configSchema.parse({ ...disabled, enabled: true }), /deployed executor address/)
})
