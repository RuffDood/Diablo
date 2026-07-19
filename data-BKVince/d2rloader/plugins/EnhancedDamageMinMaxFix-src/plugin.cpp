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
using tcp::enhanced_damage::CanOwnActiveEquipment;
using tcp::enhanced_damage::IsEnhancedDamageStat;
using tcp::enhanced_damage::MissingPercentContribution;
using tcp::enhanced_damage::SaturatingAdd;
using tcp::enhanced_damage::WeaponItemTypeId;

constexpr std::uint32_t SupportedBuild = 92777;
constexpr std::uintptr_t UnitGetStatValueRva = 0x2F5C60;
constexpr std::uintptr_t GetBaseStatRva = 0x2F48C0;
constexpr std::uintptr_t GetInventoryRva = 0x34A360;
constexpr std::uintptr_t GetStatListRva = 0x34B870;
constexpr std::uintptr_t GetUnitTypeRva = 0x34B9D0;
constexpr std::uintptr_t CheckItemTypeRva = 0x373890;
constexpr std::uintptr_t GetFirstItemRva = 0x388C10;
constexpr std::uintptr_t GetNextItemRva = 0x38ABA0;
constexpr std::size_t StatListOwnerOffset = 0;
constexpr std::size_t MaximumTraversedItems = 4096;
constexpr std::size_t MaximumSocketDepth = 2;

using UnitGetStatValueFn = std::int32_t(__fastcall*)(void*, std::int32_t, std::uint16_t) noexcept;
using GetBaseStatFn = std::int32_t(__fastcall*)(void*, std::int32_t, std::uint16_t) noexcept;
using GetInventoryFn = void*(__fastcall*)(void*, const char*, std::int32_t) noexcept;
using GetStatListFn = std::uint8_t*(__fastcall*)(void*) noexcept;
using GetUnitTypeFn = std::int32_t(__fastcall*)(void*) noexcept;
using CheckItemTypeFn = std::int32_t(__fastcall*)(void*, std::int32_t) noexcept;
using GetFirstItemFn = void*(__fastcall*)(void*) noexcept;
using GetNextItemFn = void*(__fastcall*)(void*) noexcept;

const D2RL::PluginContext* Context{};
std::uint8_t* Base{};
UnitGetStatValueFn OriginalUnitGetStatValue{};
GetBaseStatFn GetBaseStat{};
GetInventoryFn GetInventory{};
GetStatListFn GetStatList{};
GetUnitTypeFn GetUnitType{};
CheckItemTypeFn CheckItemType{};
GetFirstItemFn GetFirstItem{};
GetNextItemFn GetNextItem{};
thread_local bool CorrectionActive{};
std::atomic<std::uint64_t> CorrectedReads{};
std::atomic<std::uint64_t> RestoredPercentPoints{};
std::atomic<std::uint64_t> ScannedEquipmentItems{};
std::atomic<std::uint64_t> ScannedSocketFillers{};
std::atomic<std::uint64_t> TraversalGuardHits{};

constexpr D2RL::PluginInfo Info{
    .infoSize = D2RL::PluginInfoSize,
    .apiVersion = D2RL_PLUGIN_API_VERSION,
    .id = "enhanced-damage-min-max-fix",
    .name = "Enhanced Damage Min/Max Fix",
    .version = "1.0.0",
    .author = "TCP",
    .description = "Restores missing off-weapon Enhanced Damage components when flat minimum or maximum damage is present on D2R 3.2.92777.",
    .flags = D2RL::PluginFlags::ModScopedOnly | D2RL::PluginFlags::NativeHooks,
};

template<class T>
T At(std::uintptr_t rva) noexcept {
    return reinterpret_cast<T>(Base + rva);
}

struct CorrectionScope {
    CorrectionScope() noexcept { CorrectionActive = true; }
    ~CorrectionScope() { CorrectionActive = false; }
};

bool IsOwnedBy(void* item, void* owner) noexcept {
    auto* statList = GetStatList(item);
    return statList
        && *reinterpret_cast<void* const*>(statList + StatListOwnerOffset) == owner;
}

std::int32_t CollectRawSocketPercent(
    void* host,
    std::int32_t stat,
    std::size_t depth
) noexcept {
    if (!host || depth >= MaximumSocketDepth) return 0;
    auto* inventory = GetInventory(host, "EnhancedDamageMinMaxFix", __LINE__);
    if (!inventory) return 0;

    std::int32_t total{};
    std::size_t traversed{};
    for (auto* filler = GetFirstItem(inventory);
         filler && traversed < MaximumTraversedItems;
         filler = GetNextItem(filler)) {
        ++traversed;
        if (!IsOwnedBy(filler, host)) continue;
        ScannedSocketFillers.fetch_add(1, std::memory_order_relaxed);
        total = SaturatingAdd(total, GetBaseStat(filler, stat, 0));
        total = SaturatingAdd(total, CollectRawSocketPercent(filler, stat, depth + 1));
    }
    if (traversed == MaximumTraversedItems) {
        TraversalGuardHits.fetch_add(1, std::memory_order_relaxed);
    }
    return total;
}

