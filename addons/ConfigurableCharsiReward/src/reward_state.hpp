#pragma once

#include <algorithm>
#include <cstdint>

namespace tcp::charsi {

struct RewardState {
    std::uint8_t bonusCount{};
    bool bonusActive{};
    bool normalOwed{};
    bool baselineGranted{};
    bool rewardGranted{};
    bool rewardPending{};

    friend constexpr bool operator==(const RewardState&, const RewardState&) = default;
};

inline void AddBonusRewards(RewardState& state, std::uint8_t amount) noexcept {
    state.bonusCount = std::min<std::uint8_t>(3, static_cast<std::uint8_t>(state.bonusCount + amount));
    if (state.rewardPending || state.bonusActive || state.bonusCount == 0) {
        return;
    }

    state.baselineGranted = state.rewardGranted;
    state.rewardGranted = false;
    state.rewardPending = true;
    state.bonusActive = true;
}

inline void NativeRewardBecamePending(RewardState& state) noexcept {
    state.rewardPending = true;
    if (state.bonusActive) {
        state.normalOwed = true;
    }
}

inline void CompleteSuccessfulImbue(RewardState& state) noexcept {
    state.rewardGranted = true;
    state.rewardPending = false;

    if (!state.bonusActive) {
        state.normalOwed = false;
        if (state.bonusCount == 0) {
            return;
        }

        // The native reward was just consumed. Any waiting bonuses are now
        // layered on top of the completed vanilla reward.
        state.baselineGranted = true;
        state.rewardGranted = false;
        state.rewardPending = true;
        state.bonusActive = true;
        return;
    }

    if (state.bonusCount > 0) {
        --state.bonusCount;
    }
    state.bonusActive = false;

    // A vanilla Malus turn-in may happen while a bonus reward is exposed.
    // Serve that native reward next and leave remaining bonuses queued.
    if (state.normalOwed) {
        state.normalOwed = false;
        state.baselineGranted = false;
        state.rewardGranted = false;
        state.rewardPending = true;
        return;
    }

    if (state.bonusCount > 0) {
        state.rewardGranted = false;
        state.rewardPending = true;
        state.bonusActive = true;
        return;
    }

    // Restore exactly the state that existed before the first bonus was
    // exposed. In particular, an unfinished vanilla quest stays unfinished.
    state.rewardGranted = state.baselineGranted;
    state.baselineGranted = false;
}

} // namespace tcp::charsi
