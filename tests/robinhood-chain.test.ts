import { describe, expect, it } from "vitest";

import robinhoodObservation from "../config/robinhood-chain.v1.json";
import packageJson from "../package.json";
import {
  getPreparedTransactionChain,
  getProgrammableChainCapability,
  getWalletChainDisplayName,
  PROGRAMMABLE_WALLET_CHAINS,
} from "../lib/chains/registry";
import { parsePreparedTransaction } from "../lib/prepared-transaction";

const DESTINATION = "0x1111111111111111111111111111111111111111";
const CALLDATA = "0x12345678";

describe("Robinhood Chain integration boundary", () => {
  it("registers mainnet and testnet for EVM wallet connectivity", () => {
    expect(PROGRAMMABLE_WALLET_CHAINS.map((chain) => chain.id)).toEqual([
      1,
      11_155_111,
      4_663,
      46_630,
    ]);
    expect(getWalletChainDisplayName("0x1237")).toBe("Robinhood Chain");
    expect(getWalletChainDisplayName("eip155:46630")).toBe(
      "Robinhood Chain Testnet",
    );
    expect(getWalletChainDisplayName("0x1237-not-a-chain")).toBe(
      "0x1237-not-a-chain",
    );
    expect(getProgrammableChainCapability(4_663)?.chain).toMatchObject({
      id: 4_663,
      nativeCurrency: { symbol: "ETH" },
      rpcUrls: {
        default: {
          http: ["https://rpc.mainnet.chain.robinhood.com"],
        },
      },
    });
  });

  it("keeps every Robinhood product action integration-pending", () => {
    for (const chainId of [4_663, 46_630]) {
      expect(getProgrammableChainCapability(chainId)).toMatchObject({
        runtimeStatus: "integration-pending",
        walletConnection: true,
        productReads: false,
        preparedTransactions: false,
        launches: false,
        trades: false,
      });
      expect(getPreparedTransactionChain(chainId)).toBeNull();
    }
  });

  it("does not accept a Robinhood transaction before deployment activation", () => {
    expect(() =>
      parsePreparedTransaction({
        kind: "swap",
        chainId: 4_663,
        to: DESTINATION,
        data: CALLDATA,
        value: "0",
        gasLimit: "300000",
      }),
    ).toThrow("Transactions are limited to Ethereum Mainnet or Sepolia");
  });

  it("pins the observed official v4 contracts and runtime identities", () => {
    expect(robinhoodObservation.status).toBe("integration-pending");
    expect(robinhoodObservation.network.mainnet.chainId).toBe("4663");
    expect(
      robinhoodObservation.officialUniswapDeploymentObservation.sourceCommit,
    ).toBe("37936185dee7decf681360ec799c124e0e034672");
    expect(
      robinhoodObservation.officialUniswapDeploymentObservation.records,
    ).toMatchObject({
      poolManager: {
        address: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
        status: "active",
      },
      positionManager: {
        address: "0x58daec3116aae6D93017bAAea7749052E8a04fA7",
        status: "active",
      },
      stateView: {
        address: "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b",
        status: "active",
      },
      v4Quoter: {
        address: "0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94",
        status: "active",
      },
      permit2: {
        address: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
        status: "active",
      },
    });
    for (const hash of Object.values(
      robinhoodObservation.runtimeObservation.runtimeCodeKeccak256,
    )) {
      expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    }
    for (const record of Object.values(
      robinhoodObservation.officialUniswapDeploymentObservation.records,
    )) {
      expect(record.sourceRefResolution).toBe("unresolved");
    }
  });

  it("preserves the Universal Router generation conflict as unresolved", () => {
    expect(robinhoodObservation.routerResolution.status).toBe("unresolved");
    expect(robinhoodObservation.routerResolution.officialFeedAddress).not.toBe(
      robinhoodObservation.routerResolution.installedSdk.address,
    );
    expect(robinhoodObservation.routerResolution.installedSdk.version).toBe(
      packageJson.dependencies["@uniswap/universal-router-sdk"],
    );
    expect(robinhoodObservation.programmableCapabilities).toMatchObject({
      walletConnection: true,
      preparedTransactions: false,
      launches: false,
      trades: false,
      providerAvailability: "unknown",
    });
  });
});
