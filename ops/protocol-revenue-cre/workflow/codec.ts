import { encodeAbiParameters, parseAbiParameters, zeroAddress } from "viem"
import { z } from "zod"

const ETHEREUM_MAINNET_CHAIN_SELECTOR = 5_009_297_550_715_157_269n
const MAX_UINT64 = (1n << 64n) - 1n
const MIN_INT24 = -(1 << 23)
const MAX_INT24 = (1 << 23) - 1

export const configSchema = z.object({
  enabled: z.boolean(),
  schedule: z.string().min(1),
  chainSelectorName: z.literal("ethereum-mainnet"),
  receiver: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  gasLimit: z.string().regex(/^[1-9][0-9]*$/),
}).superRefine((config, context) => {
  if (config.enabled && config.receiver.toLowerCase() === zeroAddress) {
    context.addIssue({
      code: "custom",
      path: ["receiver"],
      message: "An enabled workflow requires the deployed executor address",
    })
  }
})

export type Config = z.infer<typeof configSchema>

export function encodeCycleReport(
  chainSelector: bigint,
  scheduledAt: bigint,
  referenceTick: number,
): `0x${string}` {
  if (chainSelector !== ETHEREUM_MAINNET_CHAIN_SELECTOR) {
    throw new Error(`Unexpected Ethereum Mainnet chain selector: ${chainSelector}`)
  }
  if (scheduledAt <= 0n || scheduledAt > MAX_UINT64) {
    throw new Error(`Scheduled execution time does not fit uint64: ${scheduledAt}`)
  }
  if (!Number.isInteger(referenceTick) || referenceTick < MIN_INT24 || referenceTick > MAX_INT24) {
    throw new Error(`Reference tick does not fit int24: ${referenceTick}`)
  }

  return encodeAbiParameters(
    parseAbiParameters("uint64 chainSelector, uint64 scheduledAt, int24 referenceTick"),
    [chainSelector, scheduledAt, referenceTick],
  )
}
