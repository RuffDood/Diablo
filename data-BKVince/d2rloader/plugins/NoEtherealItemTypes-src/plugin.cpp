#define NOMINMAX
#include <D2RLPlugin/api.h>
#include "item_type_policy.hpp"

#include <Windows.h>
#include <intrin.h>

#include <array>
#include <atomic>
#include <cctype>
#include <cstdint>
#include <cstdio>
#include <string>
#include <string_view>

namespace {
using tcp::no_ethereal::FindItemTypeId;
using tcp::no_ethereal::ItemTypeCode;
using tcp::no_ethereal::ItemTypeRecordStride;
using tcp::no_ethereal::MaxExcludedItemTypes;
using tcp::no_ethereal::NormalizeItemTypeCode;
using tcp::no_ethereal::SameCode;

constexpr std::uint32_t SupportedBuild = 92777;
constexpr std::uintptr_t CheckItemTypeRva = 0x373890;
constexpr std::uintptr_t GetItemContextRva = 0x34A0E0;
constexpr std::uintptr_t GetDataTablesRva = 0x300A90;
constexpr std::uintptr_t EtherealWeaponCheckReturnRva = 0x4432DA;
constexpr std::uintptr_t EtherealArmorCheckReturnRva = 0x4432E9;
constexpr std::uintptr_t ItemTypesRecordsOffset = 0x1348;
constexpr std::uintptr_t ItemTypesCountOffset = 0x1350;

constexpr char DefaultConfig[] = R"toml(# Item-type ethereal exclusions
# Item type codes come from the Code column of itemtypes.txt.
# Parent types use D2R's native inheritance: "armo" covers its child types.

[ethereal_exclusions]
enabled = true
item_types = []
)toml";

struct Config {
    bool enabled{true};
    std::array<ItemTypeCode, MaxExcludedItemTypes> itemTypes{};
    std::size_t itemTypeCount{};
};

struct ResolvedTypeCache {
    const void* dataTables{};
    const void* records{};
    std::uint64_t recordCount{};
    std::array<std::int32_t, MaxExcludedItemTypes> ids{};
    std::size_t idCount{};
    std::size_t unresolvedCount{};
};

using CheckItemTypeFn = std::int32_t(__fastcall*)(const void*, std::int32_t) noexcept;
using GetItemContextFn = std::uint8_t(__fastcall*)(const void*) noexcept;
using GetDataTablesFn = std::uint8_t*(__fastcall*)(std::uint8_t) noexcept;

const D2RL::PluginContext* Context{};
std::uint8_t* Base{};
Config Settings{};
CheckItemTypeFn OriginalCheckItemType{};
GetItemContextFn GetItemContext{};
GetDataTablesFn GetDataTables{};
std::atomic<std::uint64_t> ExcludedEligibleItems{};
std::atomic<std::uint32_t> ResolvedTypeCount{};
std::atomic<std::uint32_t> UnresolvedTypeCount{};
std::atomic_flag UnresolvedWarningLogged = ATOMIC_FLAG_INIT;
thread_local ResolvedTypeCache TypeCache{};
thread_local const void* PendingGateItem{};
thread_local bool PendingGateExcluded{};
thread_local bool PendingGateWasWeapon{};

