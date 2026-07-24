#define NOMINMAX
#include <D2RLPlugin/api.h>
#include <nlohmann/json.hpp>

#include "larzuk_policy.hpp"

#include <Windows.h>
#include <intrin.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <initializer_list>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace {
using tcp::larzuk::DifficultyCount;
using tcp::larzuk::EffectiveLegalMaximum;
using tcp::larzuk::FindRule;
using tcp::larzuk::HasRules;
using tcp::larzuk::IsValidRule;
using tcp::larzuk::QualityCount;
using tcp::larzuk::ResolveSockets;
using tcp::larzuk::RuleMatrix;
using tcp::larzuk::SocketRule;

constexpr std::uint32_t SupportedBuild = 92777;
constexpr std::uintptr_t AddSocketsRva = 0x375560;
constexpr std::uintptr_t GetItemSeedRva = 0x36CC80;
constexpr std::uintptr_t GetItemQualityRva = 0x36CF60;
constexpr std::uintptr_t SetItemFlagRva = 0x36D8F0;
constexpr std::uintptr_t GetMaxSocketsRva = 0x36EAD0;
constexpr std::uintptr_t GetClassIdRva = 0x349860;
constexpr std::uintptr_t GetItemDataContextRva = 0x34A0E0;
constexpr std::uintptr_t GetItemsTxtRecordRva = 0x314110;
constexpr std::uintptr_t GetStatRva = 0x2F5020;
constexpr std::uintptr_t SetUnitStatRva = 0x2F7D10;
constexpr std::uintptr_t LarzukAddSocketsReturnRva = 0x4FD580;
constexpr std::size_t LarzukCallerGameOffset = 0x60;
constexpr std::size_t GameDifficultyOffset = 0x104;
constexpr std::size_t ItemsInventoryWidthOffset = 0x11E;
constexpr std::size_t ItemsInventoryHeightOffset = 0x11F;
constexpr std::uint32_t SocketedItemFlag = 0x800;
constexpr std::int32_t NumberOfSocketsStat = 0xC2;
constexpr wchar_t ConfigFileName[] = L"LarzukSockets.json";

constexpr std::array<std::string_view, DifficultyCount> DifficultyNames{
    "normal", "nightmare", "hell"
};
constexpr std::array<std::string_view, QualityCount> QualityNames{
    "magic", "rare", "set", "unique", "crafted"
};

struct Config {
    RuleMatrix rules{};
    bool diagnostics{};
};

struct ItemSeed {
    std::uint32_t low{};
    std::uint32_t high{};
};

using AddSocketsFn = void(__fastcall*)(void*, std::int32_t) noexcept;
using GetItemSeedFn = ItemSeed*(__fastcall*)(void*) noexcept;
using GetItemQualityFn = std::int32_t(__fastcall*)(void*) noexcept;
using SetItemFlagFn = void(__fastcall*)(void*, std::uint32_t, std::int32_t) noexcept;
using GetMaxSocketsFn = std::uint8_t(__fastcall*)(void*) noexcept;
using GetClassIdFn = std::uint32_t(__fastcall*)(void*, const char*, int) noexcept;
using GetItemDataContextFn = std::uint8_t(__fastcall*)(void*) noexcept;
using GetItemsTxtRecordFn = std::uint8_t*(__fastcall*)(std::uint8_t, std::int32_t) noexcept;
using GetStatFn = std::int32_t(__fastcall*)(void*, std::int32_t, std::uint32_t) noexcept;
using SetUnitStatFn = void(__fastcall*)(void*, std::int32_t, std::int32_t, std::uint32_t) noexcept;

