#pragma once

#include <algorithm>
#include <cstdint>

namespace tcp::revive {

inline constexpr std::int32_t RevivedSpecialState = 7;
inline constexpr std::int32_t NativeScatterMaximumDistance = 1;
inline constexpr std::int32_t NativeCatchUpDistance = 20;
inline constexpr std::int32_t ForcedCatchUpDistance = NativeCatchUpDistance + 1;
inline constexpr std::int32_t NativeVelocityBonus = 40;

struct Policy {
    bool enabled = true;
    bool disableOwnerScatter = true;
    std::int32_t catchUpDistance = 12;
    std::int32_t followDistance = 8;
    std::int32_t velocityBonus = NativeVelocityBonus;
};

constexpr auto Normalize(Policy policy) noexcept -> Policy {
    policy.catchUpDistance = std::clamp(policy.catchUpDistance, 2, NativeCatchUpDistance);
    policy.followDistance = std::clamp(policy.followDistance, 1, policy.catchUpDistance - 1);
    policy.velocityBonus = std::clamp(policy.velocityBonus, 0, 255);
    return policy;
}

constexpr auto TransformLeashDistance(std::int32_t distance, Policy policy) noexcept -> std::int32_t {
    policy = Normalize(policy);
    if (!policy.enabled || distance < 0) return distance;
    if (policy.disableOwnerScatter && distance <= NativeScatterMaximumDistance) return 2;
    if (distance > policy.catchUpDistance && distance <= NativeCatchUpDistance) return ForcedCatchUpDistance;
    return distance;
}

constexpr auto TransformFollowDistance(std::uint8_t distance, Policy policy) noexcept -> std::uint8_t {
    policy = Normalize(policy);
    return policy.enabled ? static_cast<std::uint8_t>(policy.followDistance) : distance;
}

constexpr auto TransformVelocityBonus(std::uint8_t bonus, Policy policy) noexcept -> std::uint8_t {
    policy = Normalize(policy);
    return policy.enabled ? static_cast<std::uint8_t>(policy.velocityBonus) : bonus;
}

} // namespace tcp::revive
