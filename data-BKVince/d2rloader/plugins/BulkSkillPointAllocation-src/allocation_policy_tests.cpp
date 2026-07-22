#include "allocation_policy.hpp"

#include <cassert>

using tcp::bulk_skills::AllocationMode;
using tcp::bulk_skills::ClampSkillPointsPerCtrlClick;
using tcp::bulk_skills::NativeSkillPacketExtra;
using tcp::bulk_skills::ResolveMode;

int main() {
    assert(ResolveMode(false, false) == AllocationMode::Single);
    assert(ResolveMode(false, true) == AllocationMode::CtrlBatch);
    assert(ResolveMode(true, false) == AllocationMode::ShiftAll);
    assert(ResolveMode(true, true) == AllocationMode::ShiftAll);

    assert(ClampSkillPointsPerCtrlClick(0) == 1);
    assert(ClampSkillPointsPerCtrlClick(5) == 5);
    assert(ClampSkillPointsPerCtrlClick(10'000) == 1'000);

    assert(NativeSkillPacketExtra(AllocationMode::Single, 1) == 0);
    assert(NativeSkillPacketExtra(AllocationMode::CtrlBatch, 1) == 0);
    assert(NativeSkillPacketExtra(AllocationMode::CtrlBatch, 5) == 4);
    assert(NativeSkillPacketExtra(AllocationMode::CtrlBatch, 1'000) == 999);
    assert(NativeSkillPacketExtra(AllocationMode::ShiftAll, 1) == 0xFFFF);
}
