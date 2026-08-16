// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

library OracleKeeperGuard {
    struct Observation {
        uint80 roundId;
        int256 answer;
        uint256 observedAt;
    }

    error FutureObservation(uint256 observedAt, uint256 currentTimestamp);
    error StaleObservation(uint256 observedAt, uint256 currentTimestamp, uint256 maximumAge);
    error NonPositiveAnswer(int256 answer);
    error RoundRegression(uint80 priorRoundId, uint80 nextRoundId);

    function validate(
        Observation memory observation,
        uint80 priorRoundId,
        uint256 maximumAge,
        uint256 currentTimestamp
    ) internal pure {
        if (observation.observedAt > currentTimestamp) {
            revert FutureObservation(observation.observedAt, currentTimestamp);
        }
        if (currentTimestamp - observation.observedAt > maximumAge) {
            revert StaleObservation(observation.observedAt, currentTimestamp, maximumAge);
        }
        if (observation.answer <= 0) revert NonPositiveAnswer(observation.answer);
        if (observation.roundId <= priorRoundId) revert RoundRegression(priorRoundId, observation.roundId);
    }
}
