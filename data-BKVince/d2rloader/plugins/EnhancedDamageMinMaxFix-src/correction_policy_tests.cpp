#include "correction_policy.hpp"

#include <cassert>

using namespace tcp::enhanced_damage;

int main() {
    static_assert(PackStat(ItemMaxDamagePercentStat) == 0x00110000);
    static_assert(PackStat(ItemMinDamagePercentStat) == 0x00120000);
    static_assert(PackStat(ItemMaxDamagePercentStat, 1) == 0x00110001);

    static_assert(IsEnhancedDamageStat(ItemMaxDamagePercentStat, 0));
    static_assert(IsEnhancedDamageStat(ItemMinDamagePercentStat, 0));
    static_assert(!IsEnhancedDamageStat(ItemMaxDamagePercentStat, 1));
    static_assert(!IsEnhancedDamageStat(19, 0));
    static_assert(IsEnhancedDamagePackedStat(0x00110000));
    static_assert(IsEnhancedDamagePackedStat(0x00120000));
    static_assert(!IsEnhancedDamagePackedStat(0x00110001));
    static_assert(!IsEnhancedDamagePackedStat(17));

    assert(ShouldRestoreSuppressedUpdate(
        ItemUnitType,
        AddItemStatPercentOperation,
        PackStat(ItemMaxDamagePercentStat),
        false,
        510,
        0
    ));
    assert(ShouldRestoreSuppressedUpdate(
        ItemUnitType,
        AddItemStatPercentOperation,
        PackStat(ItemMinDamagePercentStat),
        false,
        505,
        500
    ));

    // Weapons retain the vanilla local op=13 path.
    assert(!ShouldRestoreSuppressedUpdate(
        ItemUnitType,
        AddItemStatPercentOperation,
        PackStat(ItemMaxDamagePercentStat),
        true,
        510,
        0
    ));
    // No missing update means no duplicate engine write.
    assert(!ShouldRestoreSuppressedUpdate(
        ItemUnitType,
        AddItemStatPercentOperation,
        PackStat(ItemMaxDamagePercentStat),
        false,
        500,
        500
    ));
    // The correction is deliberately limited to op=13 ED components on items.
    assert(!ShouldRestoreSuppressedUpdate(
        0,
        AddItemStatPercentOperation,
        PackStat(ItemMaxDamagePercentStat),
        false,
        510,
        0
    ));
    assert(!ShouldRestoreSuppressedUpdate(
        ItemUnitType,
        12,
        PackStat(ItemMaxDamagePercentStat),
        false,
        510,
        0
    ));
    assert(!ShouldRestoreSuppressedUpdate(
        ItemUnitType,
        AddItemStatPercentOperation,
        PackStat(19),
        false,
        510,
        0
    ));
}
