const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const NONZERO_CODE_HASH = /^0x(?!0{64}$)[0-9a-f]{64}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const TRUST_ROOTS = Object.freeze([
  "programmableLaunchStampRouter",
  "permitAuthority",
  "graphFactory",
  "poolManager",
  "positionManager",
  "stateView",
  "v4Quoter",
  "permit2",
  "universalRouter",
]);

export function createPermitWindowFromFinalizedBlock({ rpcChainId, block, nowSeconds }) {
  const quantity = /^0x(?:0|[1-9a-f][0-9a-f]*)$/u;
  if (!quantity.test(rpcChainId ?? "") || BigInt(rpcChainId) !== 4_663n
    || !quantity.test(block?.number ?? "") || !quantity.test(block?.timestamp ?? "")
    || !/^0x[0-9a-f]{64}$/u.test(block?.hash ?? "")
    || !Number.isSafeInteger(nowSeconds) || nowSeconds <= 0) {
    throw new TypeError("a Robinhood finalized block and current API time are required");
  }
  const timestamp = BigInt(block.timestamp);
  const now = BigInt(nowSeconds);
  // The production simulator uses an independently agreed finalized checkpoint.
  // Leave one minute for provider skew while retaining the existing one-hour cap.
  const validAfter = timestamp - 60n;
  const deadline = validAfter + 3_600n;
  if (timestamp > now || validAfter < now - 3_600n || deadline < now + 300n) {
    throw new TypeError("the finalized checkpoint cannot provide a fresh one-hour permit with five minutes remaining");
  }
  return { validAfter: validAfter.toString(), deadline: deadline.toString() };
}

export function createPackConfigFromCapabilities({
  capabilities,
  launchWallet,
  nonce,
  permitWindow,
  sourceRevision,
  sourceOrigin,
  tokenSupply,
  projectMetadata,
  checkedAt,
  hookImmutableId,
}) {
  assertProductionV4Capabilities(capabilities);
  if (typeof hookImmutableId !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(hookImmutableId)) {
    throw new TypeError("the compiled hook PoolManager immutable ID is required");
  }
  if (!ADDRESS.test(launchWallet)
    || /^0x0{40}$/u.test(launchWallet)
    || !/^0x(?!0{64}$)[0-9a-f]{64}$/u.test(nonce)
    || !/^[0-9a-f]{40}$/u.test(sourceRevision)
    || !/^[1-9][0-9]*$/u.test(tokenSupply)) {
    throw new TypeError("wallet, nonce, source revision, or token supply is invalid");
  }
  const origin = new URL(sourceOrigin);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.hash) {
    throw new TypeError("source origin must be credential-free HTTPS without a fragment");
  }
  if (new Date(checkedAt).toISOString() !== checkedAt) {
    throw new TypeError("checkedAt must be canonical UTC with milliseconds");
  }
  if (!isPlainObject(permitWindow)
    || !/^(?:0|[1-9][0-9]*)$/u.test(permitWindow.validAfter)
    || !/^[1-9][0-9]*$/u.test(permitWindow.deadline)
    || BigInt(permitWindow.deadline) <= BigInt(permitWindow.validAfter)
    || BigInt(permitWindow.deadline) - BigInt(permitWindow.validAfter) > 3_600n) {
    throw new TypeError("permit window must be ordered and at most one hour");
  }
  const poolManager = capabilities.chainDeployment.contracts.poolManager.address;
  return {
    schemaVersion: "programmable.launch-pack-config.v4",
    chainId: "4663",
    caip2: "eip155:4663",
    chainDeployment: capabilities.chainDeployment,
    profile: capabilities.profile,
    externalContracts: [],
    launchWallet,
    nonce,
    permitWindow,
    source: {
      root: ".",
      paths: ["src"],
      sourceLineageNonce: "1",
      publicOrigin: { url: origin.href, revision: sourceRevision },
    },
    compilationUnits: [{
      compilationUnitId: "robinhood-v4-clean-room",
      standardJson: "standard-json.json",
    }],
    targets: [
      {
        targetId: "token",
        compilationUnitId: "robinhood-v4-clean-room",
        artifact: "out/token.json",
        applicantSalt: `0x${"01".repeat(32)}`,
        constructorArguments: [launchWallet, tokenSupply],
        initializer: null,
        deploymentValueWei: "0",
        initializerValueWei: "0",
        componentKind: "token",
        declaredHookPermissions: null,
        runtimeImmutables: [],
      },
      {
        targetId: "hook",
        compilationUnitId: "robinhood-v4-clean-room",
        artifact: "out/hook.json",
        applicantSalt: {
          mode: "deterministic-hook-permission-grind-v1",
          start: "0",
          maxAttempts: "262144",
        },
        constructorArguments: [poolManager],
        initializer: null,
        deploymentValueWei: "0",
        initializerValueWei: "0",
        componentKind: "hook",
        declaredHookPermissions: ["beforeSwap"],
        runtimeImmutables: [{ immutableId: hookImmutableId, abiType: "address", literal: poolManager }],
      },
      {
        targetId: "initializer",
        compilationUnitId: "robinhood-v4-clean-room",
        artifact: "out/initializer.json",
        applicantSalt: `0x${"03".repeat(32)}`,
        constructorArguments: [],
        initializer: null,
        deploymentValueWei: "0",
        initializerValueWei: "0",
        componentKind: "other",
        declaredHookPermissions: null,
        runtimeImmutables: [],
      },
    ],
    pool: {
      tokenTargetId: "token",
      hookTargetId: "hook",
      fee: 3_000,
      tickSpacing: 60,
      quoteCurrency: "0x0000000000000000000000000000000000000000",
    },
    projectMetadata,
    funding: {
      schemaVersion: "programmable.custom-launch-funding-intent.v2",
      mode: "none",
      valueWei: "0",
    },
    liquidityModel: {
      schemaVersion: "programmable.custom-launch-liquidity-model.v1",
      model: "none-empty-pool",
      declaredLaunchState: "pool-not-initialized",
      targetIds: [],
    },
    agentAttestation: {
      agentId: "robinhood-v4-clean-room",
      checkedAt,
      checks: [
        { checkId: "capabilities", evidence: "evidence/capabilities.json" },
        { checkId: "exact-build", evidence: "evidence/build.json" },
      ],
    },
  };
}

