#include "correction_policy.hpp"

#include <cassert>
#include <limits>

using namespace tcp::enhanced_damage;

int main() {
    static_assert(IsEnhancedDamageStat(ItemMaxDamagePercentStat, 0));
    static_assert(IsEnhancedDamageStat(ItemMinDamagePercentStat, 0));
    static_assert(!IsEnhancedDamageStat(ItemMaxDamagePercentStat, 1));
    static_assert(!IsEnhancedDamageStat(19, 0));

    static_assert(CanOwnActiveEquipment(PlayerUnitType));
    static_assert(CanOwnActiveEquipment(MonsterUnitType));
    static_assert(!CanOwnActiveEquipment(4));

    // ED-only already propagates and needs no correction.
    assert(MissingPercentContribution(40, 40) == 0);
    // ED/Max, ED/Min, and ED/Min/Max lose the affected percentage component.
    assert(MissingPercentContribution(40, 0) == 40);
    assert(MissingPercentContribution(80, 40) == 40);
    assert(MissingPercentContribution(80, 0) == 80);
    assert(MissingPercentContribution(0, 0) == 0);
    assert(MissingPercentContribution(-10, 0) == 0);

    assert(SaturatingAdd(100, 40) == 140);
    assert(SaturatingAdd(std::numeric_limits<std::int32_t>::max(), 1)
        == std::numeric_limits<std::int32_t>::max());
    assert(SaturatingAdd(std::numeric_limits<std::int32_t>::min(), -1)
        == std::numeric_limits<std::int32_t>::min());
}
