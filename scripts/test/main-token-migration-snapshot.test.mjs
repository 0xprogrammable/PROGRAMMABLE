import assert from "node:assert/strict";
import test from "node:test";

import {
  MAIN_TOKEN_MIGRATION_POLICY,
  buildMainTokenMigrationSnapshot,
  buildMainTokenMigrationSnapshotArtifact,
  canonicalJson,
  keccak256Bytecode,
  sha256CanonicalJson,
} from "../main-token-migration-snapshot-core.mjs";

const WINDOW_START = 1_800_000_000n;
const DEADLINE = WINDOW_START + 345_600n;
const SENDER_A = "0x1111111111111111111111111111111111111111";
const SENDER_B = "0x2222222222222222222222222222222222222222";
const CONTRACT_SENDER = "0x3333333333333333333333333333333333333333";
const RELAYER = "0x4444444444444444444444444444444444444444";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const TARGET_DELIVERY = Object.freeze({
  chainId: MAIN_TOKEN_MIGRATION_POLICY.targetChainId,
  distributionPlanSha256: `sha256:${"56".repeat(32)}`,
  distributorAddress: "0x6666666666666666666666666666666666666666",
  distributorRuntimeCodeKeccak256: `0x${"34".repeat(32)}`,
  tokenAddress: "0x5555555555555555555555555555555555555555",
  tokenRuntimeCodeKeccak256: `0x${"12".repeat(32)}`,
  tokenTotalSupplyRaw: MAIN_TOKEN_MIGRATION_POLICY.targetTokenTotalSupplyRaw,
});
const TOKEN_RUNTIME_CODE = [
  "0x608060405234801561000f575f5ffd5b5060043610610115575f3560e01c8063392f37e9116100ad57806395d89b411161007d578063d5",
  "05accf11610063578063d505accf146102a0578063dd62ed3e146102b5578063f56a499f146102c8575f5ffd5b806395d89b411461028557",
  "8063a9059cbb1461028d575f5ffd5b8063392f37e91461021b5780633c130d901461023357806370a082311461023b5780637ecebe001461",
  "0260575f5ffd5b806318160ddd116100e857806318160ddd146101b557806323b872dd146101cf578063313ce567146101e25780633644e5",
  "1514610213575f5ffd5b806301ffc9a71461011957806302d05d3f1461014157806306fdde031461018d578063095ea7b3146101a2575b5f",
  "5ffd5b61012c610127366004611667565b6102ef565b60405190151581526020015b60405180910390f35b6101687f000000000000000000",
  "000000d240d06f8586eb799f20056054e5b527405e6bad81565b60405173ffffffffffffffffffffffffffffffffffffffff909116815260",
  "2001610138565b6101956103d3565b60405161013891906116f2565b61012c6101b036600461172c565b610462565b6805345cdf77eb68f4",
  "4c545b604051908152602001610138565b61012c6101dd366004611754565b6104ee565b60405160ff7f0000000000000000000000000000",
  "000000000000000000000000000000000012168152602001610138565b6101c16105be565b610223610660565b6040516101389493929190",
  "61178e565b610195610894565b6101c16102493660046117e5565b6387a211a2600c9081525f91909152602090205490565b6101c161026e",
  "3660046117e5565b6338377508600c9081525f91909152602090205490565b610195610aef565b61012c61029b36600461172c565b610afe",
  "565b6102b36102ae3660046117fe565b610b75565b005b6101c16102c336600461186b565b610d6d565b6101c17f36760a37f494510cf059",
  "9ad45dfb00be6251651db4d869cd3c0a384ed46d413a81565b5f7fffffffff00000000000000000000000000000000000000000000000000",
  "00000082167f01ffc9a700000000000000000000000000000000000000000000000000000000148061038157507fffffffff000000000000",
  "0000000000000000000000000000000000000000000082167f36372b07000000000000000000000000000000000000000000000000000000",
  "00145b806103cd57507fffffffff0000000000000000000000000000000000000000000000000000000082167f9d8ff7da00000000000000",
  "000000000000000000000000000000000000000000145b92915050565b60605f80546103e19061189c565b80601f01602080910402602001",
  "6040519081016040528092919081815260200182805461040d9061189c565b80156104585780601f1061042f576101008083540402835291",
  "60200191610458565b820191905f5260205f20905b81548152906001019060200180831161043b57829003601f168201915b505050505090",
  "5090565b5f73ffffffffffffffffffffffffffffffffffffffff83166e22d473030f116ddee9f6b43ac78ba318821915176104a057633f68",
  "539a5f526004601cfd5b82602052637f5e9f20600c52335f52816034600c2055815f52602c5160601c337f8c5be1e5ebec7d5bd14f71427d",
  "1e84f3dd0314c0f7b2291e5b200ac8c7c3b92560205fa350600192915050565b5f8360601b6e22d473030f116ddee9f6b43ac78ba3331461",
  "05435733602052637f5e9f208117600c526034600c208054801915610540578085111561053a576313be252b5f526004601cfd5b84810382",
  "555b50505b6387a211a28117600c526020600c208054808511156105695763f4d678b85f526004601cfd5b84810382555050835f52602060",
  "0c208381540181555082602052600c5160601c8160601c7fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
  "602080a3505060015b9392505050565b5f7f0cce572ee90aa29f6ac65b9a301a284e3848460016e1d377974ddad7a21d736b806105f75761",
  "05ed6103d3565b8051906020012090505b604080517f8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f8152",
  "60208101929092527fc89efdaa54c0f20c7adf612882df0950f5a951637e0307cdcb4c672f298b8bc6908201524660608201523060808201",
  "5260a09020919050565b60028054819061066f9061189c565b80601f01602080910402602001604051908101604052809291908181526020",
  "0182805461069b9061189c565b80156106e65780601f106106bd576101008083540402835291602001916106e6565b820191905f5260205f",
  "20905b8154815290600101906020018083116106c957829003601f168201915b5050505050908060010180546106fb9061189c565b80601f",
  "01602080910402602001604051908101604052809291908181526020018280546107279061189c565b80156107725780601f106107495761",
  "0100808354040283529160200191610772565b820191905f5260205f20905b81548152906001019060200180831161075557829003601f16",
  "8201915b5050505050908060020180546107879061189c565b80601f01602080910402602001604051908101604052809291908181526020",
  "018280546107b39061189c565b80156107fe5780601f106107d5576101008083540402835291602001916107fe565b820191905f5260205f",
  "20905b8154815290600101906020018083116107e157829003601f168201915b5050505050908060030180546108139061189c565b80601f",
  "016020809104026020016040519081016040528092919081815260200182805461083f9061189c565b801561088a5780601f106108615761",
  "010080835404028352916020019161088a565b820191905f5260205f20905b81548152906001019060200180831161086d57829003601f16",
  "8201915b5050505050905084565b6060610aea60026040518060800160405290815f820180546108b59061189c565b80601f016020809104",
  "02602001604051908101604052809291908181526020018280546108e19061189c565b801561092c5780601f106109035761010080835404",
  "028352916020019161092c565b820191905f5260205f20905b81548152906001019060200180831161090f57829003601f168201915b5050",
  "50505081526020016001820180546109459061189c565b80601f016020809104026020016040519081016040528092919081815260200182",
  "80546109719061189c565b80156109bc5780601f10610993576101008083540402835291602001916109bc565b820191905f5260205f2090",
  "5b81548152906001019060200180831161099f57829003601f168201915b505050505081526020016002820180546109d59061189c565b80",
  "601f0160208091040260200160405190810160405280929190818152602001828054610a019061189c565b8015610a4c5780601f10610a23",
  "57610100808354040283529160200191610a4c565b820191905f5260205f20905b815481529060010190602001808311610a2f5782900360",
  "1f168201915b50505050508152602001600382018054610a659061189c565b80601f01602080910402602001604051908101604052809291",
  "90818152602001828054610a919061189c565b8015610adc5780601f10610ab357610100808354040283529160200191610adc565b820191",
  "905f5260205f20905b815481529060010190602001808311610abf57829003601f168201915b505050505081525050610ded565b90509056",
  "5b6060600180546103e19061189c565b5f6387a211a2600c52335f526020600c20805480841115610b265763f4d678b85f526004601cfd5b",
  "83810382555050825f526020600c208281540181555081602052600c5160601c337fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4",
  "a11628f55a4df523b3ef602080a350600192915050565b73ffffffffffffffffffffffffffffffffffffffff86166e22d473030f116ddee9",
  "f6b43ac78ba31885191517610bb257633f68539a5f526004601cfd5b7f0cce572ee90aa29f6ac65b9a301a284e3848460016e1d377974dda",
  "d7a21d736b80610bea57610be06103d3565b8051906020012090505b7fc89efdaa54c0f20c7adf612882df0950f5a951637e0307cdcb4c67",
  "2f298b8bc642861015610c2057631a15a3cc5f526004601cfd5b6040518960601b60601c99508860601b60601c985065383775081901600e",
  "52895f526020600c2080547f8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f835284602084015283604084",
  "015246606084015230608084015260a08320602e527f6e71edae12b1b97f4d1f60370fef10105fa2faae0126114a169c64845d6126c98352",
  "8b60208401528a60408401528960608401528060808401528860a084015260c08320604e526042602c205f528760ff166020528660405285",
  "60605260208060805f60015afa8c3d5114610d085763ddafbaef5f526004601cfd5b019055777f5e9f200000000000000000000000000000",
  "00000000000089176040526034602c20889055888a7f8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b9256020",
  "60608501a360405250505f60605250505050505050565b5f7fffffffffffffffffffffffffffffffffffdd2b8cfcf0ee922116094bc53874",
  "5d73ffffffffffffffffffffffffffffffffffffffff831601610dd257507fffffffffffffffffffffffffffffffffffffffffffffffffff",
  "ffffffffffffff6103cd565b50602052637f5e9f20600c9081525f91909152603490205490565b6060610e00610dfb83610e26565b610fc2",
  "565b604051602001610e109190611904565b6040516020818303038152906040529050919050565b60605f604051602001610e5c907f7b00",
  "000000000000000000000000000000000000000000000000000000000000815260010190565b604080517fffffffffffffffffffffffffff",
  "ffffffffffffffffffffffffffffffffffffe08184030181529190528351519091505f9015610ecb5781610ea4855f0151610fe8565b6040",
  "51602001610eb5929190611935565b6040516020818303038152906040529150600190505b60208401515115610f34578015610eff578160",
  "4051602001610eed919061199f565b60405160208183030381529060405291505b81610f0d8560200151610fe8565b604051602001610f1e",
  "9291906119d7565b6040516020818303038152906040529150600190505b60408401515115610f99578015610f685781604051602001610f",
  "56919061199f565b60405160208183030381529060405291505b81610f768560400151610fe8565b604051602001610f87929190611a1256",
  "5b60405160208183030381529060405291505b81604051602001610faa9190611a4d565b6040516020818303038152906040529250505091",
  "9050565b60606103cd82604051806060016040528060408152602001611ba66040913960016114ec565b805160609082905f90610ffc9060",
  "02611ab2565b67ffffffffffffffff81111561101457611014611ac9565b6040519080825280601f01601f19166020018201604052801561",
  "103e576020820181803683370190505b5090505f805b83518110156114b7575f61105b8583016020015190565b90506b1000000000000004",
  "00003700600160f883901c1b1615611461577f5c0000000000000000000000000000000000000000000000000000000000000084846110a4",
  "81611af6565b9550815181106110b6576110b6611b2d565b60200101907effffffffffffffffffffffffffffffffffffffffffffffffffff",
  "ffffffffff191690815f1a9053507fff0000000000000000000000000000000000000000000000000000000000000081167f080000000000",
  "00000000000000000000000000000000000000000000000000000361119e577f620000000000000000000000000000000000000000000000",
  "0000000000000000848461115981611af6565b95508151811061116b5761116b611b2d565b60200101907effffffffffffffffffffffffff",
  "ffffffffffffffffffffffffffffffffffff191690815f1a9053506114ae565b7fff00000000000000000000000000000000000000000000",
  "00000000000000000081167f090000000000000000000000000000000000000000000000000000000000000003611213577f740000000000",
  "0000000000000000000000000000000000000000000000000000848461115981611af6565b7fff0000000000000000000000000000000000",
  "000000000000000000000000000081167f0a0000000000000000000000000000000000000000000000000000000000000003611288577f6e",
  "00000000000000000000000000000000000000000000000000000000000000848461115981611af6565b7fff000000000000000000000000",
  "0000000000000000000000000000000000000081167f0c000000000000000000000000000000000000000000000000000000000000000361",
  "12fd577f6600000000000000000000000000000000000000000000000000000000000000848461115981611af6565b7fff00000000000000",
  "00000000000000000000000000000000000000000000000081167f0d00000000000000000000000000000000000000000000000000000000",
  "00000003611372577f7200000000000000000000000000000000000000000000000000000000000000848461115981611af6565b7fff0000",
  "000000000000000000000000000000000000000000000000000000000081167f5c0000000000000000000000000000000000000000000000",
  "0000000000000000036113e7577f5c00000000000000000000000000000000000000000000000000000000000000848461115981611af656",
  "5b7fff0000000000000000000000000000000000000000000000000000000000000081167f22000000000000000000000000000000000000",
  "000000000000000000000000000361145c577f22000000000000000000000000000000000000000000000000000000000000008484611159",
  "81611af6565b6114ae565b80848461146d81611af6565b95508151811061147f5761147f611b2d565b60200101907effffffffffffffffff",
  "ffffffffffffffffffffffffffffffffffffffffffff191690815f1a9053505b50600101611044565b50808252603f017fffffffffffffff",
  "ffffffffffffffffffffffffffffffffffffffffffffffffe01681016040529392505050565b606083515f0361150a575060408051602081",
  "019091525f81526105b7565b5f8261153a576003855160046115209190611ab2565b61152b906002611b5a565b6115359190611b6d565b61",
  "155f565b60038551600261154a9190611b5a565b6115549190611b6d565b61155f906004611ab2565b90505f8167ffffffffffffffff8111",
  "1561157b5761157b611ac9565b6040519080825280601f01601f1916602001820160405280156115a5576020820181803683370190505b50",
  "9050600185016020820187885189016020810180515f82525b8284101561161a576003840193508351603f8160121c168701518653600186",
  "019550603f81600c1c168701518653600186019550603f8160061c168701518653600186019550603f811687015186535060018501945061",
  "15bf565b90525050851561165b5760038851066001811461163e576002811461165157611659565b603d6001830353603d60028303536116",
  "59565b603d60018303535b505b50909695505050505050565b5f60208284031215611677575f5ffd5b81357fffffffff0000000000000000",
  "0000000000000000000000000000000000000000811681146105b7575f5ffd5b5f81518084528060208401602086015e5f60208286010152",
  "60207fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe0601f83011685010191505092915050565b60208152",
  "5f6105b760208301846116a6565b803573ffffffffffffffffffffffffffffffffffffffff81168114611727575f5ffd5b919050565b5f5f",
  "6040838503121561173d575f5ffd5b61174683611704565b946020939093013593505050565b5f5f5f60608486031215611766575f5ffd5b",
  "61176f84611704565b925061177d60208501611704565b929592945050506040919091013590565b608081525f6117a060808301876116a6",
  "565b82810360208401526117b281876116a6565b905082810360408401526117c681866116a6565b905082810360608401526117da818561",
  "16a6565b979650505050505050565b5f602082840312156117f5575f5ffd5b6105b782611704565b5f5f5f5f5f5f5f60e0888a0312156118",
  "14575f5ffd5b61181d88611704565b965061182b60208901611704565b95506040880135945060608801359350608088013560ff81168114",
  "61184e575f5ffd5b9699959850939692959460a0840135945060c09093013592915050565b5f5f6040838503121561187c575f5ffd5b6118",
  "8583611704565b915061189360208401611704565b90509250929050565b600181811c908216806118b057607f821691505b602082108103",
  "6118e7577f4e487b71000000000000000000000000000000000000000000000000000000005f52602260045260245ffd5b50919050565b5f",
  "81518060208401855e5f93019283525090919050565b7f646174613a6170706c69636174696f6e2f6a736f6e3b6261736536342c00000081",
  "525f6105b7601d8301846118ed565b5f61194082856118ed565b7f226465736372697074696f6e223a220000000000000000000000000000",
  "0000008152611970600f8201856118ed565b7f22000000000000000000000000000000000000000000000000000000000000008152600101",
  "95945050505050565b5f6119aa82846118ed565b7f2c20000000000000000000000000000000000000000000000000000000000000815260",
  "02019392505050565b5f6119e282856118ed565b7f2277656273697465223a22000000000000000000000000000000000000000000815261",
  "1970600b8201856118ed565b5f611a1d82856118ed565b7f22696d616765223a220000000000000000000000000000000000000000000000",
  "815261197060098201856118ed565b5f611a5882846118ed565b7f7d00000000000000000000000000000000000000000000000000000000",
  "00000081526001019392505050565b7f4e487b71000000000000000000000000000000000000000000000000000000005f52601160045260",
  "245ffd5b80820281158282048414176103cd576103cd611a85565b7f4e487b71000000000000000000000000000000000000000000000000",
  "000000005f52604160045260245ffd5b5f7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff8203611b2657",
  "611b26611a85565b5060010190565b7f4e487b71000000000000000000000000000000000000000000000000000000005f52603260045260",
  "245ffd5b808201808211156103cd576103cd611a85565b5f82611ba0577f4e487b7100000000000000000000000000000000000000000000",
  "0000000000005f52601260045260245ffd5b50049056fe4142434445464748494a4b4c4d4e4f505152535455565758595a61626364656667",
  "68696a6b6c6d6e6f707172737475767778797a303132333435363738392b2fa164736f6c634300081c000a",
].join("");

