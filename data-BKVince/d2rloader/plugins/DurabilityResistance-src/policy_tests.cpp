#include "durability_policy.hpp"

#include <cassert>

using namespace tcp::durability;

int main() {
    static_assert(ClampResistance(125) == 100);
    static_assert(ClampEtherealMaxPercent(0) == 1);
    static_assert(ClampEtherealMaxPercent(125) == 100);

    assert(!PreventsLoss(0, 0));
    assert(PreventsLoss(50, 49));
    assert(!PreventsLoss(50, 50));
    assert(PreventsLoss(100, 99));

    assert(EffectiveChanceBasisPoints(4, 0) == 400);
    assert(EffectiveChanceBasisPoints(4, 50) == 200);
    assert(EffectiveChanceBasisPoints(10, 75) == 250);
    assert(EffectiveChanceBasisPoints(10, 100) == 0);

    // A value of 50 preserves D2R's exact floor(base / 2) + 1 behavior.
    assert(EncodeForVanillaEtherealHalving(30, 50) == 30);
    assert(ApplyVanillaEtherealHalving(30) == 16);
    assert(ApplyVanillaEtherealHalving(31) == 16);

    assert(TargetEtherealMaxDurability(40, 75) == 30);
    assert(ApplyVanillaEtherealHalving(EncodeForVanillaEtherealHalving(40, 75)) == 30);
    assert(TargetEtherealMaxDurability(30, 100) == 30);
    assert(ApplyVanillaEtherealHalving(EncodeForVanillaEtherealHalving(30, 100)) == 30);
    assert(TargetEtherealMaxDurability(10, 1) == 1);
    assert(ApplyVanillaEtherealHalving(EncodeForVanillaEtherealHalving(10, 1)) == 1);
    assert(TargetEtherealMaxDurability(500, 100) == 255);
    assert(ApplyVanillaEtherealHalving(EncodeForVanillaEtherealHalving(500, 100)) == 255);
}
