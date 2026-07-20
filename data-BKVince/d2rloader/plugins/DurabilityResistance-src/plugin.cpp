#define NOMINMAX
#include <D2RLPlugin/api.h>
#include "durability_policy.hpp"

#include <Windows.h>
#include <intrin.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <cctype>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <string_view>

namespace {
using tcp::durability::ClampEtherealMaxPercent;
using tcp::durability::ClampResistance;
using tcp::durability::EffectiveChanceBasisPoints;
using tcp::durability::EncodeEtherealMaximumTarget;
using tcp::durability::EncodeForVanillaEtherealHalving;
using tcp::durability::IsBowOrCrossbowItemTypeCode;
using tcp::durability::PreventsLoss;

constexpr std::uint32_t SupportedBuild = 92777;
constexpr std::uintptr_t UpdateDurabilityRva = 0x441B10;
constexpr std::uintptr_t GetBaseStatRva = 0x2F48C0;
constexpr std::uintptr_t GetDataTablesRva = 0x300A90;
constexpr std::uintptr_t GetItemsTxtRecordRva = 0x314110;
constexpr std::uintptr_t UnitSeedRva = 0x34A1E0;
constexpr std::uintptr_t RandomRva = 0x153B00;
constexpr std::uintptr_t CheckItemFlagRva = 0x36E2D0;
constexpr std::uintptr_t EtherealMaximumReturnRva = 0x44351F;
constexpr std::uint32_t EtherealItemFlag = 0x00400000;
constexpr std::int32_t MaxDurabilityStat = 73;
constexpr std::uintptr_t ItemsNoDurabilityOffset = 0x122;
constexpr std::uintptr_t ItemsPrimaryTypeOffset = 0x12E;
constexpr std::uintptr_t ItemTypesRecordsOffset = 0x1348;
constexpr std::uintptr_t ItemTypesCountOffset = 0x1350;
constexpr std::uintptr_t ItemTypesRepairOffset = 0x08;
constexpr std::size_t ItemTypesRecordStride = 0xE8;
constexpr std::size_t ItemTypesCodeOffset = 0x00;
constexpr std::size_t ItemTypesEquivalentOneOffset = 0x04;
constexpr std::size_t ItemTypesEquivalentTwoOffset = 0x06;

constexpr char DefaultConfig[] = R"toml(# Durability resistance
# Values are percentages and take effect after a cold start.

[durability_loss]
enabled = true
# 0 = vanilla frequency; 50 = half as frequent; 100 = no durability loss.
normal_resistance_percent = 50
ethereal_resistance_percent = 50

[ethereal]
# Below 100, the vanilla-style +1 is preserved after scaling.
# 25/50/75/100/200 on a normal maximum of 20 produce 6/11/16/20/40.
# Range: 1..200. Final durability is always capped at 255.
max_durability_percent = 50
# true ignores the percentage and forces 255 points,
# D2R's absolute maximum item durability.
force_maximum_durability = false

[ranged_weapons]
# false = vanilla: bows and crossbows do not use durability.
# true = bows, crossbows, and Amazon bows use their existing weapons.txt
# durability values (20..55) and can be repaired. This also makes them eligible
# to become ethereal unless another rule excludes their item type.
bows_and_crossbows_have_durability = false

[diagnostics]
enabled = false
)toml";

struct Config {
    bool enabled{true};
    bool diagnostics{};
    std::uint32_t normalResistance{50};
    std::uint32_t etherealResistance{50};
    std::uint32_t etherealMaxPercent{50};
    bool forceMaximumDurability{};
    bool bowsAndCrossbowsHaveDurability{};
};

