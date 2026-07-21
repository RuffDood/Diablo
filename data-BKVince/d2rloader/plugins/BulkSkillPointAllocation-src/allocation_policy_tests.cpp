#include "allocation_policy.hpp"

#include <cassert>

using tcp::bulk_skills::AllocationMode;
using tcp::bulk_skills::ClampSkillPointsPerCtrlClick;
using tcp::bulk_skills::RequestedSkillPoints;
using tcp::bulk_skills::ResolveMode;

int main() {
    assert(ResolveMode(false, false) == AllocationMode::Single);
    assert(ResolveMode(false, true) == AllocationMode::CtrlBatch);
    assert(ResolveMode(true, false) == AllocationMode::ShiftAll);
    assert(ResolveMode(true, true) == AllocationMode::ShiftAll);

    assert(ClampSkillPointsPerCtrlClick(0) == 1);
    assert(ClampSkillPointsPerCtrlClick(5) == 5);
    assert(ClampSkillPointsPerCtrlClick(10'000) == 1'000);

    assert(RequestedSkillPoints(AllocationMode::Single, 5, 0, 20) == 1);
    assert(RequestedSkillPoints(AllocationMode::CtrlBatch, 1, 0, 20) == 1);
    assert(RequestedSkillPoints(AllocationMode::CtrlBatch, 5, 0, 20) == 5);
    assert(RequestedSkillPoints(AllocationMode::CtrlBatch, 10, 18, 20) == 2);
    assert(RequestedSkillPoints(AllocationMode::ShiftAll, 5, 0, 20) == 20);
    assert(RequestedSkillPoints(AllocationMode::ShiftAll, 5, 7, 25) == 18);
    assert(RequestedSkillPoints(AllocationMode::ShiftAll, 5, 11, 30) == 19);
    assert(RequestedSkillPoints(AllocationMode::ShiftAll, 5, 30, 30) == 0);
    assert(RequestedSkillPoints(AllocationMode::ShiftAll, 5, 31, 30) == 0);
}