function hash(value) {
  return `0x${BigInt(value).toString(16).padStart(64, "0")}`;
}

function topicAddress(address) {
  return `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`;
}

function makeLog({
  amountRaw,
  blockNumber = 15n,
  from = SENDER_A,
  logIndex = 0n,
  to = MAIN_TOKEN_MIGRATION_POLICY.migrationWallet,
  transactionIndex = 0n,
  txHash = hash(10_000n + logIndex),
} = {}) {
  return {
    address: MAIN_TOKEN_MIGRATION_POLICY.tokenAddress,
    blockHash: hash(1_000n + blockNumber),
    blockNumber,
    data: `0x${amountRaw.toString(16).padStart(64, "0")}`,
    logIndex,
    removed: false,
    topics: [
      MAIN_TOKEN_MIGRATION_POLICY.transferTopic,
      topicAddress(from),
      topicAddress(to),
    ],
    transactionHash: txHash,
    transactionIndex,
  };
}

function makeSenderCodeObservation({
  address,
  blockNumber,
  runtimeCode = "0x",
}) {
  return {
    address,
    blockHash: hash(1_000n + blockNumber),
    blockNumber,
    runtimeCode,
  };
}

function makeTransactionSenderObservation(log, from = null) {
  return {
    blockHash: log.blockHash,
    blockNumber: log.blockNumber,
    from: from ?? `0x${log.topics[1].slice(26)}`,
    transactionHash: log.transactionHash,
  };
}

