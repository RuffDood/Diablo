#pragma once

#include <algorithm>
#include <cstdint>

namespace tcp::durability {

constexpr std::uint32_t ClampResistance(std::uint32_t value) noexcept {
    return std::min(value, 100u);
}

constexpr std::uint32_t ClampEtherealMaxPercent(std::uint32_t value) noexcept {
    return std::clamp(value, 1u, 100u);
}

constexpr bool PreventsLoss(std::uint32_t resistancePercent, std::uint32_t roll) noexcept {
    return roll < ClampResistance(resistancePercent);
}

// Returned in basis points: 400 = 4.00%, 1000 = 10.00%.
constexpr std::uint32_t EffectiveChanceBasisPoints(
    std::uint32_t vanillaChancePercent,
    std::uint32_t resistancePercent
) noexcept {
    return vanillaChancePercent * (100u - ClampResistance(resistancePercent));
}

constexpr std::int32_t TargetEtherealMaxDurability(
    std::int32_t normalMaximum,
    std::uint32_t percent
) noexcept {
    if (normalMaximum <= 0) return normalMaximum;
    const auto scaled = (
        static_cast<std::int64_t>(normalMaximum) * ClampEtherealMaxPercent(percent) + 50
    ) / 100;
    return static_cast<std::int32_t>(std::clamp<std::int64_t>(scaled, 1, 255));
}

// D2R 3.2 applies (value / 2) + 1 immediately after reading the base maximum.
// Supplying this pre-compensated value makes that native formula produce target.
constexpr std::int32_t EncodeForVanillaEtherealHalving(
    std::int32_t normalMaximum,
    std::uint32_t percent
) noexcept {
    if (normalMaximum <= 0 || ClampEtherealMaxPercent(percent) == 50u) {
        return normalMaximum;
    }
    const auto target = TargetEtherealMaxDurability(normalMaximum, percent);
    return 2 * (target - 1);
}

constexpr std::int32_t ApplyVanillaEtherealHalving(std::int32_t value) noexcept {
    return value / 2 + 1;
}

} // namespace tcp::durability
