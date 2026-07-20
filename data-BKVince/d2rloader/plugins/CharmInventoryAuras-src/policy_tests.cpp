#include "charm_aura_policy.hpp"

#include <cassert>

int main() {
    using tcp::charm_auras::HasNonzeroStat;
    using tcp::charm_auras::IsEligible;
    using tcp::charm_auras::PackedStatRecord;

    assert(IsEligible(true, 3, 0x10));
    assert(IsEligible(true, 3, 0x30));
    assert(!IsEligible(false, 3, 0x10));
    assert(!IsEligible(true, 6, 0x10));
    assert(!IsEligible(true, 7, 0x10));
    assert(!IsEligible(true, 3, 0));

    constexpr PackedStatRecord stats[]{
        {97u << 16 | 42u, 1},
        {151u << 16 | 99u, 12},
        {151u << 16 | 100u, 0},
    };
    static_assert(HasNonzeroStat(stats, 3, 97));
    static_assert(HasNonzeroStat(stats, 3, 151));
    static_assert(!HasNonzeroStat(stats, 3, 150));
    static_assert(!HasNonzeroStat(nullptr, 3, 151));
    return 0;
}