using UpdateDurabilityFn = void(__fastcall*)(void*, void*, void*) noexcept;
using GetBaseStatFn = std::int32_t(__fastcall*)(void*, std::int32_t, std::uint16_t) noexcept;
using GetDataTablesFn = std::uint8_t*(__fastcall*)(std::uint8_t) noexcept;
using GetItemsTxtRecordFn = std::uint8_t*(__fastcall*)(std::uint8_t, std::int32_t) noexcept;
using UnitSeedFn = void*(__fastcall*)(void*);
using RandomFn = std::uint32_t(__fastcall*)(void*, std::int32_t);
using CheckItemFlagFn = std::int32_t(__fastcall*)(void*, std::uint32_t, std::int32_t, const char*);

const D2RL::PluginContext* Context{};
std::uint8_t* Base{};
Config Settings{};
UpdateDurabilityFn OriginalUpdateDurability{};
GetBaseStatFn OriginalGetBaseStat{};
GetDataTablesFn GetDataTables{};
GetItemsTxtRecordFn OriginalGetItemsTxtRecord{};
UnitSeedFn GetUnitSeed{};
RandomFn RollRandom{};
CheckItemFlagFn CheckItemFlag{};
std::atomic<std::uint64_t> PreventedNormal{};
std::atomic<std::uint64_t> PreventedEthereal{};
std::atomic<std::uint64_t> RangedWeaponRecordsEnabled{};
std::atomic<std::uint64_t> RepairTypeRecordsEnabled{};

constexpr D2RL::PluginInfo Info{
    .infoSize = D2RL::PluginInfoSize,
    .apiVersion = D2RL_PLUGIN_API_VERSION,
    .id = "durability-resistance",
    .name = "Durability Resistance",
    .version = "1.2.0",
    .author = "RuffnecKk",
    .description = "Configurable durability resistance, ethereal maximum durability, and optional bow/crossbow durability for D2R 3.2.92777.",
    .flags = D2RL::PluginFlags::NativeHooks,
};

template<class T>
T At(std::uintptr_t rva) noexcept {
    return reinterpret_cast<T>(Base + rva);
}

std::string Trim(std::string text) {
    const auto first = text.find_first_not_of(" \t\r\n");
    if (first == std::string::npos) return {};
    const auto last = text.find_last_not_of(" \t\r\n");
    return text.substr(first, last - first + 1);
}

bool ParseBool(std::string_view value, bool fallback) noexcept {
    if (value == "true") return true;
    if (value == "false") return false;
    return fallback;
}

std::uint32_t ParseUnsigned(std::string_view value, std::uint32_t fallback) noexcept {
    try {
        std::size_t consumed{};
        const auto parsed = std::stoul(std::string(value), &consumed, 10);
        return consumed == value.size() ? static_cast<std::uint32_t>(parsed) : fallback;
    } catch (...) {
        return fallback;
    }
}

bool LoadConfig() noexcept {
    if (!Context->EnsureConfig(DefaultConfig)) return false;

    std::array<char, 4096> buffer{};
    std::uint32_t requiredSize{};
    if (!Context->ReadConfig(buffer.data(), static_cast<std::uint32_t>(buffer.size()), &requiredSize)) {
        return false;
    }

    Settings = {};
    const std::string input(buffer.data());
    std::string section;
    std::size_t start{};
    while (start < input.size()) {
        const auto end = input.find('\n', start);
        auto line = Trim(input.substr(start, end - start));
        start = end == std::string::npos ? input.size() : end + 1;
        if (const auto comment = line.find('#'); comment != std::string::npos) {
            line = Trim(line.substr(0, comment));
        }
        if (line.empty()) continue;
        if (line.front() == '[' && line.back() == ']') {
            section = line.substr(1, line.size() - 2);
            continue;
        }
        const auto equal = line.find('=');
        if (equal == std::string::npos) continue;
        const auto key = Trim(line.substr(0, equal));
        const auto value = Trim(line.substr(equal + 1));

        if (section == "durability_loss") {
            if (key == "enabled") Settings.enabled = ParseBool(value, Settings.enabled);
            else if (key == "normal_resistance_percent") {
                Settings.normalResistance = ClampResistance(ParseUnsigned(value, Settings.normalResistance));
            } else if (key == "ethereal_resistance_percent") {
                Settings.etherealResistance = ClampResistance(ParseUnsigned(value, Settings.etherealResistance));
            }
        } else if (section == "ethereal" && key == "max_durability_percent") {
            Settings.etherealMaxPercent = ClampEtherealMaxPercent(ParseUnsigned(value, Settings.etherealMaxPercent));
        } else if (section == "ethereal" && key == "force_maximum_durability") {
            Settings.forceMaximumDurability = ParseBool(value, Settings.forceMaximumDurability);
        } else if (section == "ranged_weapons" && key == "bows_and_crossbows_have_durability") {
            Settings.bowsAndCrossbowsHaveDurability = ParseBool(
                value,
                Settings.bowsAndCrossbowsHaveDurability
            );
        } else if (section == "diagnostics" && key == "enabled") {
            Settings.diagnostics = ParseBool(value, Settings.diagnostics);
        }
    }
    return true;
}

