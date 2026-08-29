// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

struct TransferObservationV1 {
    uint256 grossSourceDebit;
    uint256 spendableDestinationCredit;
}

interface IDomainVaultV1 {
    function CORE() external view returns (address);
    function CORE_DEPLOYMENT_ID() external view returns (bytes32);
    function DOMAIN_REVISION_ID() external view returns (bytes32);
    function ASSET_PROFILE_ID() external view returns (bytes32);
    function NATIVE_ASSET() external view returns (address);
    function VAULT_ID() external view returns (bytes32);

    function pullERC20Exact(address source, uint128 amount) external returns (TransferObservationV1 memory observation);

    function pushERC20Exact(address recipient, uint128 amount)
        external
        returns (TransferObservationV1 memory observation);

    function pushNativeExact(address payable recipient, uint128 amount)
        external
        returns (TransferObservationV1 memory observation);
}
