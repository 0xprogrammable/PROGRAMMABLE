// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

contract NativeSinkMock {
    receive() external payable { }
}

contract GasRecordingNativeRecipientMock {
    uint256 public gasAtEntry;

    receive() external payable {
        gasAtEntry = gasleft();
    }
}

contract ForwardingNativeRecipientMock {
    address payable public immutable SINK;

    constructor(address payable sink) {
        SINK = sink;
    }

    receive() external payable {
        (bool success,) = SINK.call{ value: msg.value }("");
        require(success, "FORWARD_FAILED");
    }
}

contract RevertingNativeRecipientMock {
    receive() external payable {
        revert("HOSTILE_RECIPIENT");
    }
}

contract OversizedReturnNativeRecipientMock {
    fallback() external payable {
        assembly ("memory-safe") {
            return(0, 0x101)
        }
    }
}

contract ConfigurableReturnNativeRecipientMock {
    uint256 public immutable RETURN_BYTES;

    constructor(uint256 returnBytes) {
        RETURN_BYTES = returnBytes;
    }

    receive() external payable {
        uint256 returnBytes = RETURN_BYTES;
        assembly ("memory-safe") {
            return(0, returnBytes)
        }
    }
}