bool IsEtherealItem(void* item) noexcept {
    return item && CheckItemFlag(item, EtherealItemFlag, __LINE__, "DurabilityResistance") != 0;
}

bool IsBowOrCrossbowItemType(
    const std::uint8_t* records,
    std::uint64_t count,
    std::uint16_t itemType
) noexcept {
    if (!records || count == 0 || count > 4096 || itemType >= count) return false;

    std::array<std::uint16_t, 16> pending{};
    std::size_t pendingCount{1};
    pending[0] = itemType;
    for (std::size_t visited = 0; pendingCount != 0 && visited < pending.size(); ++visited) {
        const auto current = pending[--pendingCount];
        if (current >= count) continue;
        const auto* record = records + static_cast<std::size_t>(current) * ItemTypesRecordStride;
        std::uint32_t code{};
        std::memcpy(&code, record + ItemTypesCodeOffset, sizeof(code));
        if (IsBowOrCrossbowItemTypeCode(code)) return true;

        const auto equivalentOne = *reinterpret_cast<const std::uint16_t*>(
            record + ItemTypesEquivalentOneOffset
        );
        const auto equivalentTwo = *reinterpret_cast<const std::uint16_t*>(
            record + ItemTypesEquivalentTwoOffset
        );
        if (equivalentOne < count && equivalentOne != current && pendingCount < pending.size()) {
            pending[pendingCount++] = equivalentOne;
        }
        if (equivalentTwo < count && equivalentTwo != current && pendingCount < pending.size()) {
            pending[pendingCount++] = equivalentTwo;
        }
    }
    return false;
}

void EnableRepairForItemType(
    std::uint8_t* records,
    std::uint64_t count,
    std::uint16_t itemType
) noexcept {
    if (!records || itemType >= count) return;
    auto& repair = records[static_cast<std::size_t>(itemType) * ItemTypesRecordStride
        + ItemTypesRepairOffset];
    if (repair == 0) {
        repair = 1;
        RepairTypeRecordsEnabled.fetch_add(1, std::memory_order_relaxed);
    }
}

std::uint8_t* __fastcall HookGetItemsTxtRecord(
    std::uint8_t context,
    std::int32_t classId
) noexcept {
    auto* record = OriginalGetItemsTxtRecord(context, classId);
    if (!Settings.bowsAndCrossbowsHaveDurability || !record) return record;

    const auto itemType = *reinterpret_cast<const std::uint16_t*>(record + ItemsPrimaryTypeOffset);
    auto* dataTables = GetDataTables ? GetDataTables(context) : nullptr;
    if (!dataTables) return record;
    auto* itemTypeRecords = *reinterpret_cast<std::uint8_t**>(dataTables + ItemTypesRecordsOffset);
    const auto itemTypeCount = *reinterpret_cast<const std::uint64_t*>(dataTables + ItemTypesCountOffset);
    if (!IsBowOrCrossbowItemType(itemTypeRecords, itemTypeCount, itemType)) return record;

    auto& noDurability = record[ItemsNoDurabilityOffset];
    if (noDurability != 0) {
        noDurability = 0;
        RangedWeaponRecordsEnabled.fetch_add(1, std::memory_order_relaxed);
    }
    EnableRepairForItemType(itemTypeRecords, itemTypeCount, itemType);
    return record;
}

