// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title IProgrammableCreate2GraphDeployerV1
/// @notice Exact public ABI of the current Generic-v2 atomic CREATE2 graph deployment boundary.
interface IProgrammableCreate2GraphDeployerV1 {
    struct GraphAuthorization {
        bytes32 routeNamespace;
        bytes32 routeNonce;
        bytes32 topologyHash;
        bytes32 graphCommitment;
        address authorizedLauncher;
        uint256 totalValue;
    }

    struct Target {
        bytes32 targetIdHash;
        bytes32 applicantSalt;
        uint256 deploymentValue;
        uint256 initializerValue;
        bytes initCode;
        bytes initializerCalldata;
    }

    error EmptyGraph();
    error GraphTargetLimitExceeded(uint256 actual, uint256 maximum);
    error GraphInputBytesLimitExceeded(uint256 actual, uint256 maximum);
    error InvalidGraphAuthorization();
    error InvalidGraphTarget(uint256 targetIndex);
    error ReentrantGraphDeployment();
    error UnauthorizedLauncher(address caller, address authorizedLauncher);
    error GraphValueMismatch(uint256 actual, uint256 authorized);
    error GraphTargetValueSumMismatch(uint256 targetSum, uint256 authorized);
    error GraphCommitmentMismatch(bytes32 actual, bytes32 reviewed);
    error GraphAuthorizationAlreadyConsumed(bytes32 authorizationKey);
    error DuplicateTargetId(uint256 firstIndex, uint256 duplicateIndex, bytes32 targetIdHash);
    error DuplicateEffectiveSalt(uint256 firstIndex, uint256 duplicateIndex, bytes32 effectiveSalt);
    error DuplicateDeploymentAddress(uint256 firstIndex, uint256 duplicateIndex, address deployment);
    error DeploymentAddressAlreadyOccupied(uint256 targetIndex, address deployment);
    error DeploymentAddressMismatch(uint256 targetIndex, address actual, address predicted);
    error DeploymentRuntimeCodeMissing(uint256 targetIndex, address deployment);
    error InitializerCallFailed(
        uint256 targetIndex, address deployment, uint256 returnDataLength, bytes boundedReturnData
    );

    event ProgrammableCreate2GraphTargetDeployed(
        bytes32 indexed graphCommitment,
        bytes32 indexed targetIdHash,
        address indexed deployment,
        uint256 targetIndex,
        bytes32 effectiveSalt,
        bytes32 initCodeHash,
        bytes32 initializerCalldataHash,
        bytes32 runtimeCodeHash,
        uint256 deploymentValue,
        uint256 initializerValue
    );

    event ProgrammableCreate2GraphDeployed(
        bytes32 indexed routeNamespace,
        bytes32 indexed graphCommitment,
        bytes32 indexed graphDeploymentHash,
        bytes32 routeNonce,
        bytes32 topologyHash,
        address authorizedLauncher,
        uint256 totalValue,
        uint256 targetCount
    );

    function deployGraph(GraphAuthorization calldata authorization, Target[] calldata targets)
        external
        payable
        returns (
            address[] memory deployments,
            bytes32[] memory runtimeCodeHashes,
            bytes[] memory runtimeCodes,
            bytes32 graphDeploymentHash
        );

    function computeGraphCommitment(GraphAuthorization calldata authorization, Target[] calldata targets)
        external
        view
        returns (bytes32 commitment, uint256 targetValueSum);

    function effectiveTargetSalt(GraphAuthorization calldata authorization, bytes32 targetIdHash, bytes32 applicantSalt)
        external
        view
        returns (bytes32);

    function predictTarget(GraphAuthorization calldata authorization, Target calldata target)
        external
        view
        returns (address);

    function graphAuthorizationKey(GraphAuthorization calldata authorization) external view returns (bytes32);

    function consumedGraphAuthorization(bytes32 authorizationKey) external view returns (bool);
}
