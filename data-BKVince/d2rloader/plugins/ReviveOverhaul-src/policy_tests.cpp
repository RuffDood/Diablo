#include "revive_ai_policy.hpp"

#include <cassert>

using tcp::revive::ForcedCatchUpDistance;
using tcp::revive::Policy;
using tcp::revive::TransformFollowDistance;
using tcp::revive::TransformLeashDistance;
using tcp::revive::TransformVelocityBonus;

int main() {
    constexpr Policy defaults{};
    static_assert(TransformLeashDistance(0, defaults) == 2);
    static_assert(TransformLeashDistance(1, defaults) == 2);
    static_assert(TransformLeashDistance(2, defaults) == 2);
    static_assert(TransformLeashDistance(12, defaults) == 12);
    static_assert(TransformLeashDistance(13, defaults) == ForcedCatchUpDistance);
    static_assert(TransformLeashDistance(20, defaults) == ForcedCatchUpDistance);
    static_assert(TransformLeashDistance(21, defaults) == 21);
    static_assert(TransformFollowDistance(19, defaults) == 8);
    static_assert(TransformVelocityBonus(40, defaults) == 40);

    constexpr Policy vanilla{false, false, 20, 19, 40};
    static_assert(TransformLeashDistance(0, vanilla) == 0);
    static_assert(TransformLeashDistance(15, vanilla) == 15);
    static_assert(TransformFollowDistance(19, vanilla) == 19);
    static_assert(TransformVelocityBonus(40, vanilla) == 40);

    constexpr Policy keepScatter{true, false, 12, 8, 80};
    static_assert(TransformLeashDistance(1, keepScatter) == 1);
    static_assert(TransformVelocityBonus(40, keepScatter) == 80);

    constexpr Policy invalid{true, true, 1, 30, 300};
    static_assert(TransformFollowDistance(19, invalid) == 1);
    static_assert(TransformVelocityBonus(40, invalid) == 255);
    constexpr Policy negativeVelocity{true, true, 12, 8, -1};
    static_assert(TransformVelocityBonus(40, negativeVelocity) == 0);
    assert(TransformLeashDistance(-1, defaults) == -1);
}
