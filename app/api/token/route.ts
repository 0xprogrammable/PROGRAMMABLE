import { NextRequest, NextResponse } from "next/server";
import {
  createPublicClient,
  formatUnits,
  getAddress,
  http,
  parseAbi,
} from "viem";
import { mainnet } from "viem/chains";

import mainnetDeployments from "@/contracts/dependencies/ethereum-mainnet.json";

export const dynamic = "force-dynamic";

const erc20Abi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function creator() view returns (address)",
  "function graffiti() view returns (bytes32)",
]);

const uerc20FactoryAbi = parseAbi([
  "function getUERC20Address(string name, string symbol, uint8 decimals, address creator, bytes32 graffiti) view returns (address)",
]);

const uerc20FactoryAddress = getAddress(
  mainnetDeployments.contracts.uerc20Factory.address,
);

const client = createPublicClient({
  chain: mainnet,
  transport: http(
    process.env.ETHEREUM_RPC_URL ?? "https://eth.drpc.org",
    {
      retryCount: 1,
      timeout: 10_000,
    },
  ),
});

function valueFromResult<T>(result: PromiseSettledResult<T>) {
  return result.status === "fulfilled" ? result.value : null;
}

export async function GET(request: NextRequest) {
  const input = request.nextUrl.searchParams.get("address")?.trim();

  if (!input) {
    return NextResponse.json(
      { error: "Enter an Ethereum token address" },
      { status: 400 },
    );
  }

  let address: `0x${string}`;

  try {
    address = getAddress(input);
  } catch {
    return NextResponse.json(
      { error: "Enter a valid Ethereum address" },
      { status: 400 },
    );
  }

  const [bytecodeResult, nameResult, symbolResult, decimalsResult, supplyResult] =
    await Promise.allSettled([
      client.getCode({ address }),
      client.readContract({ address, abi: erc20Abi, functionName: "name" }),
      client.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
      client.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
      client.readContract({
        address,
        abi: erc20Abi,
        functionName: "totalSupply",
      }),
    ]);

  const bytecode = valueFromResult(bytecodeResult);
  if (!bytecode || bytecode === "0x") {
    return NextResponse.json(
      { error: "No contract code was found at this address on Ethereum" },
      { status: 404 },
    );
  }

  const name = valueFromResult(nameResult);
  const symbol = valueFromResult(symbolResult);
  const decimals = valueFromResult(decimalsResult);
  const rawSupply = valueFromResult(supplyResult);
  const totalSupply =
    rawSupply !== null && decimals !== null
      ? formatUnits(rawSupply, decimals)
      : null;

  let recordedCreator: `0x${string}` | null = null;
  let factoryVerified = false;

  if (name !== null && symbol !== null && decimals !== null) {
    const [creatorResult, graffitiResult] = await Promise.allSettled([
      client.readContract({
        address,
        abi: erc20Abi,
        functionName: "creator",
      }),
      client.readContract({
        address,
        abi: erc20Abi,
        functionName: "graffiti",
      }),
    ]);
    const creator = valueFromResult(creatorResult);
    const graffiti = valueFromResult(graffitiResult);

    if (creator !== null && graffiti !== null) {
      recordedCreator = getAddress(creator);
      try {
        const predicted = await client.readContract({
          address: uerc20FactoryAddress,
          abi: uerc20FactoryAbi,
          functionName: "getUERC20Address",
          args: [name, symbol, decimals, recordedCreator, graffiti],
        });
        factoryVerified =
          predicted.toLowerCase() === address.toLowerCase();
      } catch {
        factoryVerified = false;
      }
    }
  }

  return NextResponse.json(
    {
      address,
      name,
      symbol,
      decimals,
      totalSupply,
      metadataComplete:
        name !== null &&
        symbol !== null &&
        decimals !== null &&
        totalSupply !== null,
      factoryVerified,
      recordedCreator,
      factoryAddress: uerc20FactoryAddress,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
