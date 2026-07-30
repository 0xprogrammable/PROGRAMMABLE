// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

import { StockPairedLaunchV3 } from "./StockPairedLaunchV3.sol";

interface IUniswapV3FactoryLikeV3 {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

interface IUniswapV3SwapRouterLikeV3 {
    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    function factory() external view returns (address);
    // The deployed Uniswap SwapRouter ABI uses this exact identifier.
    // slither-disable-next-line naming-convention
    function WETH9() external view returns (address);
    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut);
}

/// @title StockPairedEthLaunchCoordinatorV3
/// @notice Converts one ETH Initial Buy into a reviewed stock quote asset and atomically launches through
///         StockPairedLaunchV3. The coordinator has no owner, upgrade path or retained user balances.
contract StockPairedEthLaunchCoordinatorV3 is ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    uint24 public constant WETH_USDC_FEE = 500;

    StockPairedLaunchV3 public immutable launcher;
    IUniswapV3SwapRouterLikeV3 public immutable v3SwapRouter;
    IUniswapV3FactoryLikeV3 public immutable v3Factory;
    address public immutable weth;
    address public immutable usdc;

    mapping(address quoteAsset => uint24 fee) public stockPoolFee;

    struct EthLaunchParameters {
        uint256 minimumQuoteAmountOut;
        uint256 minimumInitialTokenOut;
        uint256 deadline;
        StockPairedLaunchV3.LaunchParameters launch;
    }

    error DuplicateQuoteAsset(address quoteAsset);
    error EthInputRequired();
    error InitialTokenOutputRequired();
    error InitialTokenOutputBelowMinimum(uint256 actual, uint256 minimum);
    error InvalidDependency(address dependency);
    error InvalidLaunchEnvelope();
    error InvalidQuoteSwapOutput(uint256 balanceDelta, uint256 routerAmountOut);
    error InvalidRouteConfiguration();
    error LaunchDeadlineExpired(uint256 deadline, uint256 currentTimestamp);
    error QuoteOutputRequired();
    error QuoteOutputBelowLauncherMinimum(uint256 actual, uint256 minimum);
    error ResidualAssetBalance(address asset, uint256 actual, uint256 expected);
    error UnsupportedQuoteAsset(address quoteAsset);

    event StockPairedEthTokenLaunched(
        address indexed creator,
        address indexed token,
        address indexed quoteAsset,
        uint256 initialBuyEthAmount,
        uint256 initialBuyQuoteAmount,
        uint256 initialBuyTokenAmount,
        bytes32 launchHash
    );

    constructor(
        StockPairedLaunchV3 launcher_,
        IUniswapV3SwapRouterLikeV3 v3SwapRouter_,
        IUniswapV3FactoryLikeV3 v3Factory_,
        address weth_,
        address usdc_,
        address[] memory quoteAssets_,
        uint24[] memory stockPoolFees_
    ) {
        _requireContract(address(launcher_));
        _requireContract(address(v3SwapRouter_));
        _requireContract(address(v3Factory_));
        _requireContract(weth_);
        _requireContract(usdc_);
        if (usdc_ == address(0)) revert InvalidDependency(usdc_);
        if (
            v3SwapRouter_.factory() != address(v3Factory_) || v3SwapRouter_.WETH9() != weth_ || quoteAssets_.length == 0
                || quoteAssets_.length != stockPoolFees_.length
        ) {
            revert InvalidRouteConfiguration();
        }
        _requireContract(v3Factory_.getPool(weth_, usdc_, WETH_USDC_FEE));

        launcher = launcher_;
        v3SwapRouter = v3SwapRouter_;
        v3Factory = v3Factory_;
        weth = weth_;
        usdc = usdc_;

        for (uint256 index; index < quoteAssets_.length; index++) {
            address quoteAsset = quoteAssets_[index];
            uint24 stockFee = stockPoolFees_[index];
            _requireContract(quoteAsset);
            if (stockPoolFee[quoteAsset] != 0) revert DuplicateQuoteAsset(quoteAsset);
            // The constructor iterates over the fixed, release-reviewed route list and validates every pool runtime.
            // slither-disable-next-line calls-loop
            _requireContract(v3Factory_.getPool(usdc_, quoteAsset, stockFee));
            stockPoolFee[quoteAsset] = stockFee;
        }
    }

    function effectiveCreatorSalt(address creator, bytes32 creatorSalt) public pure returns (bytes32) {
        return keccak256(abi.encode("programmable.stock-paired-eth-launch.v3", creator, creatorSalt));
    }

    function routePath(address quoteAsset) public view returns (bytes memory path) {
        uint24 stockFee = stockPoolFee[quoteAsset];
        if (stockFee == 0) revert UnsupportedQuoteAsset(quoteAsset);
        return abi.encodePacked(weth, WETH_USDC_FEE, usdc, stockFee, quoteAsset);
    }

    function predictTokenAddress(string calldata name, string calldata symbol, address creator, bytes32 creatorSalt)
        external
        view
        returns (address token, bytes32 effectiveGraffiti)
    {
        (token, effectiveGraffiti) =
            launcher.predictTokenAddress(name, symbol, address(this), effectiveCreatorSalt(creator, creatorSalt));
    }

    function launch(EthLaunchParameters calldata parameters)
        external
        payable
        nonReentrant
        returns (StockPairedLaunchV3.LaunchResult memory result)
    {
        if (msg.value == 0) revert EthInputRequired();
        // A small validator timestamp shift cannot bypass the caller's output floors; this check only expires
        // a user-signed route after its stated deadline.
        // slither-disable-start timestamp
        // forge-lint: disable-next-line(block-timestamp)
        if (parameters.deadline < block.timestamp) {
            revert LaunchDeadlineExpired(parameters.deadline, block.timestamp);
        }
        // slither-disable-end timestamp
        if (parameters.minimumQuoteAmountOut == 0) revert QuoteOutputRequired();
        if (parameters.minimumInitialTokenOut == 0) revert InitialTokenOutputRequired();
        if (parameters.launch.initialBuyQuoteAmount != 0) {
            revert InvalidLaunchEnvelope();
        }

        (uint256 quoteBalanceBefore, uint256 quoteAmount) =
            _swapEthForQuote(parameters.launch.quoteAsset, parameters.minimumQuoteAmountOut, parameters.deadline);
        result = _launchWithQuote(parameters, quoteAmount);
        _forwardInitialBuyAndCheck(result, parameters.launch.quoteAsset, quoteBalanceBefore, msg.sender);
        _emitLaunch(result, msg.sender, msg.value);
    }

    function _swapEthForQuote(address quoteAsset, uint256 minimumQuoteAmountOut, uint256 deadline)
        private
        returns (uint256 quoteBalanceBefore, uint256 quoteAmount)
    {
        IERC20 quoteToken = IERC20(quoteAsset);
        quoteBalanceBefore = quoteToken.balanceOf(address(this));
        // `launch` is transiently non-reentrant. The pre/post balance delta also rejects tokens whose transfer
        // behavior does not exactly match the reviewed router output.
        // slither-disable-next-line reentrancy-balance
        quoteAmount = v3SwapRouter.exactInput{ value: msg.value }(
            IUniswapV3SwapRouterLikeV3.ExactInputParams({
                path: routePath(quoteAsset),
                recipient: address(this),
                deadline: deadline,
                amountIn: msg.value,
                amountOutMinimum: minimumQuoteAmountOut
            })
        );
        uint256 received = quoteToken.balanceOf(address(this)) - quoteBalanceBefore;
        if (received != quoteAmount) {
            revert InvalidQuoteSwapOutput(received, quoteAmount);
        }
        uint256 launcherMinimum = launcher.MIN_INITIAL_BUY_QUOTE_AMOUNT();
        if (quoteAmount < launcherMinimum) {
            revert QuoteOutputBelowLauncherMinimum(quoteAmount, launcherMinimum);
        }
    }

    function _launchWithQuote(EthLaunchParameters calldata parameters, uint256 quoteAmount)
        private
        returns (StockPairedLaunchV3.LaunchResult memory result)
    {
        IERC20 quoteToken = IERC20(parameters.launch.quoteAsset);
        StockPairedLaunchV3.LaunchParameters memory launchParameters = parameters.launch;
        launchParameters.initialBuyQuoteAmount = quoteAmount;
        launchParameters.creatorSalt = effectiveCreatorSalt(msg.sender, parameters.launch.creatorSalt);

        quoteToken.forceApprove(address(launcher), quoteAmount);
        result = launcher.launch(launchParameters);
        quoteToken.forceApprove(address(launcher), 0);

        if (
            result.quoteAsset != parameters.launch.quoteAsset || result.initialBuyQuoteAmount != quoteAmount
                || result.initialBuyTokenAmount < parameters.minimumInitialTokenOut
        ) {
            if (result.initialBuyTokenAmount < parameters.minimumInitialTokenOut) {
                revert InitialTokenOutputBelowMinimum(result.initialBuyTokenAmount, parameters.minimumInitialTokenOut);
            }
            revert InvalidLaunchEnvelope();
        }
    }

    function _forwardInitialBuyAndCheck(
        StockPairedLaunchV3.LaunchResult memory result,
        address quoteAsset,
        uint256 quoteBalanceBefore,
        address creator
    ) private {
        IERC20 launchedToken = IERC20(result.token);
        uint256 launchedBalance = launchedToken.balanceOf(address(this));
        if (launchedBalance != result.initialBuyTokenAmount) {
            revert ResidualAssetBalance(result.token, launchedBalance, result.initialBuyTokenAmount);
        }
        launchedToken.safeTransfer(creator, result.initialBuyTokenAmount);

        uint256 finalQuoteBalance = IERC20(quoteAsset).balanceOf(address(this));
        uint256 finalTokenBalance = launchedToken.balanceOf(address(this));
        if (finalQuoteBalance != quoteBalanceBefore) {
            revert ResidualAssetBalance(quoteAsset, finalQuoteBalance, quoteBalanceBefore);
        }
        if (finalTokenBalance != 0) {
            revert ResidualAssetBalance(result.token, finalTokenBalance, 0);
        }
    }

    function _emitLaunch(StockPairedLaunchV3.LaunchResult memory result, address creator, uint256 ethAmount) private {
        emit StockPairedEthTokenLaunched(
            creator,
            result.token,
            result.quoteAsset,
            ethAmount,
            result.initialBuyQuoteAmount,
            result.initialBuyTokenAmount,
            result.launchHash
        );
    }

    function _requireContract(address dependency) private view {
        if (dependency == address(0) || dependency.code.length == 0) {
            revert InvalidDependency(dependency);
        }
    }
}
