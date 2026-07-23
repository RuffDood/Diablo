#include "quantity_tooltip.hpp"

#include <array>
#include <cassert>
#include <cstring>

int main() {
    using tcp::qty_display_issue::AppendQuantityLine;
    using tcp::qty_display_issue::BuildQuantityLine;

    assert(BuildQuantityLine(350, 500) == "Quantity: 350 of 500");
    assert(BuildQuantityLine(0, 500).empty());
    assert(BuildQuantityLine(350, 0).empty());

    std::array<char, 128> empty{};
    assert(AppendQuantityLine(empty.data(), empty.size(), 350, 500));
    assert(std::strcmp(empty.data(), "Quantity: 350 of 500") == 0);

    std::array<char, 128> existing{};
    std::strcpy(existing.data(), "Enhanced Damage: 25%");
    assert(AppendQuantityLine(existing.data(), existing.size(), 350, 500));
    assert(std::strcmp(
        existing.data(),
        "Enhanced Damage: 25%\nQuantity: 350 of 500"
    ) == 0);

    std::array<char, 128> trailingNewline{};
    std::strcpy(trailingNewline.data(), "Enhanced Damage: 25%\r\n");
    assert(AppendQuantityLine(trailingNewline.data(), trailingNewline.size(), 350, 500));
    assert(std::strcmp(
        trailingNewline.data(),
        "Enhanced Damage: 25%\r\nQuantity: 350 of 500"
    ) == 0);

    const auto duplicateBefore = trailingNewline;
    assert(!AppendQuantityLine(trailingNewline.data(), trailingNewline.size(), 350, 500));
    assert(trailingNewline == duplicateBefore);

    std::array<char, 24> tooSmall{};
    std::strcpy(tooSmall.data(), "Existing tooltip");
    const auto tooSmallBefore = tooSmall;
    assert(!AppendQuantityLine(tooSmall.data(), tooSmall.size(), 350, 500));
    assert(tooSmall == tooSmallBefore);

    return 0;
}