const D2RL::PluginContext* Context{};
std::uint8_t* Base{};
Config Settings{};
std::string LoadedConfigPath{"built-in vanilla fallback"};
AddSocketsFn OriginalAddSockets{};
GetItemSeedFn GetItemSeed{};
GetItemQualityFn GetItemQuality{};
SetItemFlagFn SetItemFlag{};
GetMaxSocketsFn GetMaxSockets{};
GetClassIdFn GetClassId{};
GetItemDataContextFn GetItemDataContext{};
GetItemsTxtRecordFn GetItemsTxtRecord{};
GetStatFn GetStat{};
SetUnitStatFn SetUnitStat{};
std::atomic<std::uint64_t> ConfiguredRewards{};

constexpr D2RL::PluginInfo Info{
    .infoSize = D2RL::PluginInfoSize,
    .apiVersion = D2RL_PLUGIN_API_VERSION,
    .id = "larzuk-sockets",
    .name = "Larzuk Sockets",
    .version = "0.1.0",
    .author = "RuffnecKk",
    .description = "Configures Larzuk socket rewards by difficulty and item quality.",
    .flags = D2RL::PluginFlags::NativeHooks,
};

template<class T>
T At(std::uintptr_t rva) noexcept {
    return reinterpret_cast<T>(Base + rva);
}

std::vector<std::filesystem::path> ConfigCandidates() {
    std::vector<std::filesystem::path> candidates;
    if (Context && Context->modDirectory && Context->modDirectory[0] != L'\0') {
        candidates.emplace_back(std::filesystem::path(Context->modDirectory) / ConfigFileName);
    }
    candidates.emplace_back(ConfigFileName);
    return candidates;
}

void RequireAllowedKeys(
    const nlohmann::json& object,
    std::initializer_list<std::string_view> allowed,
    std::string_view context
) {
    for (const auto& [key, value] : object.items()) {
        (void)value;
        const auto found = std::find(allowed.begin(), allowed.end(), std::string_view(key));
        if (found == allowed.end()) {
            throw std::runtime_error(
                std::string(context) + " contains unknown key '" + key + "'"
            );
        }
    }
}

SocketRule ParseRule(const nlohmann::json& value, std::string_view path) {
    if (!value.is_object()) {
        throw std::runtime_error(std::string(path) + " must be an object or null");
    }
    RequireAllowedKeys(value, {"minSockets", "maxSockets"}, path);
    if (!value.contains("minSockets") || !value.contains("maxSockets")) {
        throw std::runtime_error(
            std::string(path) + " must define both minSockets and maxSockets"
        );
    }
    if (!value["minSockets"].is_number_integer()
        || !value["maxSockets"].is_number_integer()) {
        throw std::runtime_error(
            std::string(path) + " bounds must be integers from 1 through 6"
        );
    }
    const auto minimum = value["minSockets"].get<std::int32_t>();
    const auto maximum = value["maxSockets"].get<std::int32_t>();
    const SocketRule rule{
        static_cast<std::uint8_t>(minimum),
        static_cast<std::uint8_t>(maximum),
    };
    if (minimum < 1 || maximum > 6 || !IsValidRule(rule)) {
        throw std::runtime_error(
            std::string(path) + " requires 1 <= minSockets <= maxSockets <= 6"
        );
    }
    return rule;
}

void ParseConfig(const nlohmann::json& root) {
    if (!root.is_object()) {
        throw std::runtime_error("configuration root must be an object");
    }
    RequireAllowedKeys(
        root,
        {"normal", "nightmare", "hell", "diagnostics"},
        "configuration root"
    );

    Config parsed{};
    if (root.contains("diagnostics")) {
        if (!root["diagnostics"].is_boolean()) {
            throw std::runtime_error("diagnostics must be true or false");
        }
        parsed.diagnostics = root["diagnostics"].get<bool>();
    }

    for (std::size_t difficulty = 0; difficulty < DifficultyNames.size(); ++difficulty) {
        const auto difficultyName = DifficultyNames[difficulty];
        if (!root.contains(difficultyName)) continue;
        const auto& difficultyConfig = root[difficultyName];
        if (!difficultyConfig.is_object()) {
            throw std::runtime_error(std::string(difficultyName) + " must be an object");
        }
        RequireAllowedKeys(
            difficultyConfig,
            {"magic", "rare", "set", "unique", "crafted"},
            difficultyName
        );

        for (std::size_t quality = 0; quality < QualityNames.size(); ++quality) {
            const auto qualityName = QualityNames[quality];
            if (!difficultyConfig.contains(qualityName)
                || difficultyConfig[qualityName].is_null()) {
                continue;
            }
            parsed.rules[difficulty][quality] = ParseRule(
                difficultyConfig[qualityName],
                std::string(difficultyName) + "." + std::string(qualityName)
            );
        }
    }
    Settings = parsed;
}

