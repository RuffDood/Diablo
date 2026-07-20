#pragma once

#include <cstddef>
#include <cstdint>

namespace tcp::charm_auras {
constexpr std::int32_t CharmItemTypeId = 0x0D;
constexpr std::uint8_t InventoryNodePosition = 3;
constexpr std::uint32_t IdentifiedItemFlag = 0x10;
constexpr std::size_t MaximumRefreshedCharms = 32;
constexpr std::uint16_t NonClassSkillStatId = 97;
constexpr std::uint16_t ItemAuraStatId = 151;

struct PackedStatRecord {
    std::uint32_t packed{};
    std::int32_t value{};
};

constexpr std::uint16_t StatId(std::uint32_t packed) noexcept {
    return static_cast<std::uint16_t>(packed >> 16);
}

constexpr bool HasNonzeroStat(
    const PackedStatRecord* records,
    std::size_t count,
    std::uint16_t wantedStat
) noexcept {
    if (!records) return false;
    for (std::size_t index = 0; index < count; ++index) {
        const auto stat = StatId(records[index].packed);
        if (stat > wantedStat) return false;
        if (stat == wantedStat && records[index].value != 0) return true;
    }
    return false;
}

constexpr bool IsEligible(
    bool matchesCharmType,
    std::uint8_t nodePosition,
    std::uint32_t itemFlags
) noexcept {
    return matchesCharmType
        && nodePosition == InventoryNodePosition
        && (itemFlags & IdentifiedItemFlag) != 0;
}
} // namespace tcp::charm_auras
