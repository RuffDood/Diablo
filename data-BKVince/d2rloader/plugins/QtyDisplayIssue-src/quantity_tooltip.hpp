#pragma once

#include <cstddef>
#include <string>

namespace tcp::qty_display_issue {

std::string BuildQuantityLine(int currentQuantity, int maximumQuantity);

bool AppendQuantityLine(
    char* buffer,
    std::size_t bufferCapacity,
    int currentQuantity,
    int maximumQuantity
) noexcept;

} // namespace tcp::qty_display_issue
