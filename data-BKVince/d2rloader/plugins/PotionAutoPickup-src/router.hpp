#pragma once
#include <array>
#include <cstdint>
#include <string_view>

namespace tcp::autopickup {
enum class Family : std::uint8_t { Healing, Mana, Rejuvenation, Unknown };
struct Item { std::string_view code; Family family; std::uint8_t tier; };
inline constexpr std::array Items{
    Item{"hp1",Family::Healing,1}, Item{"hp2",Family::Healing,2}, Item{"hp3",Family::Healing,3}, Item{"hp4",Family::Healing,4}, Item{"hp5",Family::Healing,5},
    Item{"mp1",Family::Mana,1}, Item{"mp2",Family::Mana,2}, Item{"mp3",Family::Mana,3}, Item{"mp4",Family::Mana,4}, Item{"mp5",Family::Mana,5},
    Item{"rvs",Family::Rejuvenation,1}, Item{"rvl",Family::Rejuvenation,2},
};
inline constexpr Item Classify(std::string_view code) noexcept {
    for (const auto& item : Items) if (item.code == code) return item;
    return {code, Family::Unknown, 0};
}
struct Policy {
    bool enabled{};
    std::array<bool,6> tiers{};
    std::array<std::uint8_t,4> columns{};
    std::uint8_t columnCount{};
    bool overflow{};
    constexpr bool Accepts(Item item) const noexcept { return enabled && item.family != Family::Unknown && item.tier < tiers.size() && tiers[item.tier]; }
};
enum class Destination : std::int8_t { Ground=-1, Inventory=0, Column1=1, Column2=2, Column3=3, Column4=4 };
inline constexpr Destination Route(const Policy& policy, Item item, const std::array<bool,4>& columnHasRoom, bool inventoryHasRoom) noexcept {
    if (!policy.Accepts(item)) return Destination::Ground;
    for (std::uint8_t i=0;i<policy.columnCount;i++) { const auto c=policy.columns[i]; if (c>=1 && c<=4 && columnHasRoom[c-1]) return static_cast<Destination>(c); }
    return policy.overflow && inventoryHasRoom ? Destination::Inventory : Destination::Ground;
}
}