std::int32_t MissingEquipmentPercent(void* owner, std::int32_t stat) noexcept {
    auto* inventory = GetInventory(owner, "EnhancedDamageMinMaxFix", __LINE__);
    if (!inventory) return 0;

    std::int32_t correction{};
    std::size_t traversed{};
    for (auto* item = GetFirstItem(inventory);
         item && traversed < MaximumTraversedItems;
         item = GetNextItem(item)) {
        ++traversed;
        if (!IsOwnedBy(item, owner)) continue;
        if (CheckItemType(item, WeaponItemTypeId) != 0) continue;

        ScannedEquipmentItems.fetch_add(1, std::memory_order_relaxed);
        auto rawPercent = GetBaseStat(item, stat, 0);
        rawPercent = SaturatingAdd(rawPercent, CollectRawSocketPercent(item, stat, 0));
        const auto propagatedPercent = OriginalUnitGetStatValue(item, stat, 0);
        correction = SaturatingAdd(
            correction,
            MissingPercentContribution(rawPercent, propagatedPercent)
        );
    }
    if (traversed == MaximumTraversedItems) {
        TraversalGuardHits.fetch_add(1, std::memory_order_relaxed);
    }
    return correction;
}

std::int32_t __fastcall HookUnitGetStatValue(
    void* unit,
    std::int32_t stat,
    std::uint16_t layer
) noexcept {
    const auto vanillaValue = OriginalUnitGetStatValue(unit, stat, layer);
    if (CorrectionActive || !unit || !IsEnhancedDamageStat(stat, layer)) {
        return vanillaValue;
    }
    if (!CanOwnActiveEquipment(GetUnitType(unit))) return vanillaValue;

    const CorrectionScope scope;
    const auto correction = MissingEquipmentPercent(unit, stat);
    if (correction <= 0) return vanillaValue;

    CorrectedReads.fetch_add(1, std::memory_order_relaxed);
    RestoredPercentPoints.fetch_add(
        static_cast<std::uint64_t>(correction),
        std::memory_order_relaxed
    );
    return SaturatingAdd(vanillaValue, correction);
}

auto Status(
    D2R::Game::Client*,
    const D2RL::ConsoleCommandContext* command,
    void*
) noexcept -> D2RL::ConsoleCommandResult {
    if (!command || !command->plugin) return D2RL::ConsoleCommandResult::Failed;

    char message[512]{};
    std::snprintf(
        message,
        sizeof(message),
        "EnhancedDamageMinMaxFix 1.0.0: corrected reads=%llu; restored ED points=%llu; equipment scanned=%llu; socket fillers scanned=%llu; traversal guards=%llu.",
        static_cast<unsigned long long>(CorrectedReads.load(std::memory_order_relaxed)),
        static_cast<unsigned long long>(RestoredPercentPoints.load(std::memory_order_relaxed)),
        static_cast<unsigned long long>(ScannedEquipmentItems.load(std::memory_order_relaxed)),
        static_cast<unsigned long long>(ScannedSocketFillers.load(std::memory_order_relaxed)),
        static_cast<unsigned long long>(TraversalGuardHits.load(std::memory_order_relaxed))
    );
    command->plugin->WriteConsoleMessage(message);
    return D2RL::ConsoleCommandResult::Handled;
}

bool InstallHook() noexcept {
    constexpr std::array<std::uint8_t, 15> expected{
        0x48, 0x89, 0x5C, 0x24, 0x10,
        0x48, 0x89, 0x6C, 0x24, 0x18,
        0x48, 0x89, 0x74, 0x24, 0x20
    };
    if (!Context->InstallInlineHook(
            UnitGetStatValueRva,
            expected.data(),
            static_cast<std::uint32_t>(expected.size()),
            HookUnitGetStatValue,
            &OriginalUnitGetStatValue
        )) {
        Context->LogError("EnhancedDamageMinMaxFix: stat-value signature mismatch; hook refused.");
        return false;
    }
    return true;
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
        context->LogError("EnhancedDamageMinMaxFix: only D2R build 92777 is supported.");
        return false;
    }

    GetBaseStat = At<GetBaseStatFn>(GetBaseStatRva);
    GetInventory = At<GetInventoryFn>(GetInventoryRva);
    GetStatList = At<GetStatListFn>(GetStatListRva);
    GetUnitType = At<GetUnitTypeFn>(GetUnitTypeRva);
    CheckItemType = At<CheckItemTypeFn>(CheckItemTypeRva);
    GetFirstItem = At<GetFirstItemFn>(GetFirstItemRva);
    GetNextItem = At<GetNextItemFn>(GetNextItemRva);
    if (!InstallHook()) return false;

    if (!context->RegisterConsoleCommand(
            "enhanced-damage-min-max-fix",
            Status,
            "Show restored off-weapon Enhanced Damage counters."
        )) {
        context->LogWarn("EnhancedDamageMinMaxFix: status command could not be registered.");
    }
    context->LogInfo("EnhancedDamageMinMaxFix 1.0.0 active for D2R 3.2.92777.");
    return true;
}

D2RL_PLUGIN_EXPORT void D2RLoaderUnloadPlugin() noexcept {
    Context = nullptr;
}
