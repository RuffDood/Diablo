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
#include <string>
#include <string_view>

namespace {
using tcp::durability::ClampEtherealMaxPercent;
using tcp::durability::ClampResistance;
using tcp::durability::EffectiveChanceBasisPoints;
using tcp::durability::EncodeForVanillaEtherealHalving;
using tcp::durability::PreventsLoss;

constexpr std::uint32_t SupportedBuild = 92777;
constexpr std::uintptr_t UpdateDurabilityRva = 0x441B10;
constexpr std::uintptr_t GetBaseStatRva = 0x2F48C0;
constexpr std::uintptr_t UnitSeedRva = 0x34A1E0;
constexpr std::uintptr_t RandomRva = 0x153B00;
constexpr std::uintptr_t CheckItemFlagRva = 0x36E2D0;
constexpr std::uintptr_t IsThrowableRva = 0x374710;
constexpr std::uintptr_t EtherealMaximumReturnRva = 0x44351F;
constexpr std::uint32_t EtherealItemFlag = 0x00400000;
constexpr std::int32_t MaxDurabilityStat = 73;

constexpr char DefaultConfig[] = R"toml(# BKVince durability resistance
# Values are percentages and take effect after a cold start.

[durability_loss]
enabled = true
# 0 = vanilla frequency; 50 = half as frequent; 100 = no durability loss.
normal_resistance_percent = 50
ethereal_resistance_percent = 50

[ethereal]
# Vanilla is 50 and uses floor(normal / 2) + 1. Range: 1..100.
max_durability_percent = 50

[diagnostics]
enabled = false
)toml";

struct Config {
    bool enabled{true};
    bool diagnostics{};
    std::uint32_t normalResistance{50};
    std::uint32_t etherealResistance{50};
    std::uint32_t etherealMaxPercent{50};
};

using UpdateDurabilityFn = void(__fastcall*)(void*, void*, void*) noexcept;
using GetBaseStatFn = std::int32_t(__fastcall*)(void*, std::int32_t, std::uint16_t) noexcept;
using UnitSeedFn = void*(__fastcall*)(void*);
using RandomFn = std::uint32_t(__fastcall*)(void*, std::int32_t);
using CheckItemFlagFn = std::int32_t(__fastcall*)(void*, std::uint32_t, std::int32_t, const char*);
using IsThrowableFn = std::int32_t(__fastcall*)(void*);

const D2RL::PluginContext* Context{};
std::uint8_t* Base{};
Config Settings{};
UpdateDurabilityFn OriginalUpdateDurability{};
GetBaseStatFn OriginalGetBaseStat{};
UnitSeedFn GetUnitSeed{};
RandomFn RollRandom{};
CheckItemFlagFn CheckItemFlag{};
IsThrowableFn IsThrowable{};
std::atomic<std::uint64_t> PreventedNormal{};
std::atomic<std::uint64_t> PreventedEthereal{};

constexpr D2RL::PluginInfo Info{
    .infoSize = D2RL::PluginInfoSize,
    .apiVersion = D2RL_PLUGIN_API_VERSION,
    .id = "durability-resistance",
    .name = "Durability Resistance",
    .version = "1.0.0",
    .author = "TCP",
    .description = "Separate normal/ethereal durability-loss resistance and configurable ethereal maximum durability for D2R 3.2.92777.",
    .flags = D2RL::PluginFlags::ModScopedOnly | D2RL::PluginFlags::NativeHooks,
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
        } else if (section == "diagnostics" && key == "enabled") {
            Settings.diagnostics = ParseBool(value, Settings.diagnostics);
        }
    }
    return true;
}

bool IsEtherealItem(void* item) noexcept {
    return item && CheckItemFlag(item, EtherealItemFlag, __LINE__, "DurabilityResistance") != 0;
}

void __fastcall HookUpdateDurability(void* game, void* unit, void* item) noexcept {
    if (!Settings.enabled || !unit || !item || IsThrowable(item)) {
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
        "DurabilityResistance 1.0: normal resistance %u%% (weapon %s, armor %s); ethereal resistance %u%% (weapon %s, armor %s); ethereal max %u%%; prevented normal=%llu ethereal=%llu.",
        Settings.normalResistance,
        normalWeapon,
        normalArmor,
        Settings.etherealResistance,
        etherealWeapon,
        etherealArmor,
        Settings.etherealMaxPercent,
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
    IsThrowable = At<IsThrowableFn>(IsThrowableRva);
    if (!InstallHooks()) return false;

    if (!context->RegisterConsoleCommand(
            "durability-resistance",
            Status,
            "Show normal/ethereal durability settings and prevented-loss counters."
        )) {
        context->LogWarn("DurabilityResistance: status command could not be registered.");
    }
    context->LogInfo("DurabilityResistance 1.0 active for D2R 3.2.92777 (normal/ethereal loss resistance and ethereal maximum). ");
    return true;
}

D2RL_PLUGIN_EXPORT void D2RLoaderUnloadPlugin() noexcept {
    Context = nullptr;
}
