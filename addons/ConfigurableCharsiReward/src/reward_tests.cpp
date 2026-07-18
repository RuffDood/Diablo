#include "reward_state.hpp"
#include "target_policy.hpp"

#include <array>
#include <cassert>

using tcp::charsi::AddBonusRewards;
using tcp::charsi::CompleteSuccessfulImbue;
using tcp::charsi::NativeRewardBecamePending;
using tcp::charsi::RewardState;
using tcp::charsi::MatchesTarget;
using tcp::charsi::TargetKind;

int main() {
    {
        // The normal quest reward is consumed first, followed by three bonus
        // Imbues. The final state remains the normal completed state.
        RewardState state{.rewardPending = true};
        AddBonusRewards(state, 3);
        assert(state.bonusCount == 3 && !state.bonusActive);
        CompleteSuccessfulImbue(state);
        assert(state.bonusCount == 3 && state.bonusActive && state.rewardPending);
        CompleteSuccessfulImbue(state);
        CompleteSuccessfulImbue(state);
        CompleteSuccessfulImbue(state);
        assert((state == RewardState{.rewardGranted = true}));
    }

    {
        // Bonus rewards granted before Tools of the Trade must not complete or
        // consume the future vanilla quest reward.
        RewardState state{};
        AddBonusRewards(state, 2);
        assert(state.bonusActive && state.rewardPending && !state.baselineGranted);
        CompleteSuccessfulImbue(state);
        CompleteSuccessfulImbue(state);
        assert((state == RewardState{}));
    }

    {
        // If the player completes the vanilla quest while a bonus is exposed,
        // that normal reward is remembered and served without losing bonuses.
        RewardState state{};
        AddBonusRewards(state, 2);
        NativeRewardBecamePending(state);
        assert(state.normalOwed);
        CompleteSuccessfulImbue(state);
        assert(!state.bonusActive && state.rewardPending && state.bonusCount == 1);
        CompleteSuccessfulImbue(state);
        assert(state.bonusActive && state.rewardPending && state.bonusCount == 1);
        CompleteSuccessfulImbue(state);
        assert((state == RewardState{.rewardGranted = true}));
    }

    {
        // Repeated kills saturate the persistent queue at the supported cap.
        RewardState state{.rewardGranted = true};
        AddBonusRewards(state, 2);
        AddBonusRewards(state, 3);
        assert(state.bonusCount == 3 && state.baselineGranted);
    }

    {
        // Difficulty records are independent by construction.
        std::array<RewardState, 3> difficulty{};
        AddBonusRewards(difficulty[0], 1);
        AddBonusRewards(difficulty[1], 2);
        AddBonusRewards(difficulty[2], 3);
        assert(difficulty[0].bonusCount == 1);
        assert(difficulty[1].bonusCount == 2);
        assert(difficulty[2].bonusCount == 3);
    }

    {
        // Superunique mode keeps its strict hcIdx and flag matching.
        assert(MatchesTarget(TargetKind::Superunique, 5, true, 5, 156));
        assert(!MatchesTarget(TargetKind::Superunique, 5, false, 5, 156));
        assert(!MatchesTarget(TargetKind::Superunique, 5, true, 6, 156));
    }

    {
        // Boss mode matches the resolved monstats class ID and does not depend
        // on the superunique flag or hcIdx.
        assert(MatchesTarget(TargetKind::Boss, 156, false, -1, 156));
        assert(MatchesTarget(TargetKind::Boss, 156, true, 5, 156));
        assert(!MatchesTarget(TargetKind::Boss, 156, false, -1, 705));
    }
}
