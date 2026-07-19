#pragma once

#include <algorithm>
#include <cstdint>

namespace tcp::durability {

constexpr std::uint32_t PackItemTypeCode(
    char first,
    char second,
    char third,
    char fourth = ' '
) noexcept {
    return static_cast<std::uint32_t>(static_cast<std::uint8_t>(first))
        | (static_cast<std::uint32_t>(static_cast<std::uint8_t>(second)) << 8)
        | (static_cast<std::uint32_t>(static_cast<std::uint8_t>(third)) << 16)
        | (static_cast<std::uint32_t>(static_cast<std::uint8_t>(fourth)) << 24);
}

constexpr bool IsBowOrCrossbowItemTypeCode(std::uint32_t code) noexcept {
    return code == PackItemTypeCode('b', 'o', 'w')
        || code == PackItemTypeCode('x', 'b', 'o', 'w');
}

constexpr std::uint32_t ClampResistance(std::uint32_t value) noexcept {
    return std::min(value, 100u);
}

constexpr std::uint32_t ClampEtherealMaxPercent(std::uint32_t value) noexcept {
    return std::clamp(value, 1u, 200u);
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
    const auto clampedPercent = ClampEtherealMaxPercent(percent);
    const auto numerator = static_cast<std::int64_t>(normalMaximum) * clampedPercent;
    const auto scaled = clampedPercent < 100u
        ? numerator / 100 + 1
        : (numerator + 50) / 100;
    return static_cast<std::int32_t>(std::clamp<std::int64_t>(scaled, 1, 255));
}

// D2R 3.2 applies (value / 2) + 1 immediately after reading the base maximum.
// Supplying this pre-compensated value makes that native formula produce target.
constexpr std::int32_t EncodeEtherealMaximumTarget(std::int32_t target) noexcept {
    return 2 * (std::clamp(target, 1, 255) - 1);
}

constexpr std::int32_t EncodeForVanillaEtherealHalving(
    std::int32_t normalMaximum,
    std::uint32_t percent
) noexcept {
    if (normalMaximum <= 0) return normalMaximum;
    const auto target = TargetEtherealMaxDurability(normalMaximum, percent);
    return EncodeEtherealMaximumTarget(target);
}

constexpr std::int32_t ApplyVanillaEtherealHalving(std::int32_t value) noexcept {
    return value / 2 + 1;
}

} // namespace tcp::durability
