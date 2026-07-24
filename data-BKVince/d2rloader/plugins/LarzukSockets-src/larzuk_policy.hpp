#pragma once

#include <algorithm>
#include <array>
#include <cstddef>
#include <cstdint>
#include <optional>

namespace tcp::larzuk {

enum class Difficulty : std::uint8_t {
    Normal = 0,
    Nightmare = 1,
    Hell = 2,
};

enum class ItemQuality : std::int32_t {
    Magic = 4,
    Set = 5,
    Rare = 6,
    Unique = 7,
    Crafted = 8,
};

struct SocketRule {
    std::uint8_t minSockets{};
    std::uint8_t maxSockets{};
};

constexpr std::size_t DifficultyCount = 3;
constexpr std::size_t QualityCount = 5;
using RuleMatrix = std::array<std::array<std::optional<SocketRule>, QualityCount>, DifficultyCount>;

constexpr std::optional<std::size_t> QualityIndex(std::int32_t quality) noexcept {
    switch (static_cast<ItemQuality>(quality)) {
    case ItemQuality::Magic: return 0;
    case ItemQuality::Rare: return 1;
    case ItemQuality::Set: return 2;
    case ItemQuality::Unique: return 3;
    case ItemQuality::Crafted: return 4;
    default: return std::nullopt;
    }
}

constexpr bool IsValidRule(SocketRule rule) noexcept {
    return rule.minSockets >= 1
        && rule.maxSockets <= 6
        && rule.minSockets <= rule.maxSockets;
}

constexpr std::uint8_t EffectiveLegalMaximum(
    std::uint8_t engineMaximum,
    std::uint8_t inventoryWidth,
    std::uint8_t inventoryHeight
) noexcept {
    const auto area = static_cast<std::uint16_t>(inventoryWidth)
        * static_cast<std::uint16_t>(inventoryHeight);
    if (area == 0) return 0;
    return std::min<std::uint8_t>(
        engineMaximum,
        static_cast<std::uint8_t>(std::min<std::uint16_t>(area, 6))
    );
}

constexpr std::uint32_t LimitedRandomIndex(
    std::uint32_t rawRoll,
    std::uint32_t range
) noexcept {
    if (range <= 1) return 0;
    return (range & (range - 1)) == 0
        ? (rawRoll & (range - 1))
        : (rawRoll % range);
}

constexpr std::uint8_t ResolveSockets(
    SocketRule rule,
    std::uint8_t legalMaximum,
    std::uint32_t rawRoll
) noexcept {
    if (legalMaximum == 0) return 0;
    const auto minimum = std::min(rule.minSockets, legalMaximum);
    const auto maximum = std::min(rule.maxSockets, legalMaximum);
    const auto range = static_cast<std::uint32_t>(maximum - minimum) + 1;
    return static_cast<std::uint8_t>(minimum + LimitedRandomIndex(rawRoll, range));
}

constexpr const std::optional<SocketRule>* FindRule(
    const RuleMatrix& rules,
    std::uint8_t difficulty,
    std::int32_t quality
) noexcept {
    const auto qualityIndex = QualityIndex(quality);
    if (difficulty >= DifficultyCount || !qualityIndex) return nullptr;
    return &rules[difficulty][*qualityIndex];
}

constexpr bool HasRules(const RuleMatrix& rules) noexcept {
    for (const auto& difficulty : rules) {
        for (const auto& rule : difficulty) {
            if (rule.has_value()) return true;
        }
    }
    return false;
}

} // namespace tcp::larzuk