void __fastcall HookUpdateDurability(void* game, void* unit, void* item) noexcept {
    if (!Settings.enabled || !unit || !item) {
        OriginalUpdateDurability(game, unit, item);
        return;
    }

    const bool ethereal = IsEtherealItem(item);
    const auto resistance = ethereal ? Settings.etherealResistance : Settings.normalResistance;
    if (resistance == 0) {
        OriginalUpdateDurability(game, unit, item);
        return;
    }

    void* seed = GetUnitSeed(unit);
    if (!seed || !PreventsLoss(resistance, RollRandom(seed, 100))) {
        OriginalUpdateDurability(game, unit, item);
        return;
    }

    if (ethereal) ++PreventedEthereal;
    else ++PreventedNormal;
}

__declspec(noinline) std::int32_t __fastcall HookGetBaseStat(
    void* unit,
    std::int32_t stat,
    std::uint16_t layer
) noexcept {
    const auto returnAddress = reinterpret_cast<std::uintptr_t>(_ReturnAddress());
    const auto value = OriginalGetBaseStat(unit, stat, layer);
    if (returnAddress != reinterpret_cast<std::uintptr_t>(Base + EtherealMaximumReturnRva)
        || stat != MaxDurabilityStat) {
        return value;
    }
    if (Settings.forceMaximumDurability && value > 0) {
        return EncodeEtherealMaximumTarget(255);
    }
    return EncodeForVanillaEtherealHalving(value, Settings.etherealMaxPercent);
}

void FormatChance(char* output, std::size_t size, std::uint32_t basisPoints) noexcept {
    std::snprintf(output, size, "%u.%02u%%", basisPoints / 100, basisPoints % 100);
}

auto Status(
    D2R::Game::Client*,
    const D2RL::ConsoleCommandContext* command,
    void*
) noexcept -> D2RL::ConsoleCommandResult {
    if (!command || !command->plugin) return D2RL::ConsoleCommandResult::Failed;

    char normalWeapon[16]{}, normalArmor[16]{}, etherealWeapon[16]{}, etherealArmor[16]{};
    FormatChance(normalWeapon, sizeof(normalWeapon), EffectiveChanceBasisPoints(4, Settings.normalResistance));
    FormatChance(normalArmor, sizeof(normalArmor), EffectiveChanceBasisPoints(10, Settings.normalResistance));
    FormatChance(etherealWeapon, sizeof(etherealWeapon), EffectiveChanceBasisPoints(4, Settings.etherealResistance));
    FormatChance(etherealArmor, sizeof(etherealArmor), EffectiveChanceBasisPoints(10, Settings.etherealResistance));

    char message[512]{};
    std::snprintf(
        message,
        sizeof(message),
        "DurabilityResistance 1.2.0: normal resistance %u%% (weapon %s, armor %s); ethereal resistance %u%% (weapon %s, armor %s); ethereal max %u%s; bow/crossbow durability %s (item records=%llu, repair types=%llu); prevented normal=%llu ethereal=%llu.",
        Settings.normalResistance,
        normalWeapon,
        normalArmor,
        Settings.etherealResistance,
        etherealWeapon,
        etherealArmor,
        Settings.forceMaximumDurability ? 255u : Settings.etherealMaxPercent,
        Settings.forceMaximumDurability ? " points (forced maximum)" : "%",
        Settings.bowsAndCrossbowsHaveDurability ? "enabled" : "disabled",
        static_cast<unsigned long long>(RangedWeaponRecordsEnabled.load(std::memory_order_relaxed)),
        static_cast<unsigned long long>(RepairTypeRecordsEnabled.load(std::memory_order_relaxed)),
        static_cast<unsigned long long>(PreventedNormal.load()),
        static_cast<unsigned long long>(PreventedEthereal.load())
    );
    command->plugin->WriteConsoleMessage(message);
    return D2RL::ConsoleCommandResult::Handled;
}

