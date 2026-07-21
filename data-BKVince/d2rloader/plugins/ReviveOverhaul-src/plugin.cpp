#include <D2RLPlugin/api.h>

#include "revive_ai_policy.hpp"

#include <Windows.h>
#include <intrin.h>

#include <array>
#include <atomic>
#include <cctype>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <string>
#include <string_view>

namespace {

using tcp::revive::Policy;
using tcp::revive::RevivedSpecialState;
using tcp::revive::TransformFollowDistance;
using tcp::revive::TransformLeashDistance;
using tcp::revive::TransformVelocityBonus;

constexpr std::uint32_t SupportedBuild = 92777;
constexpr std::uintptr_t AiFunction03Rva = 0x4A3A20;
constexpr std::uintptr_t SetVelocityRva = 0x4A7270;
constexpr std::uintptr_t DistanceRva = 0x596720;
constexpr std::uintptr_t WalkToOwnerRva = 0x4A8090;
constexpr std::uintptr_t SpecialStateDispatchRva = 0x4A2BC8;
constexpr std::uintptr_t DistanceReturnRva = 0x4A3C0A;
constexpr std::uintptr_t SetVelocityReturnRva = 0x4A3C4F;
constexpr std::uintptr_t WalkToOwnerReturnRva = 0x4A3C66;

using AiFunction03Fn = std::int32_t(__fastcall*)(void*, void*, void*);
using SetVelocityFn = void(__fastcall*)(void*, std::int32_t, std::int32_t, std::uint8_t);
using DistanceFn = std::int32_t(__fastcall*)(void*, void*);
using WalkToOwnerFn = std::int32_t(__fastcall*)(void*, void*, void*, std::uint8_t, std::uint16_t);

struct Config {
    Policy ai{};
    bool diagnostics = false;
};

const D2RL::PluginContext* Context{};
std::uint8_t* Base{};
AiFunction03Fn OriginalAiFunction03{};
SetVelocityFn OriginalSetVelocity{};
DistanceFn OriginalDistance{};
WalkToOwnerFn OriginalWalkToOwner{};
Config Settings{};
thread_local std::uint32_t ReviveAiDepth{};
std::atomic_uint64_t ReviveTicks{};
std::atomic_uint64_t ScatterSuppressions{};
std::atomic_uint64_t CatchUpsForced{};
std::atomic_uint64_t FollowAdjustments{};
std::atomic_uint64_t VelocityAdjustments{};

constexpr D2RL::PluginInfo Info{
    .infoSize = D2RL::PluginInfoSize,
    .apiVersion = D2RL_PLUGIN_API_VERSION,
    .id = "revive-overhaul",
    .name = "ReviveOverhaul",
    .version = "1.1.0",
    .author = "RuffnecKk",
    .description = "Improves Revive owner following without changing other minions or native monster combat AI.",
    .flags = D2RL::PluginFlags::NativeHooks,
};

auto Trim(std::string text) -> std::string {
    const auto first = text.find_first_not_of(" \t\r\n");
    if (first == std::string::npos) return {};
    const auto last = text.find_last_not_of(" \t\r\n");
    return text.substr(first, last - first + 1);
}

auto ParseBool(std::string_view value, bool fallback) noexcept -> bool {
    if (value == "true") return true;
    if (value == "false") return false;
    return fallback;
}

auto ParseInt(std::string_view value, std::int32_t fallback) noexcept -> std::int32_t {
    try {
        return std::stoi(std::string(value));
    } catch (...) {
        return fallback;
    }
}

auto LoadConfig() -> bool {
    if (!Context || !Context->pluginConfigPath) return false;
    const auto path = std::filesystem::path(Context->pluginConfigPath).parent_path() / L"ReviveOverhaul.toml";
    std::ifstream stream(path, std::ios::binary);
    if (!stream) return false;

    Settings = {};
    std::string section;
    std::string line;
    while (std::getline(stream, line)) {
        line = Trim(line);
        if (const auto hash = line.find('#'); hash != std::string::npos) line = Trim(line.substr(0, hash));
        if (line.empty()) continue;
        if (line.front() == '[' && line.back() == ']') {
            section = Trim(line.substr(1, line.size() - 2));
            continue;
        }

        const auto equal = line.find('=');
        if (equal == std::string::npos) continue;
        const auto key = Trim(line.substr(0, equal));
        const auto value = Trim(line.substr(equal + 1));
        if (section.empty() && key == "enabled") {
            Settings.ai.enabled = ParseBool(value, Settings.ai.enabled);
        } else if (section == "ai") {
            if (key == "disable_owner_scatter") {
                Settings.ai.disableOwnerScatter = ParseBool(value, Settings.ai.disableOwnerScatter);
            } else if (key == "catch_up_distance") {
                Settings.ai.catchUpDistance = ParseInt(value, Settings.ai.catchUpDistance);
            } else if (key == "follow_distance") {
                Settings.ai.followDistance = ParseInt(value, Settings.ai.followDistance);
            } else if (key == "velocity_bonus") {
                Settings.ai.velocityBonus = ParseInt(value, Settings.ai.velocityBonus);
            }
        } else if (section == "diagnostics" && key == "enabled") {
            Settings.diagnostics = ParseBool(value, Settings.diagnostics);
        }
    }
    Settings.ai = tcp::revive::Normalize(Settings.ai);
    return true;
}

auto IsExpectedReturnAddress(void* returnAddress, std::uintptr_t rva) noexcept -> bool {
    return Base && reinterpret_cast<std::uint8_t*>(returnAddress) == Base + rva;
}

auto IsRevivedTick(void* tickParam) noexcept -> bool {
    if (!tickParam) return false;
    const auto aiControl = *static_cast<void**>(tickParam);
    if (!aiControl) return false;
    return *static_cast<const std::int32_t*>(aiControl) == RevivedSpecialState;
}

class ReviveAiScope {
public:
    explicit ReviveAiScope(bool active) noexcept : active_(active) {
        if (active_) ++ReviveAiDepth;
    }
    ~ReviveAiScope() {
        if (active_) --ReviveAiDepth;
    }
    ReviveAiScope(const ReviveAiScope&) = delete;
    auto operator=(const ReviveAiScope&) -> ReviveAiScope& = delete;

private:
    bool active_;
};

__declspec(noinline) auto __fastcall HookAiFunction03(void* game, void* monster, void* tickParam) -> std::int32_t {
    const bool revived = Settings.ai.enabled && IsRevivedTick(tickParam);
    if (revived) ++ReviveTicks;
    const ReviveAiScope scope(revived);
    return OriginalAiFunction03(game, monster, tickParam);
}

__declspec(noinline) auto __fastcall HookDistance(void* monster, void* owner) -> std::int32_t {
    void* const returnAddress = _ReturnAddress();
    const auto distance = OriginalDistance(monster, owner);
    if (ReviveAiDepth == 0 || !IsExpectedReturnAddress(returnAddress, DistanceReturnRva)) return distance;
    const auto transformed = TransformLeashDistance(distance, Settings.ai);
    if (transformed != distance) {
        if (distance <= tcp::revive::NativeScatterMaximumDistance) ++ScatterSuppressions;
        else ++CatchUpsForced;
    }
    return transformed;
}

__declspec(noinline) void __fastcall HookSetVelocity(
    void* monster,
    std::int32_t mode,
    std::int32_t velocity,
    std::uint8_t bonus
) {
    void* const returnAddress = _ReturnAddress();
    if (ReviveAiDepth != 0 && IsExpectedReturnAddress(returnAddress, SetVelocityReturnRva)) {
        const auto transformed = TransformVelocityBonus(bonus, Settings.ai);
        if (transformed != bonus) ++VelocityAdjustments;
        bonus = transformed;
    }
    OriginalSetVelocity(monster, mode, velocity, bonus);
}

__declspec(noinline) auto __fastcall HookWalkToOwner(
    void* game,
    void* monster,
    void* owner,
    std::uint8_t distance,
    std::uint16_t flags
) -> std::int32_t {
    void* const returnAddress = _ReturnAddress();
    if (ReviveAiDepth != 0 && IsExpectedReturnAddress(returnAddress, WalkToOwnerReturnRva)) {
        const auto transformed = TransformFollowDistance(distance, Settings.ai);
        if (transformed != distance) ++FollowAdjustments;
        distance = transformed;
    }
    return OriginalWalkToOwner(game, monster, owner, distance, flags);
}

auto Status(D2R::Game::Client*, const D2RL::ConsoleCommandContext* command, void*) noexcept
    -> D2RL::ConsoleCommandResult {
    if (!command || !command->plugin) return D2RL::ConsoleCommandResult::Failed;
    std::string message = "ReviveOverhaul 1.1: ";
    message += Settings.ai.enabled ? "enabled" : "disabled";
    message += ", scatter=";
    message += Settings.ai.disableOwnerScatter ? "disabled" : "vanilla";
    message += ", catch-up=" + std::to_string(Settings.ai.catchUpDistance);
    message += ", follow=" + std::to_string(Settings.ai.followDistance);
    message += ", velocity bonus=" + std::to_string(Settings.ai.velocityBonus);
    message += ", ticks=" + std::to_string(ReviveTicks.load());
    message += ", scatter fixes=" + std::to_string(ScatterSuppressions.load());
    message += ", forced catch-ups=" + std::to_string(CatchUpsForced.load());
    message += ", follow adjustments=" + std::to_string(FollowAdjustments.load());
    message += ", velocity adjustments=" + std::to_string(VelocityAdjustments.load());
    command->plugin->WriteConsoleMessage(message.c_str());
    return D2RL::ConsoleCommandResult::Handled;
}

auto ValidateRuntime() noexcept -> bool {
    constexpr std::array<std::uint8_t, 12> aiExpected{
        0x40, 0x53, 0x57, 0x41, 0x56, 0x48, 0x81, 0xEC, 0xD0, 0x00, 0x00, 0x00
    };
    constexpr std::array<std::uint8_t, 35> distanceExpected{
        0x48, 0x89, 0x5C, 0x24, 0x10, 0x48, 0x89, 0x6C, 0x24, 0x18,
        0x48, 0x89, 0x74, 0x24, 0x20, 0x57, 0x41, 0x54, 0x41, 0x55,
        0x41, 0x56, 0x41, 0x57, 0x48, 0x83, 0xEC, 0x20, 0x48, 0x8B,
        0xDA, 0x48, 0x8B, 0xF9, 0x48
    };
    constexpr std::array<std::uint8_t, 20> setVelocityExpected{
        0x48, 0x89, 0x5C, 0x24, 0x08, 0x48, 0x89, 0x6C, 0x24, 0x18,
        0x48, 0x89, 0x74, 0x24, 0x20, 0x57, 0x48, 0x83, 0xEC, 0x20
    };
    constexpr std::array<std::uint8_t, 20> walkExpected{
        0x48, 0x89, 0x5C, 0x24, 0x10, 0x48, 0x89, 0x6C, 0x24, 0x18,
        0x48, 0x89, 0x74, 0x24, 0x20, 0x41, 0x56, 0x48, 0x83, 0xEC
    };
    constexpr std::array<std::uint8_t, 19> stateDispatchExpected{
        0x48, 0x8B, 0x45, 0xAF, 0x49, 0x8B, 0xCE, 0x8B, 0x10, 0xE8,
        0xEA, 0x0A, 0x00, 0x00, 0x48, 0x63, 0x10, 0x83, 0xFA
    };
    constexpr std::array<std::uint8_t, 8> distanceCallExpected{
        0xE8, 0x16, 0x2B, 0x0F, 0x00, 0x83, 0xF8, 0x01
    };
    constexpr std::array<std::uint8_t, 15> setVelocityCallExpected{
        0x41, 0xB1, 0x28, 0x48, 0x8B, 0xCB, 0x41, 0x8D, 0x50, 0x07,
        0xE8, 0x21, 0x36, 0x00, 0x00
    };
    constexpr std::array<std::uint8_t, 10> walkCallExpected{
        0xE8, 0x2A, 0x44, 0x00, 0x00, 0xB8, 0x01, 0x00, 0x00, 0x00
    };
    return Context->CheckExpectedBytes(AiFunction03Rva, aiExpected.data(), aiExpected.size())
        && Context->CheckExpectedBytes(DistanceRva, distanceExpected.data(), distanceExpected.size())
        && Context->CheckExpectedBytes(
            SetVelocityRva,
            setVelocityExpected.data(),
            setVelocityExpected.size()
        )
        && Context->CheckExpectedBytes(WalkToOwnerRva, walkExpected.data(), walkExpected.size())
        && Context->CheckExpectedBytes(
            SpecialStateDispatchRva,
            stateDispatchExpected.data(),
            stateDispatchExpected.size()
        )
        && Context->CheckExpectedBytes(
            DistanceReturnRva - 5,
            distanceCallExpected.data(),
            distanceCallExpected.size()
        )
        && Context->CheckExpectedBytes(
            SetVelocityReturnRva - setVelocityCallExpected.size(),
            setVelocityCallExpected.data(),
            setVelocityCallExpected.size()
        )
        && Context->CheckExpectedBytes(
            WalkToOwnerReturnRva - 5,
            walkCallExpected.data(),
            walkCallExpected.size()
        );
}

auto InstallHooks() noexcept -> bool {
    constexpr std::array<std::uint8_t, 12> aiExpected{
        0x40, 0x53, 0x57, 0x41, 0x56, 0x48, 0x81, 0xEC, 0xD0, 0x00, 0x00, 0x00
    };
    constexpr std::array<std::uint8_t, 28> distanceExpected{
        0x48, 0x89, 0x5C, 0x24, 0x10, 0x48, 0x89, 0x6C, 0x24, 0x18,
        0x48, 0x89, 0x74, 0x24, 0x20, 0x57, 0x41, 0x54, 0x41, 0x55,
        0x41, 0x56, 0x41, 0x57, 0x48, 0x83, 0xEC, 0x20
    };
    constexpr std::array<std::uint8_t, 20> setVelocityExpected{
        0x48, 0x89, 0x5C, 0x24, 0x08, 0x48, 0x89, 0x6C, 0x24, 0x18,
        0x48, 0x89, 0x74, 0x24, 0x20, 0x57, 0x48, 0x83, 0xEC, 0x20
    };
    constexpr std::array<std::uint8_t, 20> walkExpected{
        0x48, 0x89, 0x5C, 0x24, 0x10, 0x48, 0x89, 0x6C, 0x24, 0x18,
        0x48, 0x89, 0x74, 0x24, 0x20, 0x41, 0x56, 0x48, 0x83, 0xEC
    };
    if (!Context->InstallInlineHook(
            AiFunction03Rva,
            aiExpected.data(),
            static_cast<std::uint32_t>(aiExpected.size()),
            HookAiFunction03,
            &OriginalAiFunction03
        )) return false;
    if (!Context->InstallInlineHook(
            DistanceRva,
            distanceExpected.data(),
            static_cast<std::uint32_t>(distanceExpected.size()),
            HookDistance,
            &OriginalDistance
        )) return false;
    if (!Context->InstallInlineHook(
            SetVelocityRva,
            setVelocityExpected.data(),
            static_cast<std::uint32_t>(setVelocityExpected.size()),
            HookSetVelocity,
            &OriginalSetVelocity
        )) return false;
    return Context->InstallInlineHook(
        WalkToOwnerRva,
        walkExpected.data(),
        static_cast<std::uint32_t>(walkExpected.size()),
        HookWalkToOwner,
        &OriginalWalkToOwner
    );
}

} // namespace

