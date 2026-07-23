#include "quantity_tooltip.hpp"

#include <cstring>
#include <string_view>

namespace tcp::qty_display_issue {

std::string BuildQuantityLine(int currentQuantity, int maximumQuantity) {
    if (currentQuantity <= 0 || maximumQuantity <= 0) return {};
    return "Quantity: " + std::to_string(currentQuantity)
        + " of " + std::to_string(maximumQuantity);
}

bool AppendQuantityLine(
    char* buffer,
    std::size_t bufferCapacity,
    int currentQuantity,
    int maximumQuantity
) noexcept {
    if (!buffer || bufferCapacity < 2) return false;

    try {
        const auto originalLength = strnlen_s(buffer, bufferCapacity);
        if (originalLength >= bufferCapacity) return false;

        const auto line = BuildQuantityLine(currentQuantity, maximumQuantity);
        if (line.empty()) return false;

        const std::string_view original(buffer, originalLength);
        if (original.find(line) != std::string_view::npos) return false;

        const bool needsNewline = originalLength != 0 && buffer[originalLength - 1] != '\n';
        const auto required = originalLength + (needsNewline ? 1u : 0u) + line.size() + 1u;
        if (required > bufferCapacity) return false;

        auto cursor = originalLength;
        if (needsNewline) buffer[cursor++] = '\n';
        std::memcpy(buffer + cursor, line.data(), line.size());
        cursor += line.size();
        buffer[cursor] = '\0';
        return true;
    } catch (...) {
        return false;
    }
}

} // namespace tcp::qty_display_issue
