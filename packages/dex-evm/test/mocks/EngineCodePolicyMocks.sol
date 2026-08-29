// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    IReturnOnlyEngineV1,
    OpaqueEngineRequestV1,
    OpaqueEngineResponseV1
} from "../../src/interfaces/IReturnOnlyEngineV1.sol";

contract EntryCodeOnlyEngineMock is IReturnOnlyEngineV1 {
    function proposeOpaque(OpaqueEngineRequestV1 calldata request)
        external
        pure
        returns (OpaqueEngineResponseV1 memory response)
    {
        response.coreDeploymentId = request.coreDeploymentId;
        response.engineRevisionId = request.engineRevisionId;
        response.marketId = request.marketId;
        response.authorizationScopeId = request.authorizationScopeId;
        response.sessionDigest = request.sessionDigest;
        response.executionTargetId = request.executionTargetId;
        response.segmentIndex = request.segmentIndex;
        response.phase = request.phase;
        response.proposalCommitment = keccak256("");
    }
}

/// @notice Proxy-shaped fixture. Registration only authenticates this entry bytecode.
contract ProxyShapedEntryEngineMock is IReturnOnlyEngineV1 {
    address public implementation;

    constructor(address implementation_) {
        implementation = implementation_;
    }

    function setImplementation(address implementation_) external {
        implementation = implementation_;
    }

    function proposeOpaque(OpaqueEngineRequestV1 calldata request)
        external
        returns (OpaqueEngineResponseV1 memory response)
    {
        (bool success, bytes memory data) = implementation.delegatecall(msg.data);
        require(success, "DELEGATE_FAILED");
        response = abi.decode(data, (OpaqueEngineResponseV1));
        request;
    }
}

contract AlternateEntryCodeOnlyEngineMock is IReturnOnlyEngineV1 {
    uint256 public constant DIFFERENT_RUNTIME = 1;

    function proposeOpaque(OpaqueEngineRequestV1 calldata request)
        external
        pure
        returns (OpaqueEngineResponseV1 memory response)
    {
        response.coreDeploymentId = request.coreDeploymentId;
        response.sessionDigest = request.sessionDigest;
        response.proposalCommitment = keccak256("alternate");
    }
}
