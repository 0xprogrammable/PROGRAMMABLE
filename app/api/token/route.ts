import { NextRequest, NextResponse } from "next/server";
import {
  createPublicClient,
  formatUnits,
  getAddress,
  http,
  parseAbi,
} from "viem";
import { mainnet } from "viem/chains";

export const dynamic = "force-dynamic";

const erc20Abi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
]);

const client = createPublicClient({
  chain: mainnet,
  transport: http(
    process.env.ETHEREUM_RPC_URL ??
      "https://ethereum-rpc.publicnode.com",
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
      { error: "Enter an Ethereum token address." },
      { status: 400 },
    );
  }

  let address: `0x${string}`;

  try {
    address = getAddress(input);
  } catch {
    return NextResponse.json(
      { error: "Enter a valid Ethereum address." },
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
      { error: "No contract code was found at this address on Ethereum." },
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
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