bool InstallHooks() noexcept {
    constexpr std::array<std::uint8_t, 12> expectedUpdate{
        0x48, 0x89, 0x6C, 0x24, 0x10, 0x56, 0x57, 0x41, 0x54, 0x41, 0x56, 0x41
    };
    if (!Context->InstallInlineHook(
            UpdateDurabilityRva,
            expectedUpdate.data(),
            static_cast<std::uint32_t>(expectedUpdate.size()),
            HookUpdateDurability,
            &OriginalUpdateDurability
        )) {
        Context->LogError("DurabilityResistance: durability-update signature mismatch; hook refused.");
        return false;
    }

    constexpr std::array<std::uint8_t, 15> expectedGetBaseStat{
        0x48, 0x89, 0x5C, 0x24, 0x10, 0x48, 0x89, 0x6C, 0x24, 0x18,
        0x48, 0x89, 0x74, 0x24, 0x20
    };
    if (!Context->InstallInlineHook(
            GetBaseStatRva,
            expectedGetBaseStat.data(),
            static_cast<std::uint32_t>(expectedGetBaseStat.size()),
            HookGetBaseStat,
            &OriginalGetBaseStat
        )) {
        Context->LogError("DurabilityResistance: ethereal base-stat signature mismatch; hook refused.");
        return false;
    }

    if (Settings.bowsAndCrossbowsHaveDurability) {
        constexpr std::array<std::uint8_t, 15> expectedGetItemsTxtRecord{
            0x40, 0x57, 0x48, 0x83, 0xEC, 0x30, 0x8B, 0xFA,
            0xE8, 0x73, 0xC9, 0xFE, 0xFF, 0x3B, 0xB8
        };
        if (!Context->InstallInlineHook(
                GetItemsTxtRecordRva,
                expectedGetItemsTxtRecord.data(),
                static_cast<std::uint32_t>(expectedGetItemsTxtRecord.size()),
                HookGetItemsTxtRecord,
                &OriginalGetItemsTxtRecord
            )) {
            Context->LogError("DurabilityResistance: items-table signature mismatch; ranged durability hook refused.");
            return false;
        }
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
    if (!Base || !LoadConfig()) {
        context->LogError("DurabilityResistance: configuration could not be loaded.");
        return false;
    }
    if (context->modDataVersionBuild != 0 && context->modDataVersionBuild != SupportedBuild) {
        context->LogError("DurabilityResistance: only D2R build 92777 is supported.");
        return false;
    }

    GetUnitSeed = At<UnitSeedFn>(UnitSeedRva);
    RollRandom = At<RandomFn>(RandomRva);
    CheckItemFlag = At<CheckItemFlagFn>(CheckItemFlagRva);
    GetDataTables = At<GetDataTablesFn>(GetDataTablesRva);
    if (!InstallHooks()) return false;

    if (!context->RegisterConsoleCommand(
            "durability-resistance",
            Status,
            "Show normal/ethereal durability settings and prevented-loss counters."
        )) {
        context->LogWarn("DurabilityResistance: status command could not be registered.");
    }
    context->LogInfo("DurabilityResistance 1.2.0 active for D2R 3.2.92777 (global/mod-local hybrid; resistance, ethereal maximum, and optional bow/crossbow durability).");
    return true;
}

D2RL_PLUGIN_EXPORT void D2RLoaderUnloadPlugin() noexcept {
    Context = nullptr;
}