function baseInput(overrides = {}) {
  const firstAmount = 9_007_199_254_740_993n;
  const secondAmount = 12_345_678_901_234_567_890n;
  const thirdAmount = 77n;
  const first = makeLog({
    amountRaw: firstAmount,
    blockNumber: 11n,
    logIndex: 1n,
    transactionIndex: 2n,
  });
  const second = makeLog({
    amountRaw: secondAmount,
    blockNumber: 12n,
    from: SENDER_B,
    logIndex: 0n,
    transactionIndex: 1n,
  });
  const third = makeLog({
    amountRaw: thirdAmount,
    blockNumber: 13n,
    from: SENDER_A,
    logIndex: 2n,
    transactionIndex: 0n,
  });
  const contractDeposit = makeLog({
    amountRaw: 5n,
    blockNumber: 14n,
    from: CONTRACT_SENDER,
    logIndex: 3n,
    transactionIndex: 0n,
  });
  const zero = makeLog({
    amountRaw: 0n,
    blockNumber: 15n,
    from: SENDER_B,
    logIndex: 4n,
    transactionIndex: 0n,
  });
  const closingBalanceRaw = firstAmount + secondAmount + thirdAmount + 5n;
  return {
    boundaryBlock: {
      hash: hash(121n),
      number: 121n,
      parentHash: hash(120n),
      timestamp: DEADLINE,
    },
    chainId: 1n,
    closingBalanceRaw,
    closingDecimals: 18n,
    closingRuntimeCode: TOKEN_RUNTIME_CODE,
    closingTotalSupplyRaw: MAIN_TOKEN_MIGRATION_POLICY.tokenTotalSupplyRaw,
    closingWalletCode: "0x",
    closingWalletTransactionCount: 0n,
    deadlineTimestamp: DEADLINE,
    endBlock: {
      hash: hash(120n),
      number: 120n,
      parentHash: hash(119n),
      timestamp: DEADLINE - 1n,
    },
    finalizedBlock: {
      hash: hash(130n),
      number: 130n,
      parentHash: hash(129n),
      timestamp: DEADLINE + 100n,
    },
    genesisHash: MAIN_TOKEN_MIGRATION_POLICY.ethereumGenesisHash,
    inboundLogs: [zero, third, first, second, first, contractDeposit],
    migrationWallet: MAIN_TOKEN_MIGRATION_POLICY.migrationWallet,
    openingBalanceRaw: 0n,
    openingDecimals: 18n,
    openingRuntimeCode: TOKEN_RUNTIME_CODE,
    openingTotalSupplyRaw: MAIN_TOKEN_MIGRATION_POLICY.tokenTotalSupplyRaw,
    openingWalletCode: "0x",
    openingWalletTransactionCount: 0n,
    outboundLogs: [],
    previousBlock: {
      hash: hash(9n),
      number: 9n,
      parentHash: hash(8n),
      timestamp: WINDOW_START - 1n,
    },
    senderCodeObservations: [
      makeSenderCodeObservation({ address: SENDER_A, blockNumber: 11n }),
      makeSenderCodeObservation({ address: SENDER_B, blockNumber: 12n }),
      makeSenderCodeObservation({ address: SENDER_A, blockNumber: 13n }),
      makeSenderCodeObservation({
        address: CONTRACT_SENDER,
        blockNumber: 14n,
        runtimeCode: "0x6000",
      }),
    ],
    transactionSenderObservations: [first, second, third, contractDeposit]
      .map((log) => makeTransactionSenderObservation(log)),
    startBlock: {
      hash: hash(10n),
      number: 10n,
      parentHash: hash(9n),
      timestamp: WINDOW_START,
    },
    tokenAddress: MAIN_TOKEN_MIGRATION_POLICY.tokenAddress,
    windowStartTimestamp: WINDOW_START,
    ...overrides,
  };
}