bool LoadConfig() noexcept {
    Settings = {};
    LoadedConfigPath = "built-in vanilla fallback";
    for (const auto& path : ConfigCandidates()) {
        std::error_code error;
        if (!std::filesystem::is_regular_file(path, error)) continue;

        try {
            std::ifstream input(path);
            if (!input.is_open()) {
                throw std::runtime_error("file could not be opened");
            }
            const auto root = nlohmann::json::parse(input, nullptr, true, true);
            ParseConfig(root);
            LoadedConfigPath = path.string();
            return true;
        } catch (const std::exception& exception) {
            if (Context) {
                const auto message = std::string("LarzukSockets: invalid ")
                    + path.string() + " (" + exception.what() + ").";
                Context->LogError(message.c_str());
            }
            return false;
        }
    }
    return true;
}

std::uint32_t AdvanceItemRng(ItemSeed* seed) noexcept {
    const auto next = static_cast<std::uint64_t>(seed->low) * 0x6AC690C5ULL + seed->high;
    seed->low = static_cast<std::uint32_t>(next);
    seed->high = static_cast<std::uint32_t>(next >> 32);
    return seed->low;
}

void* LarzukCallerGame() noexcept {
    void* game{};
    const auto* returnSlot = reinterpret_cast<const std::uint8_t*>(_AddressOfReturnAddress());
    std::memcpy(&game, returnSlot + LarzukCallerGameOffset, sizeof(game));
    return game;
}

std::uint8_t LegalMaximum(void* item) noexcept {
    const auto classId = GetClassId(item, nullptr, 0);
    const auto dataContext = GetItemDataContext(item);
    const auto* itemsRecord = GetItemsTxtRecord(
        dataContext,
        static_cast<std::int32_t>(classId)
    );
    if (!itemsRecord) return 0;
    return EffectiveLegalMaximum(
        GetMaxSockets(item),
        itemsRecord[ItemsInventoryWidthOffset],
        itemsRecord[ItemsInventoryHeightOffset]
    );
}

__declspec(noinline) void __fastcall HookAddSockets(
    void* item,
    std::int32_t vanillaSockets
) noexcept {
    const auto returnRva = reinterpret_cast<std::uintptr_t>(_ReturnAddress())
        - reinterpret_cast<std::uintptr_t>(Base);
    if (returnRva != LarzukAddSocketsReturnRva || !item) {
        OriginalAddSockets(item, vanillaSockets);
        return;
    }

    void* game = LarzukCallerGame();
    if (!game || GetStat(item, NumberOfSocketsStat, 0) > 0) {
        OriginalAddSockets(item, vanillaSockets);
        return;
    }
    const auto difficulty = *(reinterpret_cast<const std::uint8_t*>(game) + GameDifficultyOffset);
    const auto quality = GetItemQuality(item);
    const auto* configured = FindRule(Settings.rules, difficulty, quality);
    if (!configured || !configured->has_value()) {
        OriginalAddSockets(item, vanillaSockets);
        return;
    }

    const auto legalMaximum = LegalMaximum(item);
    if (legalMaximum == 0) {
        OriginalAddSockets(item, vanillaSockets);
        return;
    }
    const auto rule = **configured;
    const auto clampedMinimum = std::min(rule.minSockets, legalMaximum);
    const auto clampedMaximum = std::min(rule.maxSockets, legalMaximum);
    std::uint32_t rawRoll{};
    if (clampedMinimum < clampedMaximum) {
        auto* seed = GetItemSeed(item);
        if (!seed) {
            OriginalAddSockets(item, vanillaSockets);
            return;
        }
        rawRoll = AdvanceItemRng(seed);
    }
    const auto sockets = ResolveSockets(rule, legalMaximum, rawRoll);
    if (sockets == 0) {
        OriginalAddSockets(item, vanillaSockets);
        return;
    }

    SetItemFlag(item, SocketedItemFlag, 1);
    SetUnitStat(item, NumberOfSocketsStat, sockets, 0);
    ++ConfiguredRewards;

    if (Settings.diagnostics && Context) {
        char message[256]{};
        std::snprintf(
            message,
            sizeof(message),
            "LarzukSockets: difficulty=%u quality=%d configured=%u-%u legalMax=%u result=%u.",
            static_cast<unsigned>(difficulty),
            quality,
            static_cast<unsigned>(rule.minSockets),
            static_cast<unsigned>(rule.maxSockets),
            static_cast<unsigned>(legalMaximum),
            static_cast<unsigned>(sockets)
        );
        Context->LogInfo(message);
    }
}

