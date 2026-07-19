#pragma once

#include <array>
#include <cctype>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <string_view>

namespace tcp::no_ethereal {

constexpr std::size_t MaxExcludedItemTypes = 64;
constexpr std::size_t ItemTypeRecordStride = 0xE8;

struct ItemTypeCode {
    std::array<char, 4> bytes{' ', ' ', ' ', ' '};
    std::array<char, 5> text{};
    std::uint8_t length{};
};

inline bool NormalizeItemTypeCode(std::string_view input, ItemTypeCode& output) noexcept {
    while (!input.empty() && std::isspace(static_cast<unsigned char>(input.front()))) {
        input.remove_prefix(1);
    }
    while (!input.empty() && std::isspace(static_cast<unsigned char>(input.back()))) {
        input.remove_suffix(1);
    }
    if (input.empty() || input.size() > 4) return false;

    output = {};
    output.bytes.fill(' ');
    output.length = static_cast<std::uint8_t>(input.size());
    for (std::size_t index = 0; index < input.size(); ++index) {
        const auto character = static_cast<unsigned char>(input[index]);
        if (!std::isalnum(character) && character != '_') return false;
        const auto normalized = static_cast<char>(std::tolower(character));
        output.bytes[index] = normalized;
        output.text[index] = normalized;
    }
    return true;
}

inline bool SameCode(const ItemTypeCode& left, const ItemTypeCode& right) noexcept {
    return left.bytes == right.bytes;
}

inline std::int32_t FindItemTypeId(
    const void* records,
    std::uint64_t count,
    std::size_t stride,
    const ItemTypeCode& code
) noexcept {
    if (!records || stride < code.bytes.size() || count > 4096) return -1;
    const auto* bytes = static_cast<const std::uint8_t*>(records);
    for (std::uint64_t index = 0; index < count; ++index) {
        if (std::memcmp(bytes + index * stride, code.bytes.data(), code.bytes.size()) == 0) {
            return static_cast<std::int32_t>(index);
        }
    }
    return -1;
}

} // namespace tcp::no_ethereal