test("freezes the exact Ethereum V4 migration identities and 96-hour rule", () => {
  assert.equal(MAIN_TOKEN_MIGRATION_POLICY.chainId, 1n);
  assert.equal(
    MAIN_TOKEN_MIGRATION_POLICY.tokenAddress,
    "0x7987f03462200b3D8A072E02C89A8A41dCB124EE",
  );
  assert.equal(
    MAIN_TOKEN_MIGRATION_POLICY.migrationWallet,
    "0x228Be90653fDDAa408fB6cf9ca0AEC311dbE9A0D",
  );
  assert.equal(MAIN_TOKEN_MIGRATION_POLICY.tokenDecimals, 18n);
  assert.equal(
    MAIN_TOKEN_MIGRATION_POLICY.tokenRuntimeCodeKeccak256,
    "0x4fe466386aeebe507f6bcfc58e046a0632e4687699fa5bd28c4b7ec6333141ad",
  );
  assert.equal(MAIN_TOKEN_MIGRATION_POLICY.windowSeconds, 345_600n);
  assert.equal(MAIN_TOKEN_MIGRATION_POLICY.targetChainId, 4_663n);
  assert.equal(
    MAIN_TOKEN_MIGRATION_POLICY.targetTokenTotalSupplyRaw,
    MAIN_TOKEN_MIGRATION_POLICY.tokenTotalSupplyRaw,
  );
  assert.equal(
    MAIN_TOKEN_MIGRATION_POLICY.schema,
    "programmable-main-token-migration-snapshot/v2",
  );
  assert.equal(
    MAIN_TOKEN_MIGRATION_POLICY.releaseId,
    "v4-ethereum-to-robinhood-96h-2026-v1",
  );
  assert.equal(
    MAIN_TOKEN_MIGRATION_POLICY.cutoffRule,
    "block.timestamp >= windowStart && block.timestamp < deadline",
  );
});

