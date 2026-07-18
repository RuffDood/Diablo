#pragma once

#include <cstdint>

namespace tcp::charsi {

enum class TargetKind : std::uint8_t {
    Superunique,
    Boss,
};

inline constexpr bool MatchesTarget(TargetKind kind, std::uint32_t configuredIndex,
    bool isSuperunique, std::int32_t superuniqueIndex, std::uint32_t monsterClassId) noexcept {
    if (kind == TargetKind::Boss) {
        return monsterClassId == configuredIndex;
    }
    return isSuperunique && superuniqueIndex >= 0
        && static_cast<std::uint32_t>(superuniqueIndex) == configuredIndex;
}

} // namespace tcp::charsi
