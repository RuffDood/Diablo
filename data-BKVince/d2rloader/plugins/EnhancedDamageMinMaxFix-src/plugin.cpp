#define NOMINMAX
#include <D2RLPlugin/api.h>
#include "correction_policy.hpp"

#include <Windows.h>

#include <array>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <cstdio>

namespace {
using tcp::enhanced_damage::IsEnhancedDamagePackedStat;
using tcp::enhanced_damage::ItemMaxDamagePercentStat;
using tcp::enhanced_damage::ItemUnitType;
using tcp::enhanced_damage::ShouldRestoreSuppressedUpdate;
using tcp::enhanced_damage::WeaponItemTypeId;

constexpr std::uint32_t SupportedBuild = 92777;

// D2R.exe 3.2.92777, proven against the persistent decrypted image.
constexpr std::uintptr_t EvaluateAndUpdateStatRva = 0x2FA430;
constexpr std::uintptr_t GetTotalStatRva = 0x2F9B10;
constexpr std::uintptr_t UpdateUnitStatRva = 0x2F9DB0;
constexpr std::uintptr_t GetUnitTypeRva = 0x34B9D0;
constexpr std::uintptr_t CheckItemTypeRva = 0x373890;

constexpr std::size_t StatListUnitOffset = 0x00;
constexpr std::size_t StatListOwnerTypeOffset = 0x08;
constexpr std::size_t StatListOwnerOffset = 0xA0;
constexpr std::size_t ItemStatCostOperationOffset = 0x50;

using EvaluateAndUpdateStatFn = std::int32_t(__fastcall*)(
    void*,
    std::int32_t,
    void*,
    void*
) noexcept;
using GetTotalStatFn = std::int32_t(__fastcall*)(
    void*,
    std::int32_t,
    void*
) noexcept;
using UpdateUnitStatFn = void(__fastcall*)(
    void*,
    std::int32_t,
    std::int32_t,
    void*,
    void*
) noexcept;
using GetUnitTypeFn = std::int32_t(__fastcall*)(void*) noexcept;
using CheckItemTypeFn = std::int32_t(__fastcall*)(void*, std::int32_t) noexcept;

const D2RL::PluginContext* Context{};
std::uint8_t* Base{};
EvaluateAndUpdateStatFn OriginalEvaluateAndUpdateStat{};
GetTotalStatFn GetTotalStat{};
UpdateUnitStatFn UpdateUnitStat{};
GetUnitTypeFn GetUnitType{};
CheckItemTypeFn CheckItemType{};
thread_local bool CorrectionWriteActive{};

std::atomic<std::uint64_t> RestoredUpdates{};
std::atomic<std::uint64_t> RestoredMaximumComponents{};
std::atomic<std::uint64_t> RestoredMinimumComponents{};
std::atomic<std::uint64_t> WeaponUpdatesLeftVanilla{};
std::atomic<std::uint64_t> PostWriteVerificationFailures{};
std::atomic<bool> FirstCorrectionLogged{};

constexpr D2RL::PluginInfo Info{
    .infoSize = D2RL::PluginInfoSize,
    .apiVersion = D2RL_PLUGIN_API_VERSION,
    .id = "enhanced-damage-min-max-fix",
    .name = "Enhanced Damage Min/Max Fix",
    .version = "1.2.0",
    .author = "RuffnecKk",
    .description = "Restores the off-weapon op=13 update suppressed by the Enhanced Damage plus minimum/maximum damage bug on D2R 3.2.92777.",
    .flags = D2RL::PluginFlags::NativeHooks,
};

template<class T>
T At(std::uintptr_t rva) noexcept {
    return reinterpret_cast<T>(Base + rva);
}

template<class T>
T ReadAt(void* address, std::size_t offset) noexcept {
    return *reinterpret_cast<T*>(static_cast<std::uint8_t*>(address) + offset);
}

struct CorrectionWriteScope {
    CorrectionWriteScope() noexcept { CorrectionWriteActive = true; }
    ~CorrectionWriteScope() { CorrectionWriteActive = false; }
};

void* ResolveEffectiveItem(void* statList) noexcept {
    auto* activeUnit = ReadAt<void*>(statList, StatListUnitOffset);
    if (activeUnit && GetUnitType(activeUnit) == ItemUnitType) {
        return activeUnit;
    }

    auto* originalOwner = ReadAt<void*>(statList, StatListOwnerOffset);
    if (originalOwner && GetUnitType(originalOwner) == ItemUnitType) {
        return originalOwner;
    }
    return nullptr;
}

void LogFirstCorrection(
    std::int32_t packedStat,
    std::int32_t retainedValue,
    std::int32_t evaluatedValue
) noexcept {
    if (!Context || FirstCorrectionLogged.exchange(true, std::memory_order_relaxed)) {
        return;
    }

    char message[256]{};
    std::snprintf(
        message,
        sizeof(message),
        "EnhancedDamageMinMaxFix 1.2.0 applied its first off-weapon op=13 repair (stat=%u, retained=%d, evaluated=%d).",
        static_cast<unsigned>(static_cast<std::uint32_t>(packedStat) >> 16U),
        retainedValue,
        evaluatedValue
    );
    Context->LogInfo(message);
}

std::int32_t __fastcall HookEvaluateAndUpdateStat(
    void* statList,
    std::int32_t packedStat,
    void* itemStatCost,
    void* callbackUnit
) noexcept {
    const auto evaluatedValue = OriginalEvaluateAndUpdateStat(
        statList,
        packedStat,
        itemStatCost,
        callbackUnit
    );

    if (CorrectionWriteActive
        || !statList
        || !itemStatCost
        || !IsEnhancedDamagePackedStat(packedStat)) {
        return evaluatedValue;
    }

    const auto ownerType = ReadAt<std::int32_t>(
        statList,
        StatListOwnerTypeOffset
    );
    const auto operation = ReadAt<std::uint8_t>(
        itemStatCost,
        ItemStatCostOperationOffset
    );
    if (ownerType != ItemUnitType) {
        return evaluatedValue;
    }

    auto* effectiveItem = ResolveEffectiveItem(statList);
    if (!effectiveItem) {
        return evaluatedValue;
    }

    const bool effectiveItemIsWeapon =
        CheckItemType(effectiveItem, WeaponItemTypeId) != 0;
    if (effectiveItemIsWeapon) {
        WeaponUpdatesLeftVanilla.fetch_add(1, std::memory_order_relaxed);
        return evaluatedValue;
    }

    const auto retainedValue = GetTotalStat(
        statList,
        packedStat,
        itemStatCost
    );
    if (!ShouldRestoreSuppressedUpdate(
            ownerType,
            operation,
            packedStat,
            effectiveItemIsWeapon,
            evaluatedValue,
            retainedValue
        )) {
        return evaluatedValue;
    }

    {
        const CorrectionWriteScope scope;
        UpdateUnitStat(
            statList,
            packedStat,
            evaluatedValue,
            itemStatCost,
            callbackUnit
        );
    }

    const auto repairedValue = GetTotalStat(
        statList,
        packedStat,
        itemStatCost
    );
    if (repairedValue != evaluatedValue) {
        PostWriteVerificationFailures.fetch_add(1, std::memory_order_relaxed);
        return evaluatedValue;
    }

    RestoredUpdates.fetch_add(1, std::memory_order_relaxed);
    const auto stat = static_cast<std::uint32_t>(packedStat) >> 16U;
    if (stat == static_cast<std::uint32_t>(ItemMaxDamagePercentStat)) {
        RestoredMaximumComponents.fetch_add(1, std::memory_order_relaxed);
    } else {
        RestoredMinimumComponents.fetch_add(1, std::memory_order_relaxed);
    }
    LogFirstCorrection(packedStat, retainedValue, evaluatedValue);
    return evaluatedValue;
}

auto Status(
    D2R::Game::Client*,
    const D2RL::ConsoleCommandContext* command,
    void*
) noexcept -> D2RL::ConsoleCommandResult {
    if (!command || !command->plugin) {
        return D2RL::ConsoleCommandResult::Failed;
    }

    char message[512]{};
    std::snprintf(
        message,
        sizeof(message),
        "EnhancedDamageMinMaxFix 1.2.0: restored op=13 updates=%llu; maximum components=%llu; minimum components=%llu; weapon updates left vanilla=%llu; post-write failures=%llu.",
        static_cast<unsigned long long>(RestoredUpdates.load(std::memory_order_relaxed)),
        static_cast<unsigned long long>(RestoredMaximumComponents.load(std::memory_order_relaxed)),
        static_cast<unsigned long long>(RestoredMinimumComponents.load(std::memory_order_relaxed)),
        static_cast<unsigned long long>(WeaponUpdatesLeftVanilla.load(std::memory_order_relaxed)),
        static_cast<unsigned long long>(PostWriteVerificationFailures.load(std::memory_order_relaxed))
    );
    command->plugin->WriteConsoleMessage(message);
    return D2RL::ConsoleCommandResult::Handled;
}

bool InstallHook() noexcept {
    constexpr std::array<std::uint8_t, 15> expected{
        0x4C, 0x89, 0x4C, 0x24, 0x20,
        0x4C, 0x89, 0x44, 0x24, 0x18,
        0x89, 0x54, 0x24, 0x10,
        0x53
    };
    if (!Context->InstallInlineHook(
            EvaluateAndUpdateStatRva,
            expected.data(),
            static_cast<std::uint32_t>(expected.size()),
            HookEvaluateAndUpdateStat,
            &OriginalEvaluateAndUpdateStat
        )) {
        Context->LogError(
            "EnhancedDamageMinMaxFix: op=13 update signature mismatch; hook refused."
        );
        return false;
    }
    return true;
}
} // namespace

