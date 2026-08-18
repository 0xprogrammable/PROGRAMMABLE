type Address = `0x${string}`;
type Hex = `0x${string}`;

type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

type PermissionRule = {
  type: string;
  data?: { addresses?: Address[]; timestamp?: number };
};

type PermissionResponse = {
  chainId: Hex;
  from?: Address;
  to: Address;
  context: Hex;
  delegationManager: Address;
  permission: {
    type: string;
    data: { periodAmount?: Hex; periodDuration?: number };
  };
  rules?: PermissionRule[] | null;
};

declare global {
  interface Window {
    PROGRAMMABLE_REVENUE_ACTIVATION: {
      deployer: Address;
      revenueAuthority: Address;
      keeper: Address;
      coordinator: Address;
      vault: Address;
      coordinatorData: Hex;
      vaultData: Hex;
      startingNonce: string;
    };
  }
}

const configuration = window.PROGRAMMABLE_REVENUE_ACTIVATION;
const dailyLimit = 5n * 10n ** 18n;
const statusElement = document.querySelector<HTMLElement>("[data-status]");
const deployCoordinator = document.querySelector<HTMLButtonElement>(
  "[data-deploy-coordinator]",
);
const deployVault = document.querySelector<HTMLButtonElement>(
  "[data-deploy-vault]",
);
const grantPermission = document.querySelector<HTMLButtonElement>(
  "[data-grant-permission]",
);

function status(message: string, error = false) {
  if (!statusElement) return;
  statusElement.textContent = message;
  statusElement.dataset.error = error ? "true" : "false";
}

function provider() {
  const ethereum = (window as Window & { ethereum?: Eip1193Provider }).ethereum;
  if (!ethereum) throw new Error("MetaMask was not found");
  return ethereum;
}

function sameAddress(left: string | undefined, right: string) {
  return left?.toLowerCase() === right.toLowerCase();
}

async function accounts() {
  return provider().request({ method: "eth_requestAccounts" }) as Promise<
    Address[]
  >;
}

async function requireAccount(expected: Address) {
  const [account] = await accounts();
  if (!account || !sameAddress(account, expected)) {
    throw new Error(`Select ${expected} in MetaMask`);
  }
  const chainId = await provider().request({ method: "eth_chainId" });
  if (chainId !== "0x1") {
    await provider().request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x1" }],
    });
  }
  return account;
}

async function waitForReceipt(transactionHash: Hex) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const receipt = await provider().request({
      method: "eth_getTransactionReceipt",
      params: [transactionHash],
    }) as { status?: Hex } | null;
    if (receipt) {
      if (receipt.status !== "0x1") throw new Error("Transaction reverted");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  throw new Error("Transaction confirmation timed out");
}

async function deploy(data: Hex, label: string) {
  const account = await requireAccount(configuration.deployer);
  status(`Confirm ${label} in MetaMask`);
  const transactionHash = await provider().request({
    method: "eth_sendTransaction",
    params: [{ from: account, data, value: "0x0" }],
  }) as Hex;
  status(`${label} submitted. Waiting for confirmation`);
  await waitForReceipt(transactionHash);
  status(`${label} confirmed`);
  await refresh();
}

async function state() {
  const response = await fetch("/state", { cache: "no-store" });
  if (!response.ok) throw new Error("Could not read deployment state");
  return response.json() as Promise<{
    coordinatorDeployed: boolean;
    vaultDeployed: boolean;
    permissionSaved: boolean;
  }>;
}

async function refresh() {
  const current = await state();
  if (deployCoordinator) deployCoordinator.disabled = current.coordinatorDeployed;
  if (deployVault) {
    deployVault.disabled =
      !current.coordinatorDeployed || current.vaultDeployed;
  }
  if (grantPermission) {
    grantPermission.disabled =
      !current.coordinatorDeployed ||
      !current.vaultDeployed ||
      current.permissionSaved;
  }
  status(
    current.permissionSaved
      ? "Permission saved locally. Automation remains disabled"
      : "Reviewed deployment state is ready",
  );
  return current;
}