export function assertProductionV4Capabilities(value) {
  if (!isPlainObject(value)
    || value.schemaVersion !== "programmable.custom-launch-capabilities.v2"
    || value.apiVersion !== "v4"
    || value.chain?.id !== "4663"
    || value.chain?.caip2 !== "eip155:4663"
    || value.chainDeployment?.chainDeploymentId
      !== "robinhood-mainnet-custom-launch-v1"
    || value.chainDeployment?.chainId !== "4663"
    || value.chainDeployment?.caip2 !== "eip155:4663"
    || !/^0x[0-9a-f]{64}$/u.test(value.chainDeploymentDescriptorDigest ?? "")
    || value.profile?.schemaVersion !== "programmable.custom-launch-profile-ref.v4"
    || value.profile?.structuralProfileId
      !== "programmable.custom-launch.robinhood-mainnet.v1"
    || value.profile?.businessProfileId !== "robinhood-production-launch"
    || !SHA256.test(value.profile?.admissionDescriptorDigest ?? "")
    || !SHA256.test(value.profile?.admissionPolicyDigest ?? "")
    || !SHA256.test(value.profile?.admissionBindingDigest ?? "")
    || value.profile?.profileRevision !== 1
    || value.profile?.profileVersion !== "4.0.0"
    || !SHA256.test(value.profile?.profileDigest ?? "")
    || value.chainDeployment?.finality?.policyRevision !== 1
    || !SHA256.test(value.chainDeployment?.finality?.policyDigest ?? "")
    || value.chainDeployment?.permit2GenesisProvenance?.kind !== "genesis-predeploy"
    || value.chainDeployment?.permit2GenesisProvenance?.startBlock !== "0"
    || value.chainDeployment?.permit2GenesisProvenance?.address
      !== value.chainDeployment?.contracts?.permit2?.address
    || value.chainDeployment?.permitAuthoritySourceProvenance?.kind
      !== "official-source-pinned"
    || value.chainDeployment?.permitAuthoritySourceProvenance?.address
      !== value.chainDeployment?.contracts?.permitAuthority?.address
    || !Array.isArray(value.chainDeployment?.externalRootDeploymentEvidence)
    || value.chainDeployment.externalRootDeploymentEvidence.length !== 5
    || value.routes?.capabilities !== "/v4/chains/4663/capabilities"
    || value.routes?.create !== "/v4/chains/4663/custom-launches"
    || value.routes?.preflight !== "/v4/chains/4663/custom-launches/preflight"
    || value.graph?.minimumTargets !== 3
    || value.graph?.maximumTargets !== 16
    || JSON.stringify(value.funding?.modes) !== JSON.stringify([
      "none",
      "wallet-transaction-value",
    ])
    || value.safety?.serverAuthoritative !== true
    || value.safety?.clientBypassAccepted !== false
    || value.safety?.walletSignatureProduced !== false
    || value.safety?.transactionBroadcast !== false) {
    throw new TypeError("public capabilities are not the exact production V4 contract");
  }
  const contracts = value.chainDeployment.contracts;
  if (!isPlainObject(contracts)
    || JSON.stringify(Object.keys(contracts).sort()) !== JSON.stringify([...TRUST_ROOTS].sort())) {
    throw new TypeError("public capabilities do not bind the exact V4 trust-root set");
  }
  for (const name of TRUST_ROOTS) {
    if (!ADDRESS.test(contracts[name]?.address ?? "")
      || /^0x0{40}$/u.test(contracts[name].address)
      || !NONZERO_CODE_HASH.test(contracts[name]?.runtimeCodeHash ?? "")) {
      throw new TypeError(`public capabilities trust root ${name} is unavailable`);
    }
  }
  return value;
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
