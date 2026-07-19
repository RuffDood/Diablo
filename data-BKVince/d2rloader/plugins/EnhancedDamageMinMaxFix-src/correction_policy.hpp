#pragma once

#include <algorithm>
#include <cstdint>
#include <limits>

namespace tcp::enhanced_damage {

constexpr std::int32_t ItemMaxDamagePercentStat = 17;
constexpr std::int32_t ItemMinDamagePercentStat = 18;
constexpr std::int32_t PlayerUnitType = 0;
constexpr std::int32_t MonsterUnitType = 1;
constexpr std::int32_t WeaponItemTypeId = 45;

constexpr bool IsEnhancedDamageStat(std::int32_t stat, std::uint16_t layer) noexcept {
    return layer == 0
        && (stat == ItemMaxDamagePercentStat || stat == ItemMinDamagePercentStat);
}

constexpr bool CanOwnActiveEquipment(std::int32_t unitType) noexcept {
    return unitType == PlayerUnitType || unitType == MonsterUnitType;
}

constexpr std::int32_t MissingPercentContribution(
    std::int32_t rawPercent,
    std::int32_t propagatedPercent
) noexcept {
    if (rawPercent <= propagatedPercent || rawPercent <= 0) return 0;
    return rawPercent - std::max(propagatedPercent, 0);
}

constexpr std::int32_t SaturatingAdd(std::int32_t left, std::int32_t right) noexcept {
    const auto sum = static_cast<std::int64_t>(left) + right;
    return static_cast<std::int32_t>(std::clamp<std::int64_t>(
        sum,
        std::numeric_limits<std::int32_t>::min(),
        std::numeric_limits<std::int32_t>::max()
    ));
}

} // namespace tcp::enhanced_damage