D2RL_PLUGIN_EXPORT auto D2RLoaderGetPluginInfo() noexcept -> const D2RL::PluginInfo* {
    return &Info;
}

D2RL_PLUGIN_EXPORT auto D2RLoaderLoadPlugin(const D2RL::PluginContext* context) noexcept -> bool {
    if (!context) return false;
    Context = context;
    Base = reinterpret_cast<std::uint8_t*>(GetModuleHandleW(nullptr));
    if (!Base) return false;
    if (context->modDataVersionBuild != 0 && context->modDataVersionBuild != SupportedBuild) {
        context->LogError("ReviveOverhaul: only D2R build 92777 is supported.");
        return false;
    }
    if (!LoadConfig()) {
        context->LogError("ReviveOverhaul: ReviveOverhaul.toml could not be loaded.");
        return false;
    }
    if (!ValidateRuntime()) {
        context->LogError("ReviveOverhaul: D2R 3.2.92777 signature or AI ABI mismatch; plugin refused.");
        return false;
    }
    if (!InstallHooks()) {
        context->LogError("ReviveOverhaul: native hook installation failed.");
        return false;
    }
    if (!context->RegisterConsoleCommand(
            "revive-overhaul",
            Status,
            "Show ReviveOverhaul configuration and runtime counters."
        )) {
        context->LogWarn("ReviveOverhaul: status command could not be registered.");
    }
    context->LogInfo(
        Settings.diagnostics
            ? "ReviveOverhaul 1.1 active for D2R 3.2.92777 with diagnostics enabled."
            : "ReviveOverhaul 1.1 active for D2R 3.2.92777."
    );
    return true;
}

D2RL_PLUGIN_EXPORT void D2RLoaderUnloadPlugin() noexcept {
    Context = nullptr;
    Base = nullptr;
}