function exactRule(
  rules: PermissionRule[] | null | undefined,
  type: "redeemer" | "payee",
  address: Address,
) {
  const rule = rules?.find((candidate) => candidate.type === type);
  return rule?.data?.addresses?.length === 1 &&
    sameAddress(rule.data.addresses[0], address);
}

async function requestPermission() {
  await requireAccount(configuration.revenueAuthority);
  const current = await refresh();
  if (!current.coordinatorDeployed || !current.vaultDeployed) {
    throw new Error("Deploy and verify both contracts first");
  }

  const supported = await provider().request({
    method: "wallet_getSupportedExecutionPermissions",
    params: [],
  }) as Record<string, { chainIds?: Hex[]; ruleTypes?: string[] }>;
  const nativePeriodic = supported["native-token-periodic"];
  if (
    !nativePeriodic?.chainIds?.includes("0x1") ||
    !nativePeriodic.ruleTypes?.includes("redeemer") ||
    !nativePeriodic.ruleTypes.includes("payee") ||
    !nativePeriodic.ruleTypes.includes("expiry")
  ) {
    throw new Error("This MetaMask version does not support the required permission");
  }

  const now = Math.floor(Date.now() / 1_000);
  const expiry = now + 365 * 24 * 60 * 60;
  const request = {
    chainId: "0x1",
    from: configuration.revenueAuthority,
    to: configuration.keeper,
    rules: [
      { type: "expiry", data: { timestamp: expiry } },
      { type: "redeemer", data: { addresses: [configuration.keeper] } },
      { type: "payee", data: { addresses: [configuration.vault] } },
    ],
    permission: {
      type: "native-token-periodic",
      isAdjustmentAllowed: false,
      data: {
        periodAmount: `0x${dailyLimit.toString(16)}`,
        periodDuration: 86_400,
        startTime: now,
        justification: "Process Programmable protocol revenue once per day",
      },
    },
  };

  status("Review the daily limit, payee and expiry in MetaMask");
  const responses = await provider().request({
    method: "wallet_requestExecutionPermissions",
    params: [request],
  }) as PermissionResponse[];
  const permission = responses[0];
  if (
    responses.length !== 1 ||
    !permission ||
    permission.chainId !== "0x1" ||
    !sameAddress(permission.from, configuration.revenueAuthority) ||
    !sameAddress(permission.to, configuration.keeper) ||
    permission.permission.type !== "native-token-periodic" ||
    BigInt(permission.permission.data.periodAmount ?? "0x0") !== dailyLimit ||
    permission.permission.data.periodDuration !== 86_400 ||
    !exactRule(permission.rules, "redeemer", configuration.keeper) ||
    !exactRule(permission.rules, "payee", configuration.vault)
  ) {
    throw new Error("MetaMask returned a permission that differs from the reviewed request");
  }

  const response = await fetch("/permission", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      context: permission.context,
      delegationManager: permission.delegationManager,
      chainId: 1,
      from: permission.from,
      to: permission.to,
      type: permission.permission.type,
      periodAmount: dailyLimit.toString(),
      periodDuration: permission.permission.data.periodDuration,
      expiry,
      rules: permission.rules,
    }),
  });
  if (!response.ok) throw new Error("The local permission validator rejected the grant");
  status("Permission saved locally. Automation remains disabled");
  await refresh();
}

deployCoordinator?.addEventListener("click", () => {
  void deploy(configuration.coordinatorData, "Claim Coordinator").catch(
    (error: unknown) =>
      status(error instanceof Error ? error.message : "Deployment failed", true),
  );
});
deployVault?.addEventListener("click", () => {
  void deploy(configuration.vaultData, "Revenue Vault").catch(
    (error: unknown) =>
      status(error instanceof Error ? error.message : "Deployment failed", true),
  );
});
grantPermission?.addEventListener("click", () => {
  void requestPermission().catch((error: unknown) =>
    status(
      error instanceof Error ? error.message : "Permission request failed",
      true,
    )
  );
});

void refresh().catch((error: unknown) =>
  status(error instanceof Error ? error.message : "State check failed", true)
);

export {};
