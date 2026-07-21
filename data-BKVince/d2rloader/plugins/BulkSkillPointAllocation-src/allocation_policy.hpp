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

constexpr AllocationMode ResolveMode(bool shiftPressed, bool ctrlPressed) noexcept {
    if (shiftPressed) return AllocationMode::ShiftAll;
    if (ctrlPressed) return AllocationMode::CtrlBatch;
    return AllocationMode::Single;
}

constexpr std::uint32_t ClampSkillPointsPerCtrlClick(std::uint32_t value) noexcept {
    return std::clamp(value, 1U, MaximumSkillPointsPerCtrlClick);
}

constexpr std::uint32_t RequestedSkillPoints(
    AllocationMode mode,
    std::uint32_t skillPointsPerCtrlClick,
    std::int32_t currentBaseLevel,
    std::int32_t runtimeMaxLevel
) noexcept {
    if (runtimeMaxLevel <= currentBaseLevel) return 0;

    const auto capacity = static_cast<std::uint32_t>(runtimeMaxLevel - currentBaseLevel);
    if (mode == AllocationMode::ShiftAll) return capacity;
    if (mode == AllocationMode::CtrlBatch) {
        return std::min(ClampSkillPointsPerCtrlClick(skillPointsPerCtrlClick), capacity);
    }
    return 1;
}

} // namespace tcp::bulk_skills