bool ValidateNativeSignatures() noexcept {
    constexpr std::array<std::uint8_t, 16> expectedGetStat{
        0x48, 0x89, 0x5C, 0x24, 0x10, 0x48, 0x89, 0x6C,
        0x24, 0x18, 0x48, 0x89, 0x74, 0x24, 0x20, 0x57
    };
    constexpr std::array<std::uint8_t, 16> expectedSetUnitStat{
        0x48, 0x89, 0x5C, 0x24, 0x10, 0x48, 0x89, 0x6C,
        0x24, 0x18, 0x56, 0x57, 0x41, 0x54, 0x41, 0x56
    };
    constexpr std::array<std::uint8_t, 16> expectedGetItemsTxtRecord{
        0x40, 0x57, 0x48, 0x83, 0xEC, 0x30, 0x8B, 0xFA,
        0xE8, 0x73, 0xC9, 0xFE, 0xFF, 0x3B, 0xB8, 0xA8
    };
    constexpr std::array<std::uint8_t, 16> expectedGetClassId{
        0x48, 0x83, 0xEC, 0x28, 0x48, 0x85, 0xC9, 0x75,
        0x1D, 0x88, 0x4C, 0x24, 0x30, 0x48, 0x8D, 0x4C
    };
    constexpr std::array<std::uint8_t, 16> expectedGetItemDataContext{
        0x48, 0x83, 0xEC, 0x28, 0x48, 0x85, 0xC9, 0x75,
        0x1A, 0x88, 0x4C, 0x24, 0x30, 0x48, 0x8D, 0x4C
    };
    constexpr std::array<std::uint8_t, 16> expectedGetItemSeed{
        0x40, 0x53, 0x48, 0x83, 0xEC, 0x20, 0x48, 0x8B,
        0xD9, 0x48, 0x85, 0xC9, 0x74, 0x0A, 0xE8, 0x3D
    };
    constexpr std::array<std::uint8_t, 16> expectedGetItemQuality{
        0x40, 0x53, 0x48, 0x83, 0xEC, 0x20, 0x48, 0x8B,
        0xD9, 0x48, 0x85, 0xC9, 0x74, 0x0A, 0xE8, 0x5D
    };
    constexpr std::array<std::uint8_t, 16> expectedSetItemFlag{
        0x48, 0x89, 0x5C, 0x24, 0x10, 0x48, 0x89, 0x74,
        0x24, 0x18, 0x57, 0x48, 0x83, 0xEC, 0x20, 0x41
    };
    constexpr std::array<std::uint8_t, 16> expectedGetMaxSockets{
        0x48, 0x89, 0x5C, 0x24, 0x10, 0x48, 0x89, 0x74,
        0x24, 0x18, 0x57, 0x48, 0x83, 0xEC, 0x20, 0x48
    };

    const auto valid = Context->CheckExpectedBytes(
            GetStatRva, expectedGetStat.data(), expectedGetStat.size())
        && Context->CheckExpectedBytes(
            SetUnitStatRva, expectedSetUnitStat.data(), expectedSetUnitStat.size())
        && Context->CheckExpectedBytes(
            GetItemsTxtRecordRva,
            expectedGetItemsTxtRecord.data(),
            expectedGetItemsTxtRecord.size())
        && Context->CheckExpectedBytes(
            GetClassIdRva, expectedGetClassId.data(), expectedGetClassId.size())
        && Context->CheckExpectedBytes(
            GetItemDataContextRva,
            expectedGetItemDataContext.data(),
            expectedGetItemDataContext.size())
        && Context->CheckExpectedBytes(
            GetItemSeedRva, expectedGetItemSeed.data(), expectedGetItemSeed.size())
        && Context->CheckExpectedBytes(
            GetItemQualityRva,
            expectedGetItemQuality.data(),
            expectedGetItemQuality.size())
        && Context->CheckExpectedBytes(
            SetItemFlagRva, expectedSetItemFlag.data(), expectedSetItemFlag.size())
        && Context->CheckExpectedBytes(
            GetMaxSocketsRva,
            expectedGetMaxSockets.data(),
            expectedGetMaxSockets.size());
    if (!valid) {
        Context->LogError("LarzukSockets: native helper signature mismatch; plugin refused.");
    }
    return valid;
}

