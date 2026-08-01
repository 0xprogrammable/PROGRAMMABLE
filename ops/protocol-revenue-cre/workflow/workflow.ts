import {
  bytesToHex,
  CronCapability,
  encodeCallMsg,
  EVMClient,
  getNetwork,
  handler,
  hexToBase64,
  LAST_FINALIZED_BLOCK_NUMBER,
  TxStatus,
  type CronPayload,
  type Runtime,
} from "@chainlink/cre-sdk"
import {
  decodeFunctionResult,
  encodeFunctionData,
  parseAbi,
  type Address,
} from "viem"

import { encodeCycleReport, type Config } from "./codec"

export { configSchema } from "./codec"

const revenueWalletAbi = parseAbi(["function currentMainPoolTick() view returns (int24)"])

export function onCronTrigger(runtime: Runtime<Config>, payload: CronPayload): string {
  if (!runtime.config.enabled) throw new Error("Protocol revenue workflow is disabled")
  const scheduledExecutionTime = payload.scheduledExecutionTime
  if (!scheduledExecutionTime) throw new Error("Cron payload has no scheduled execution time")

  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: runtime.config.chainSelectorName,
    isTestnet: false,
  })
  if (!network) throw new Error(`Unsupported network: ${runtime.config.chainSelectorName}`)

  const chainSelector = network.chainSelector.selector
  const scheduledAt = BigInt(scheduledExecutionTime.seconds)
  const evmClient = new EVMClient(chainSelector)
  const tickCall = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({
        from: "0x0000000000000000000000000000000000000000",
        to: runtime.config.receiver as Address,
        data: encodeFunctionData({ abi: revenueWalletAbi, functionName: "currentMainPoolTick" }),
      }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result()
  const referenceTick = Number(
    decodeFunctionResult({
      abi: revenueWalletAbi,
      functionName: "currentMainPoolTick",
      data: bytesToHex(tickCall.data),
    }),
  )
  const reportData = encodeCycleReport(chainSelector, scheduledAt, referenceTick)
  const report = runtime
    .report({
      encodedPayload: hexToBase64(reportData),
      encoderName: "evm",
      signingAlgo: "ecdsa",
      hashingAlgo: "keccak256",
    })
    .result()

  const result = evmClient
    .writeReport(runtime, {
      receiver: runtime.config.receiver as Address,
      report,
      gasConfig: { gasLimit: runtime.config.gasLimit },
    })
    .result()

  if (result.txStatus !== TxStatus.SUCCESS) {
    throw new Error(`Protocol revenue cycle failed: ${result.errorMessage || result.txStatus}`)
  }

  const transactionHash = bytesToHex(result.txHash || new Uint8Array(32))
  runtime.log(`Protocol revenue cycle confirmed: ${transactionHash}`)
  return transactionHash
}

export function initWorkflow(config: Config) {
  const cron = new CronCapability()
  return [handler(cron.trigger({ schedule: config.schedule }), onCronTrigger)]
}
