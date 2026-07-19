#include "item_type_policy.hpp"

#include <array>
#include <cassert>
#include <cstdint>
#include <cstring>

namespace {
struct Record {
    std::array<char, 4> code{};
    std::array<std::uint8_t, tcp::no_ethereal::ItemTypeRecordStride - 4> padding{};
};
static_assert(sizeof(Record) == tcp::no_ethereal::ItemTypeRecordStride);
}

int main() {
    using namespace tcp::no_ethereal;

    ItemTypeCode belt{};
    assert(NormalizeItemTypeCode(" BeLt ", belt));
    assert(belt.text[0] == 'b' && belt.text[3] == 't');

    ItemTypeCode gem{};
    assert(NormalizeItemTypeCode("gem", gem));
    assert(gem.bytes[3] == ' ');

    ItemTypeCode invalid{};
    assert(!NormalizeItemTypeCode("too-long", invalid));
    assert(!NormalizeItemTypeCode("a-b", invalid));

    std::array<Record, 3> records{};
    std::memcpy(records[0].code.data(), "armo", 4);
    std::memcpy(records[1].code.data(), "belt", 4);
    std::memcpy(records[2].code.data(), "gem ", 4);

    assert(FindItemTypeId(records.data(), records.size(), sizeof(Record), belt) == 1);
    assert(FindItemTypeId(records.data(), records.size(), sizeof(Record), gem) == 2);
    assert(FindItemTypeId(nullptr, records.size(), sizeof(Record), belt) == -1);
    assert(FindItemTypeId(records.data(), 4097, sizeof(Record), belt) == -1);
    return 0;
}