bool InstallHook() noexcept {
    constexpr std::array<std::uint8_t, 16> expectedAddSockets{
        0x40, 0x57, 0x41, 0x56, 0x48, 0x83, 0xEC, 0x28,
        0x44, 0x8B, 0xF2, 0x48, 0x8B, 0xF9, 0x48, 0x85
    };
    if (!Context->InstallInlineHook(
            AddSocketsRva,
            expectedAddSockets.data(),
            static_cast<std::uint32_t>(expectedAddSockets.size()),
            HookAddSockets,
            &OriginalAddSockets
        )) {
        Context->LogError("LarzukSockets: ITEMS_AddSockets signature mismatch; hook refused.");
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
        context->LogError("LarzukSockets: configuration could not be loaded.");
        return false;
    }
    if (context->modDataVersionBuild != 0
        && context->modDataVersionBuild != SupportedBuild) {
        context->LogError("LarzukSockets: only D2R build 92777 is supported.");
        return false;
    }

    if (HasRules(Settings.rules) && !ValidateNativeSignatures()) return false;

    GetItemSeed = At<GetItemSeedFn>(GetItemSeedRva);
    GetItemQuality = At<GetItemQualityFn>(GetItemQualityRva);
    SetItemFlag = At<SetItemFlagFn>(SetItemFlagRva);
    GetMaxSockets = At<GetMaxSocketsFn>(GetMaxSocketsRva);
    GetClassId = At<GetClassIdFn>(GetClassIdRva);
    GetItemDataContext = At<GetItemDataContextFn>(GetItemDataContextRva);
    GetItemsTxtRecord = At<GetItemsTxtRecordFn>(GetItemsTxtRecordRva);
    GetStat = At<GetStatFn>(GetStatRva);
    SetUnitStat = At<SetUnitStatFn>(SetUnitStatRva);

    if (HasRules(Settings.rules) && !InstallHook()) return false;

    const auto message = std::string("LarzukSockets 0.1.0 loaded from ")
        + LoadedConfigPath
        + (HasRules(Settings.rules)
            ? " (configured Larzuk hook active)."
            : " (all rules use vanilla behavior; hook not installed).");
    context->LogInfo(message.c_str());
    return true;
}

D2RL_PLUGIN_EXPORT void D2RLoaderUnloadPlugin() noexcept {
    Context = nullptr;
}
