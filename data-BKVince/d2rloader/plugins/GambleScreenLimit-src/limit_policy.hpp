#pragma once

#include <charconv>
#include <cstdint>
#include <string_view>

namespace tcp::gamble_screen_limit {

inline constexpr std::uint32_t VanillaLimit = 14;
inline constexpr std::uint32_t DefaultLimit = 32;
inline constexpr std::uint32_t MaximumLimit = 127;

inline bool IsValidLimit(std::uint32_t value) noexcept {
    return value >= VanillaLimit && value <= MaximumLimit;
}

inline bool ParseLimit(std::string_view text, std::uint32_t& output) noexcept {
    while (!text.empty() && (text.front() == ' ' || text.front() == '\t')) text.remove_prefix(1);
    while (!text.empty() && (text.back() == ' ' || text.back() == '\t' || text.back() == '\r')) text.remove_suffix(1);
    if (text.empty()) return false;

    std::uint32_t value{};
    const auto result = std::from_chars(text.data(), text.data() + text.size(), value);
    if (result.ec != std::errc{} || result.ptr != text.data() + text.size()) return false;
    if (!IsValidLimit(value)) return false;
    output = value;
    return true;
}

} // namespace tcp::gamble_screen_limit