D2RL_PLUGIN_EXPORT auto D2RLoaderGetPluginInfo() noexcept -> const D2RL::PluginInfo* {
    return &Info;
}

D2RL_PLUGIN_EXPORT auto D2RLoaderLoadPlugin(
    const D2RL::PluginContext* context
) noexcept -> bool {
    if (!context) {
        return false;
    }
    Context = context;
    Base = reinterpret_cast<std::uint8_t*>(GetModuleHandleW(nullptr));
    if (!Base) {
        return false;
    }
    if (context->modDataVersionBuild != 0
        && context->modDataVersionBuild != SupportedBuild) {
        context->LogError(
            "EnhancedDamageMinMaxFix: only D2R build 92777 is supported."
        );
        return false;
    }

    GetTotalStat = At<GetTotalStatFn>(GetTotalStatRva);
    UpdateUnitStat = At<UpdateUnitStatFn>(UpdateUnitStatRva);
    GetUnitType = At<GetUnitTypeFn>(GetUnitTypeRva);
    CheckItemType = At<CheckItemTypeFn>(CheckItemTypeRva);
    if (!InstallHook()) {
        return false;
    }

    if (!context->RegisterConsoleCommand(
            "enhanced-damage-min-max-fix",
            Status,
            "Show off-weapon op=13 repair counters."
        )) {
        context->LogWarn(
            "EnhancedDamageMinMaxFix: status command could not be registered."
        );
    }
    context->LogInfo(
        "EnhancedDamageMinMaxFix 1.2.0 active for D2R 3.2.92777 (global/mod-local hybrid; op=13 update repair)."
    );
    return true;
}

D2RL_PLUGIN_EXPORT void D2RLoaderUnloadPlugin() noexcept {
    Context = nullptr;
}
