#include "larzuk_policy.hpp"

#include <cassert>

using namespace tcp::larzuk;

int main() {
    static_assert(QualityIndex(4) == 0);
    static_assert(QualityIndex(6) == 1);
    static_assert(QualityIndex(5) == 2);
    static_assert(QualityIndex(7) == 3);
    static_assert(QualityIndex(8) == 4);
    static_assert(!QualityIndex(2));
    static_assert(!QualityIndex(9));

    static_assert(IsValidRule({1, 1}));
    static_assert(IsValidRule({2, 6}));
    static_assert(!IsValidRule({0, 1}));
    static_assert(!IsValidRule({3, 2}));
    static_assert(!IsValidRule({1, 7}));

    static_assert(EffectiveLegalMaximum(6, 1, 1) == 1);
    static_assert(EffectiveLegalMaximum(6, 1, 2) == 2);
    static_assert(EffectiveLegalMaximum(4, 2, 3) == 4);
    static_assert(EffectiveLegalMaximum(6, 0, 2) == 0);

    static_assert(ResolveSockets({2, 2}, 6, 0) == 2);
    static_assert(ResolveSockets({4, 6}, 2, 123) == 2);
    static_assert(ResolveSockets({1, 3}, 6, 0) == 1);
    static_assert(ResolveSockets({1, 3}, 6, 1) == 2);
    static_assert(ResolveSockets({1, 3}, 6, 2) == 3);
    static_assert(ResolveSockets({1, 4}, 6, 7) == 4);

    RuleMatrix rules{};
    assert(!HasRules(rules));
    rules[static_cast<std::size_t>(Difficulty::Hell)][0] = SocketRule{2, 4};
    assert(HasRules(rules));
    const auto* rule = FindRule(rules, 2, 4);
    assert(rule && rule->has_value());
    assert((*rule)->minSockets == 2);
    assert((*rule)->maxSockets == 4);
    assert(FindRule(rules, 3, 4) == nullptr);
    assert(FindRule(rules, 2, 2) == nullptr);
}