test("matches Ethereum Keccak-256 vectors and the frozen V4 runtime", () => {
  assert.equal(
    keccak256Bytecode("0x"),
    "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
  );
  assert.equal(
    keccak256Bytecode(TOKEN_RUNTIME_CODE),
    MAIN_TOKEN_MIGRATION_POLICY.tokenRuntimeCodeKeccak256,
  );
});

test("deduplicates, sorts, and separates automatic from manual-review allocations", () => {
  const input = baseInput();
  const snapshot = buildMainTokenMigrationSnapshot(input);
  assert.deepEqual(snapshot.automaticAllocations, [
    {
      address: SENDER_A,
      amountRaw: "9007199254741070",
      eventCount: "2",
    },
    {
      address: SENDER_B,
      amountRaw: "12345678901234567890",
      eventCount: "1",
    },
  ]);
  assert.deepEqual(snapshot.manualReviewAllocations, [
    {
      address: CONTRACT_SENDER,
      amountRaw: "5",
      eventCount: "1",
      nonEmptyCodeObservationCount: "1",
      reviewReasons: ["runtime_code_observed"],
      transactionSenderMismatchEventCount: "0",
    },
  ]);
  assert.deepEqual(
    snapshot.senderCodeObservations.map(({ address, blockNumber, classification }) => ({
      address,
      blockNumber,
      classification,
    })),
    [
      { address: SENDER_A, blockNumber: "11", classification: "automatic" },
      { address: SENDER_A, blockNumber: "13", classification: "automatic" },
      { address: SENDER_B, blockNumber: "12", classification: "automatic" },
      { address: CONTRACT_SENDER, blockNumber: "14", classification: "manual_review" },
    ],
  );
  assert.equal(snapshot.counts.deduplicatedTransferEventCount, "5");
  assert.equal(snapshot.counts.eligibleInboundEventCount, "4");
  assert.equal(snapshot.counts.automaticAllocationCount, "2");
  assert.equal(snapshot.counts.manualReviewAllocationCount, "1");
  assert.equal(snapshot.counts.senderCodeObservationCount, "4");
  assert.equal(snapshot.counts.transactionSenderMismatchEventCount, "0");
  assert.equal(snapshot.counts.transactionSenderObservationCount, "4");
  assert.equal(snapshot.counts.zeroValueEventCount, "1");
  assert.equal(snapshot.reconciliation.openingBalanceRaw, "0");
  assert.equal(snapshot.reconciliation.inboundRaw, input.closingBalanceRaw.toString());
  assert.equal(snapshot.reconciliation.outboundRaw, "0");
  assert.equal(
    snapshot.reconciliation.automaticAllocationRaw,
    (input.closingBalanceRaw - 5n).toString(),
  );
  assert.equal(snapshot.reconciliation.manualReviewAllocationRaw, "5");
  assert.equal(
    snapshot.reconciliation.combinedAllocationRaw,
    input.closingBalanceRaw.toString(),
  );
  assert.equal(snapshot.reconciliation.matches, true);
  assert.equal(snapshot.policy.releaseId, MAIN_TOKEN_MIGRATION_POLICY.releaseId);
  assert.equal(
    snapshot.sourceToken.runtimeCodeKeccak256,
    MAIN_TOKEN_MIGRATION_POLICY.tokenRuntimeCodeKeccak256,
  );
  assert.deepEqual(snapshot.migrationWalletEvidence, {
    address: MAIN_TOKEN_MIGRATION_POLICY.migrationWallet.toLowerCase(),
    closingRuntimeCode: "0x",
    closingTransactionCount: "0",
    openingRuntimeCode: "0x",
    openingTransactionCount: "0",
  });
  assert.deepEqual(
    snapshot.transactionSenderObservations.map((observation) =>
      Object.keys(observation).sort()
    ),
    Array.from({ length: 4 }, () => [
      "blockHash",
      "blockNumber",
      "from",
      "transactionHash",
    ]),
  );
  assert.deepEqual(
    snapshot.events.map((event) => event.blockNumber),
    ["11", "12", "13", "14", "15"],
  );
});

