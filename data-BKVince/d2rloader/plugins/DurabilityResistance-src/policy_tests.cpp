#include "durability_policy.hpp"

#include <cassert>

using namespace tcp::durability;

int main() {
    static_assert(IsBowOrCrossbowItemTypeCode(PackItemTypeCode('b', 'o', 'w')));
    static_assert(IsBowOrCrossbowItemTypeCode(PackItemTypeCode('x', 'b', 'o', 'w')));
    static_assert(!IsBowOrCrossbowItemTypeCode(PackItemTypeCode('a', 'b', 'o', 'w')));
    static_assert(!IsBowOrCrossbowItemTypeCode(PackItemTypeCode('m', 'i', 's', 's')));

    static_assert(ClampResistance(125) == 100);
    static_assert(ClampEtherealMaxPercent(0) == 1);
    static_assert(ClampEtherealMaxPercent(125) == 125);
    static_assert(ClampEtherealMaxPercent(250) == 200);

    assert(!PreventsLoss(0, 0));
    assert(PreventsLoss(50, 49));
    assert(!PreventsLoss(50, 50));
    assert(PreventsLoss(100, 99));

    assert(EffectiveChanceBasisPoints(4, 0) == 400);
    assert(EffectiveChanceBasisPoints(4, 50) == 200);
    assert(EffectiveChanceBasisPoints(10, 75) == 250);
    assert(EffectiveChanceBasisPoints(10, 100) == 0);

    // Below 100%, keep D2R's vanilla-style floor(scaled value) + 1 bonus.
    assert(TargetEtherealMaxDurability(20, 25) == 6);
    assert(TargetEtherealMaxDurability(20, 50) == 11);
    assert(TargetEtherealMaxDurability(20, 75) == 16);
    assert(ApplyVanillaEtherealHalving(EncodeForVanillaEtherealHalving(20, 25)) == 6);
    assert(ApplyVanillaEtherealHalving(EncodeForVanillaEtherealHalving(20, 50)) == 11);
    assert(ApplyVanillaEtherealHalving(EncodeForVanillaEtherealHalving(20, 75)) == 16);

    assert(TargetEtherealMaxDurability(30, 100) == 30);
    assert(ApplyVanillaEtherealHalving(EncodeForVanillaEtherealHalving(30, 100)) == 30);
    assert(TargetEtherealMaxDurability(20, 200) == 40);
    assert(ApplyVanillaEtherealHalving(EncodeForVanillaEtherealHalving(20, 200)) == 40);
    assert(TargetEtherealMaxDurability(10, 1) == 1);
    assert(ApplyVanillaEtherealHalving(EncodeForVanillaEtherealHalving(10, 1)) == 1);
    assert(TargetEtherealMaxDurability(500, 200) == 255);
    assert(ApplyVanillaEtherealHalving(EncodeForVanillaEtherealHalving(500, 200)) == 255);
    assert(ApplyVanillaEtherealHalving(EncodeEtherealMaximumTarget(255)) == 255);
}
