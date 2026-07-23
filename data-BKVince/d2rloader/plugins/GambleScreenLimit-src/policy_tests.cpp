#include "limit_policy.hpp"

#include <cassert>
#include <cstdint>

int main() {
    using namespace tcp::gamble_screen_limit;
    std::uint32_t value{};
    assert(ParseLimit("14", value) && value == 14);
    assert(ParseLimit(" 32\r", value) && value == 32);
    assert(ParseLimit("127", value) && value == 127);
    assert(IsValidLimit(32));
    assert(!IsValidLimit(13));
    assert(!IsValidLimit(128));
    assert(!ParseLimit("13", value));
    assert(!ParseLimit("128", value));
    assert(!ParseLimit("32 items", value));
    assert(!ParseLimit("", value));
    return 0;
}