test("emits byte-identical canonical JSON and a stable SHA-256 digest", () => {
  const firstInput = baseInput();
  const secondBase = baseInput();
  const secondInput = baseInput({
    inboundLogs: [...secondBase.inboundLogs].reverse(),
    senderCodeObservations: [...secondBase.senderCodeObservations].reverse(),
    transactionSenderObservations: [
      ...secondBase.transactionSenderObservations,
    ].reverse(),
  });
  const first = buildMainTokenMigrationSnapshot(firstInput);
  const second = buildMainTokenMigrationSnapshot(secondInput);
  assert.equal(canonicalJson(first), canonicalJson(second));
  assert.equal(sha256CanonicalJson(first), sha256CanonicalJson(second));
  assert.equal(canonicalJson({ b: 2, a: 1 }), "{\"a\":1,\"b\":2}");
  const artifact = buildMainTokenMigrationSnapshotArtifact(
    first,
    true,
    TARGET_DELIVERY,
  );
  assert.match(artifact.snapshotSha256, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(artifact.rpcAgreement.independentEndpointCount, "2");
  assert.equal(artifact.rpcAgreement.snapshotsIdentical, true);
  assert.deepEqual(artifact.targetDelivery, {
    chainId: "4663",
    distributionPlanSha256: TARGET_DELIVERY.distributionPlanSha256,
    distributorAddress: TARGET_DELIVERY.distributorAddress,
    distributorRuntimeCodeKeccak256:
      TARGET_DELIVERY.distributorRuntimeCodeKeccak256,
    tokenAddress: TARGET_DELIVERY.tokenAddress,
    tokenRuntimeCodeKeccak256:
      TARGET_DELIVERY.tokenRuntimeCodeKeccak256,
    tokenTotalSupplyRaw: MAIN_TOKEN_MIGRATION_POLICY.tokenTotalSupplyRaw.toString(),
  });
  assert.throws(
    () => buildMainTokenMigrationSnapshotArtifact(
      first,
      false,
      TARGET_DELIVERY,
    ),
    /two independent RPC snapshots were not confirmed/u,
  );
  assert.throws(
    () => buildMainTokenMigrationSnapshotArtifact(
      first,
      true,
      { ...TARGET_DELIVERY, distributorAddress: null },
    ),
    /target delivery commitment is incomplete/u,
  );
});

test("rejects any deadline that is not exactly 96 hours", () => {
  assert.throws(
    () => buildMainTokenMigrationSnapshot(baseInput({ deadlineTimestamp: DEADLINE + 1n })),
    /deadline is not exactly 96 hours/u,
  );
});

test("requires exactly one sender-code observation for every positive sender/block tuple", () => {
  const missing = baseInput();
  missing.senderCodeObservations.pop();
  assert.throws(
    () => buildMainTokenMigrationSnapshot(missing),
    /sender code observation .* is missing/u,
  );

  const duplicate = baseInput();
  duplicate.senderCodeObservations.push({ ...duplicate.senderCodeObservations[0] });
  assert.throws(
    () => buildMainTokenMigrationSnapshot(duplicate),
    /was provided more than once/u,
  );

  const wrongBlockHash = baseInput();
  wrongBlockHash.senderCodeObservations[0].blockHash = hash(999_999n);
  assert.throws(
    () => buildMainTokenMigrationSnapshot(wrongBlockHash),
    /block hash disagrees with its transfer/u,
  );

  const extra = baseInput();
  extra.senderCodeObservations.push(
    makeSenderCodeObservation({ address: SENDER_B, blockNumber: 16n }),
  );
  assert.throws(
    () => buildMainTokenMigrationSnapshot(extra),
    /is not required by an eligible transfer/u,
  );

  assert.throws(
    () => buildMainTokenMigrationSnapshot(baseInput({ senderCodeObservations: null })),
    /senderCodeObservations is not an array/u,
  );
});

test("deduplicates sender-code reads for multiple positive transfers in one sender/block tuple", () => {
  const input = baseInput();
  const secondSenderATransfer = input.inboundLogs.find(
    (log) => log.topics[1] === topicAddress(SENDER_A) && log.blockNumber === 13n,
  );
  secondSenderATransfer.blockNumber = 11n;
  secondSenderATransfer.blockHash = hash(1_011n);
  const matchingTransactionObservation = input.transactionSenderObservations.find(
    (observation) =>
      observation.transactionHash === secondSenderATransfer.transactionHash,
  );
  matchingTransactionObservation.blockNumber = secondSenderATransfer.blockNumber;
  matchingTransactionObservation.blockHash = secondSenderATransfer.blockHash;
  input.senderCodeObservations = input.senderCodeObservations.filter(
    (observation) => !(observation.address === SENDER_A && observation.blockNumber === 13n),
  );

  const snapshot = buildMainTokenMigrationSnapshot(input);
  assert.equal(snapshot.counts.senderCodeObservationCount, "3");
  assert.equal(
    snapshot.automaticAllocations.find((allocation) => allocation.address === SENDER_A).eventCount,
    "2",
  );
});

test("requires one block-bound transaction-sender observation per positive inbound transaction", () => {
  const missing = baseInput();
  const missingHash = missing.transactionSenderObservations.pop().transactionHash;
  assert.throws(
    () => buildMainTokenMigrationSnapshot(missing),
    new RegExp(`transaction sender observation ${missingHash} is missing`, "u"),
  );

  const conflictingDuplicate = baseInput();
  conflictingDuplicate.transactionSenderObservations.push({
    ...conflictingDuplicate.transactionSenderObservations[0],
    from: RELAYER,
  });
  assert.throws(
    () => buildMainTokenMigrationSnapshot(conflictingDuplicate),
    /was provided more than once/u,
  );

  const wrongBlockIdentity = baseInput();
  wrongBlockIdentity.transactionSenderObservations[0].blockHash = hash(999_999n);
  assert.throws(
    () => buildMainTokenMigrationSnapshot(wrongBlockIdentity),
    /block identity disagrees with its transfer/u,
  );

  const extra = baseInput();
  extra.transactionSenderObservations.push({
    blockHash: hash(1_011n),
    blockNumber: 11n,
    from: SENDER_A,
    transactionHash: hash(999_999n),
  });
  assert.throws(
    () => buildMainTokenMigrationSnapshot(extra),
    /is not required by an eligible transfer/u,
  );

  assert.throws(
    () => buildMainTokenMigrationSnapshot(baseInput({
      transactionSenderObservations: null,
    })),
    /transactionSenderObservations is not an array/u,
  );
});

test("keeps direct EOA deposits automatic and quarantines a proxy sender mismatch", () => {
  const input = baseInput();
  input.senderCodeObservations.find(
    (observation) => observation.address === CONTRACT_SENDER,
  ).runtimeCode = "0x";
  input.transactionSenderObservations.find(
    (observation) => observation.from === CONTRACT_SENDER,
  ).from = RELAYER;

  const snapshot = buildMainTokenMigrationSnapshot(input);
  assert.deepEqual(
    snapshot.automaticAllocations.map((allocation) => allocation.address),
    [SENDER_A, SENDER_B],
  );
  assert.deepEqual(snapshot.manualReviewAllocations, [
    {
      address: CONTRACT_SENDER,
      amountRaw: "5",
      eventCount: "1",
      nonEmptyCodeObservationCount: "0",
      reviewReasons: ["transaction_sender_mismatch"],
      transactionSenderMismatchEventCount: "1",
    },
  ]);
  assert.equal(snapshot.counts.transactionSenderMismatchEventCount, "1");
  assert.equal(
    snapshot.reconciliation.combinedAllocationRaw,
    input.closingBalanceRaw.toString(),
  );
});

test("moves a sender's entire amount to manual review if any deposit block has runtime code", () => {
  const input = baseInput();
  input.senderCodeObservations.find(
    (observation) => observation.address === SENDER_A && observation.blockNumber === 13n,
  ).runtimeCode = "0x6001";
  const snapshot = buildMainTokenMigrationSnapshot(input);

  assert.deepEqual(
    snapshot.automaticAllocations.map((allocation) => allocation.address),
    [SENDER_B],
  );
  assert.deepEqual(
    snapshot.manualReviewAllocations.map((allocation) => allocation.address),
    [SENDER_A, CONTRACT_SENDER],
  );
  assert.deepEqual(
    snapshot.manualReviewAllocations.find(
      (allocation) => allocation.address === SENDER_A,
    ).reviewReasons,
    ["runtime_code_observed"],
  );
  assert.equal(
    snapshot.reconciliation.automaticAllocationRaw,
    "12345678901234567890",
  );
  assert.equal(
    snapshot.reconciliation.manualReviewAllocationRaw,
    (input.closingBalanceRaw - 12_345_678_901_234_567_890n).toString(),
  );
  assert.equal(
    snapshot.reconciliation.combinedAllocationRaw,
    input.closingBalanceRaw.toString(),
  );
});

test("binds sender runtime-code bytes into independent RPC snapshot agreement", () => {
  const primary = baseInput();
  const secondary = baseInput();
  secondary.senderCodeObservations.find(
    (observation) => observation.address === CONTRACT_SENDER,
  ).runtimeCode = "0x6001";
  assert.notEqual(
    canonicalJson(buildMainTokenMigrationSnapshot(primary)),
    canonicalJson(buildMainTokenMigrationSnapshot(secondary)),
  );
});

test("binds transaction sender observations into independent RPC artifact agreement", () => {
  const primary = baseInput();
  const secondary = baseInput();
  secondary.transactionSenderObservations[0].from = RELAYER;
  assert.notEqual(
    canonicalJson(
      buildMainTokenMigrationSnapshotArtifact(
        buildMainTokenMigrationSnapshot(primary),
        true,
        TARGET_DELIVERY,
      ),
    ),
    canonicalJson(
      buildMainTokenMigrationSnapshotArtifact(
        buildMainTokenMigrationSnapshot(secondary),
        true,
        TARGET_DELIVERY,
      ),
    ),
  );
});

test("enforces the start and exclusive deadline block boundaries", () => {
  const earlyStart = baseInput();
  earlyStart.startBlock.timestamp = WINDOW_START - 1n;
  assert.throws(
    () => buildMainTokenMigrationSnapshot(earlyStart),
    /start block is before the window start/u,
  );

  const lateStart = baseInput();
  lateStart.previousBlock.timestamp = WINDOW_START;
  lateStart.startBlock.timestamp = WINDOW_START + 1n;
  assert.throws(
    () => buildMainTokenMigrationSnapshot(lateStart),
    /opening-balance block is not before the window start/u,
  );

  const lateEnd = baseInput();
  lateEnd.endBlock.timestamp = DEADLINE;
  assert.throws(
    () => buildMainTokenMigrationSnapshot(lateEnd),
    /end block is not before the exclusive deadline/u,
  );

  const earlyBoundary = baseInput();
  earlyBoundary.boundaryBlock.timestamp = DEADLINE - 1n;
  assert.throws(
    () => buildMainTokenMigrationSnapshot(earlyBoundary),
    /boundary block does not reach the exclusive deadline/u,
  );
});

test("requires the block after the deadline window to be finalized", () => {
  const input = baseInput();
  input.finalizedBlock.number = input.boundaryBlock.number - 1n;
  assert.throws(
    () => buildMainTokenMigrationSnapshot(input),
    /deadline boundary is not finalized/u,
  );
});

test("rejects conflicting txHash plus logIndex duplicates", () => {
  const input = baseInput();
  const original = input.inboundLogs[2];
  const conflict = {
    ...original,
    data: `0x${99n.toString(16).padStart(64, "0")}`,
  };
  input.inboundLogs.push(conflict);
  assert.throws(
    () => buildMainTokenMigrationSnapshot(input),
    /duplicate .* has conflicting event bytes/u,
  );
});

test("fails closed on any nonzero outbound transfer", () => {
  const outbound = makeLog({
    amountRaw: 1n,
    blockNumber: 16n,
    from: MAIN_TOKEN_MIGRATION_POLICY.migrationWallet,
    logIndex: 20n,
    to: SENDER_A,
  });
  assert.throws(
    () => buildMainTokenMigrationSnapshot(baseInput({ outboundLogs: [outbound] })),
    /nonzero outbound transfer/u,
  );
});

test("fails closed on self-transfers and mint-to-wallet events", () => {
  const selfTransfer = makeLog({
    amountRaw: 1n,
    blockNumber: 16n,
    from: MAIN_TOKEN_MIGRATION_POLICY.migrationWallet,
    logIndex: 21n,
    to: MAIN_TOKEN_MIGRATION_POLICY.migrationWallet,
  });
  assert.throws(
    () => buildMainTokenMigrationSnapshot(baseInput({
      inboundLogs: [selfTransfer],
      outboundLogs: [selfTransfer],
    })),
    /nonzero self-transfer/u,
  );

  const mint = makeLog({
    amountRaw: 1n,
    blockNumber: 16n,
    from: ZERO_ADDRESS,
    logIndex: 22n,
  });
  assert.throws(
    () => buildMainTokenMigrationSnapshot(baseInput({ inboundLogs: [mint] })),
    /received a nonzero mint/u,
  );
});

test("requires zero opening balance and exact balance reconciliation", () => {
  assert.throws(
    () => buildMainTokenMigrationSnapshot(baseInput({ openingBalanceRaw: 1n })),
    /opening V4 balance is nonzero/u,
  );
  assert.throws(
    () => buildMainTokenMigrationSnapshot(baseInput({ closingBalanceRaw: 1n })),
    /do not reconcile/u,
  );
});

test("rejects wrong chain, token, wallet code, and removed or wrong-emitter logs", () => {
  assert.throws(
    () => buildMainTokenMigrationSnapshot(baseInput({ chainId: 2n })),
    /chainId is not Ethereum mainnet/u,
  );
  assert.throws(
    () => buildMainTokenMigrationSnapshot(baseInput({ genesisHash: hash(0n) })),
    /genesis hash is not Ethereum mainnet/u,
  );
  assert.throws(
    () => buildMainTokenMigrationSnapshot(baseInput({ closingWalletCode: "0x6000" })),
    /not an unchanged plain Ethereum account/u,
  );
  assert.throws(
    () => buildMainTokenMigrationSnapshot(baseInput({ openingWalletTransactionCount: 1n })),
    /transaction count is not zero/u,
  );
  assert.throws(
    () => buildMainTokenMigrationSnapshot(baseInput({ closingWalletTransactionCount: 1n })),
    /transaction count is not zero/u,
  );
  assert.throws(
    () => buildMainTokenMigrationSnapshot(baseInput({
      closingRuntimeCode: "0x6000",
      openingRuntimeCode: "0x6000",
    })),
    /does not match the frozen keccak256/u,
  );

  const removedInput = baseInput();
  removedInput.inboundLogs[0].removed = true;
  assert.throws(
    () => buildMainTokenMigrationSnapshot(removedInput),
    /removed or lacks a removal marker/u,
  );

  const wrongEmitterInput = baseInput();
  wrongEmitterInput.inboundLogs[0].address = SENDER_A;
  assert.throws(
    () => buildMainTokenMigrationSnapshot(wrongEmitterInput),
    /address is not the frozen address/u,
  );
});