constexpr D2RL::PluginInfo Info{
    .infoSize = D2RL::PluginInfoSize,
    .apiVersion = D2RL_PLUGIN_API_VERSION,
    .id = "no-ethereal-item-types",
    .name = "No Ethereal Item Types",
    .version = "1.1.0",
    .author = "RuffnecKk",
    .description = "Prevents configured itemtypes.txt families from ever becoming ethereal on D2R 3.2.92777.",
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

std::string StripComment(std::string line) {
    bool quoted{};
    for (std::size_t index = 0; index < line.size(); ++index) {
        if (line[index] == '"' && (index == 0 || line[index - 1] != '\\')) quoted = !quoted;
        if (line[index] == '#' && !quoted) return line.substr(0, index);
    }
    return line;
}

bool ParseBool(std::string_view value, bool& output) noexcept {
    if (value == "true") {
        output = true;
        return true;
    }
    if (value == "false") {
        output = false;
        return true;
    }
    return false;
}

bool AddConfiguredType(std::string_view value) noexcept {
    ItemTypeCode code{};
    if (!NormalizeItemTypeCode(value, code)) return false;
    for (std::size_t index = 0; index < Settings.itemTypeCount; ++index) {
        if (SameCode(Settings.itemTypes[index], code)) return true;
    }
    if (Settings.itemTypeCount >= Settings.itemTypes.size()) return false;
    Settings.itemTypes[Settings.itemTypeCount++] = code;
    return true;
}

bool ParseItemTypeArray(std::string_view value) noexcept {
    const auto open = value.find('[');
    const auto close = value.rfind(']');
    if (open == std::string_view::npos || close == std::string_view::npos || close < open) return false;

    auto index = open + 1;
    while (index < close) {
        while (index < close && (std::isspace(static_cast<unsigned char>(value[index])) || value[index] == ',')) {
            ++index;
        }
        if (index == close) break;
        if (value[index] != '"') return false;
        const auto end = value.find('"', index + 1);
        if (end == std::string_view::npos || end > close) return false;
        if (!AddConfiguredType(value.substr(index + 1, end - index - 1))) return false;
        index = end + 1;
        while (index < close && std::isspace(static_cast<unsigned char>(value[index]))) ++index;
        if (index < close && value[index] != ',') return false;
    }
    return Trim(std::string(value.substr(close + 1))).empty();
}

bool LoadConfig() noexcept {
    if (!Context->EnsureConfig(DefaultConfig)) return false;

    std::array<char, 8192> buffer{};
    std::uint32_t requiredSize{};
    if (!Context->ReadConfig(buffer.data(), static_cast<std::uint32_t>(buffer.size()), &requiredSize)) {
        return false;
    }

    Settings = {};
    const std::string input(buffer.data());
    std::string section;
    std::string itemTypeArray;
    bool collectingItemTypes{};
    bool foundItemTypes{};
    std::size_t start{};

    while (start < input.size()) {
        const auto end = input.find('\n', start);
        auto line = Trim(StripComment(input.substr(start, end - start)));
        start = end == std::string::npos ? input.size() : end + 1;
        if (line.empty()) continue;

        if (collectingItemTypes) {
            itemTypeArray += ' ';
            itemTypeArray += line;
            if (line.find(']') != std::string::npos) collectingItemTypes = false;
            continue;
        }
        if (line.front() == '[' && line.back() == ']') {
            section = line.substr(1, line.size() - 2);
            continue;
        }
        const auto equal = line.find('=');
        if (equal == std::string::npos || section != "ethereal_exclusions") continue;
        const auto key = Trim(line.substr(0, equal));
        const auto value = Trim(line.substr(equal + 1));
        if (key == "enabled") {
            if (!ParseBool(value, Settings.enabled)) return false;
        } else if (key == "item_types") {
            if (foundItemTypes) return false;
            foundItemTypes = true;
            itemTypeArray = value;
            collectingItemTypes = value.find(']') == std::string::npos;
        }
    }

    if (collectingItemTypes) return false;
    return !foundItemTypes || ParseItemTypeArray(itemTypeArray);
}

bool RefreshTypeCache(const void* item) noexcept {
    if (!item || !GetItemContext || !GetDataTables) return false;
    const auto context = GetItemContext(item);
    auto* dataTables = GetDataTables(context);
    if (!dataTables) return false;

    const auto* records = *reinterpret_cast<const std::uint8_t* const*>(dataTables + ItemTypesRecordsOffset);
    const auto recordCount = *reinterpret_cast<const std::uint64_t*>(dataTables + ItemTypesCountOffset);
    if (!records || recordCount == 0 || recordCount > 4096) return false;
    if (TypeCache.dataTables == dataTables && TypeCache.records == records
        && TypeCache.recordCount == recordCount) {
        return true;
    }

    TypeCache = {};
    TypeCache.dataTables = dataTables;
    TypeCache.records = records;
    TypeCache.recordCount = recordCount;
    for (std::size_t index = 0; index < Settings.itemTypeCount; ++index) {
        const auto id = FindItemTypeId(records, recordCount, ItemTypeRecordStride, Settings.itemTypes[index]);
        if (id < 0) {
            ++TypeCache.unresolvedCount;
            continue;
        }
        TypeCache.ids[TypeCache.idCount++] = id;
    }

    ResolvedTypeCount.store(static_cast<std::uint32_t>(TypeCache.idCount), std::memory_order_relaxed);
    UnresolvedTypeCount.store(static_cast<std::uint32_t>(TypeCache.unresolvedCount), std::memory_order_relaxed);
    if (TypeCache.unresolvedCount != 0 && !UnresolvedWarningLogged.test_and_set(std::memory_order_relaxed)) {
        Context->LogWarn("NoEtherealItemTypes: one or more configured item type codes do not exist in the active itemtypes table.");
    }
    return true;
}

bool IsExcluded(const void* item) noexcept {
    if (!Settings.enabled || Settings.itemTypeCount == 0 || !RefreshTypeCache(item)) return false;
    for (std::size_t index = 0; index < TypeCache.idCount; ++index) {
        if (OriginalCheckItemType(item, TypeCache.ids[index]) != 0) return true;
    }
    return false;
}

std::int32_t __fastcall HookCheckItemType(const void* item, std::int32_t itemType) noexcept {
    const auto result = OriginalCheckItemType(item, itemType);
    const auto returnRva = reinterpret_cast<std::uintptr_t>(_ReturnAddress())
        - reinterpret_cast<std::uintptr_t>(Base);

    if (returnRva == EtherealWeaponCheckReturnRva) {
        PendingGateItem = item;
        PendingGateExcluded = IsExcluded(item);
        PendingGateWasWeapon = result != 0;
        return PendingGateExcluded ? 0 : result;
    }
    if (returnRva == EtherealArmorCheckReturnRva) {
        const bool excluded = PendingGateItem == item ? PendingGateExcluded : IsExcluded(item);
        const bool wasEligible = (PendingGateItem == item && PendingGateWasWeapon) || result != 0;
        PendingGateItem = nullptr;
        PendingGateExcluded = false;
        PendingGateWasWeapon = false;
        if (excluded && wasEligible) {
            ExcludedEligibleItems.fetch_add(1, std::memory_order_relaxed);
            return 0;
        }
    }
    return result;
}

void FormatConfiguredTypes(char* output, std::size_t size) noexcept {
    if (!output || size == 0) return;
    std::size_t used{};
    for (std::size_t index = 0; index < Settings.itemTypeCount; ++index) {
        const auto written = std::snprintf(
            output + used,
            size - used,
            "%s%.*s",
            index == 0 ? "" : ",",
            static_cast<int>(Settings.itemTypes[index].length),
            Settings.itemTypes[index].text.data()
        );
        if (written < 0 || static_cast<std::size_t>(written) >= size - used) break;
        used += static_cast<std::size_t>(written);
    }
    if (Settings.itemTypeCount == 0) std::snprintf(output, size, "none");
}

auto Status(
    D2R::Game::Client*,
    const D2RL::ConsoleCommandContext* command,
    void*
) noexcept -> D2RL::ConsoleCommandResult {
    if (!command || !command->plugin) return D2RL::ConsoleCommandResult::Failed;
    char types[384]{};
    char message[768]{};
    FormatConfiguredTypes(types, sizeof(types));
    std::snprintf(
        message,
        sizeof(message),
        "NoEtherealItemTypes 1.1.0: %s; configured=[%s]; runtime resolved=%u unresolved=%u; excluded eligible generations=%llu.",
        Settings.enabled ? "enabled" : "disabled",
        types,
        ResolvedTypeCount.load(std::memory_order_relaxed),
        UnresolvedTypeCount.load(std::memory_order_relaxed),
        static_cast<unsigned long long>(ExcludedEligibleItems.load(std::memory_order_relaxed))
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
            CheckItemTypeRva,
            expected.data(),
            static_cast<std::uint32_t>(expected.size()),
            HookCheckItemType,
            &OriginalCheckItemType
        )) {
        Context->LogError("NoEtherealItemTypes: item-type-check signature mismatch; hook refused.");
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
        context->LogError("NoEtherealItemTypes: configuration could not be loaded or is invalid.");
        return false;
    }
    if (context->modDataVersionBuild != 0 && context->modDataVersionBuild != SupportedBuild) {
        context->LogError("NoEtherealItemTypes: only D2R build 92777 is supported.");
        return false;
    }

    GetItemContext = At<GetItemContextFn>(GetItemContextRva);
    GetDataTables = At<GetDataTablesFn>(GetDataTablesRva);
    if (!InstallHook()) return false;

    if (!context->RegisterConsoleCommand(
            "no-ethereal-item-types",
            Status,
            "Show configured ethereal exclusions and runtime counters."
        )) {
        context->LogWarn("NoEtherealItemTypes: status command could not be registered.");
    }
    context->LogInfo("NoEtherealItemTypes 1.1.0 active for D2R 3.2.92777 (global/mod-local hybrid).");
    return true;
}

D2RL_PLUGIN_EXPORT void D2RLoaderUnloadPlugin() noexcept {
    Context = nullptr;
}
