#pragma once

#include <algorithm>
#include <cstdint>

namespace tcp::bulk_skills {

enum class AllocationMode : std::uint8_t {
    Single,
    CtrlBatch,
    ShiftAll,
};

inline constexpr std::uint32_t DefaultSkillPointsPerCtrlClick = 5;
inline constexpr std::uint32_t MaximumSkillPointsPerCtrlClick = 1'000;
inline constexpr std::uint16_t AssignAllSkillPointsExtra = 0xFFFF;

constexpr AllocationMode ResolveMode(bool shiftPressed, bool ctrlPressed) noexcept {
    if (shiftPressed) return AllocationMode::ShiftAll;
    if (ctrlPressed) return AllocationMode::CtrlBatch;
    return AllocationMode::Single;
}

constexpr std::uint32_t ClampSkillPointsPerCtrlClick(std::uint32_t value) noexcept {
    return std::clamp(value, 1U, MaximumSkillPointsPerCtrlClick);
}

constexpr std::uint16_t NativeSkillPacketExtra(
    AllocationMode mode,
    std::uint32_t requestedPoints
) noexcept {
    if (mode == AllocationMode::ShiftAll) return AssignAllSkillPointsExtra;
    if (requestedPoints <= 1) return 0;
    return static_cast<std::uint16_t>(std::min(requestedPoints - 1, 0xFFFEU));
}

} // namespace tcp::bulk_skills
