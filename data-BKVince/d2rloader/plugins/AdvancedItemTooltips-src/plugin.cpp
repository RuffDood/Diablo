#define NOMINMAX
#include <D2RLPlugin/api.h>
#include "tooltip_ranges.hpp"

#include <Windows.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <cctype>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <string>

namespace {
using tcp::tooltips::AppendRanges;
using tcp::tooltips::FormatPositiveRange;
using tcp::tooltips::ItemAffixIds;
using tcp::tooltips::RangeCatalog;

constexpr std::uint32_t SupportedBuild = 92777;
constexpr std::uintptr_t GetStatsDescriptionRva = 0x2DC4B0;
constexpr std::uintptr_t BuildItemTooltipRva = 0x2BD480;
constexpr std::uintptr_t GetMaxSocketsRva = 0x36EAD0;
constexpr std::uintptr_t GetItemDataContextRva = 0x34A0E0;
constexpr std::uintptr_t GetItemDataRva = 0x34A500;
constexpr std::uintptr_t GetItemsTxtRecordRva = 0x314110;
constexpr std::uintptr_t GetUnitStatValueRva = 0x2F5C60;
constexpr std::uintptr_t EnsureStringCapacityRva = 0x076210;

constexpr std::size_t ItemDataQualityOffset = 0x00;
constexpr std::size_t ItemDataFlagsOffset = 0x18;
constexpr std::size_t ItemDataFileIndexOffset = 0x34;
constexpr std::size_t ItemDataRarePrefixOffset = 0x42;
constexpr std::size_t ItemDataRareSuffixOffset = 0x44;
constexpr std::size_t ItemDataAutoPrefixOffset = 0x46;
constexpr std::size_t ItemDataMagicPrefixOffset = 0x48;
constexpr std::size_t ItemDataMagicSuffixOffset = 0x4E;
constexpr std::size_t ItemsTxtCodeOffset = 0x80;
constexpr std::size_t UnitClassIdOffset = 0x04;
constexpr std::uint32_t ItemFlagIdentified = 0x00000010;
constexpr std::uint32_t ItemFlagEthereal = 0x00400000;
constexpr std::int32_t ArmorClassStat = 31;
constexpr std::int32_t SocketsStat = 194;

using GetStatsDescriptionFn = void(__fastcall*)(
    void*, char*, std::uint32_t, int, int, int, unsigned, int, void*, void*
) noexcept;
using BuildItemTooltipFn = void*(__fastcall*)(
    void*, void*, void*, void*, std::uint64_t, std::uint64_t, std::uint64_t, std::uint64_t, std::uint64_t
) noexcept;
using GetMaxSocketsFn = std::uint8_t(__fastcall*)(void*) noexcept;
using GetItemDataContextFn = std::uint8_t(__fastcall*)(void*) noexcept;
using GetItemDataFn = std::uint8_t*(__fastcall*)(void*) noexcept;
using GetItemsTxtRecordFn = std::uint8_t*(__fastcall*)(std::uint8_t, std::int32_t) noexcept;
using GetUnitStatValueFn = std::int32_t(__fastcall*)(void*, std::int32_t, std::int32_t) noexcept;
using EnsureStringCapacityFn = void(__fastcall*)(void*, std::size_t) noexcept;

const D2RL::PluginContext* Context{};
std::uint8_t* Base{};
GetStatsDescriptionFn OriginalGetStatsDescription{};
BuildItemTooltipFn OriginalBuildItemTooltip{};
GetMaxSocketsFn GetMaxSockets{};
GetItemDataContextFn GetItemDataContext{};
GetItemDataFn GetItemData{};
GetItemsTxtRecordFn GetItemsTxtRecord{};
GetUnitStatValueFn GetUnitStatValue{};
EnsureStringCapacityFn EnsureStringCapacity{};
RangeCatalog Catalog;
bool French{};
std::atomic<std::uint64_t> EnhancedTooltips{};
std::atomic<std::uint64_t> RangeLines{};
std::atomic<bool> LoggedFinalTooltip{};

constexpr D2RL::PluginInfo Info{
    .infoSize = D2RL::PluginInfoSize,
    .apiVersion = D2RL_PLUGIN_API_VERSION,
    .id = "advanced-item-tooltips",
    .name = "Advanced Item Tooltips",
    .version = "1.0.2",
    .author = "RuffnecKk",
    .description = "Shows maximum sockets and affix or base-defense ranges in item tooltips.",
    .flags = D2RL::PluginFlags::NativeHooks,
};

template<class T>
T At(std::uintptr_t rva) noexcept {
    return reinterpret_cast<T>(Base + rva);
}

template<class T>
T Read(const std::uint8_t* address, std::size_t offset) noexcept {
    T value{};
    std::memcpy(&value, address + offset, sizeof(value));
    return value;
}

std::string Lower(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    return value;
}

bool UsesFrenchLocale() {
    const auto command = GetCommandLineW();
    if (!command) return false;
    std::wstring lower(command);
    std::transform(lower.begin(), lower.end(), lower.begin(), towlower);
    return lower.find(L"frfr") != std::wstring::npos;
}

ItemAffixIds ReadAffixIds(const std::uint8_t* data) noexcept {
    ItemAffixIds ids{};
    ids.quality = Read<std::uint32_t>(data, ItemDataQualityOffset);
    ids.fileIndex = Read<std::uint32_t>(data, ItemDataFileIndexOffset);
    ids.rarePrefix = Read<std::uint16_t>(data, ItemDataRarePrefixOffset);
    ids.rareSuffix = Read<std::uint16_t>(data, ItemDataRareSuffixOffset);
    ids.autoPrefix = Read<std::uint16_t>(data, ItemDataAutoPrefixOffset);
    for (std::size_t index = 0; index < 3; ++index) {
        ids.magicPrefix[index] = Read<std::uint16_t>(data, ItemDataMagicPrefixOffset + index * 2);
        ids.magicSuffix[index] = Read<std::uint16_t>(data, ItemDataMagicSuffixOffset + index * 2);
    }
    return ids;
}

std::string ItemCode(void* item) noexcept {
    const auto classId = Read<std::int32_t>(static_cast<const std::uint8_t*>(item), UnitClassIdOffset);
    auto* record = GetItemsTxtRecord(GetItemDataContext(item), classId);
    if (!record) return {};
    char code[5]{};
    std::memcpy(code, record + ItemsTxtCodeOffset, 4);
    std::string value(code);
    while (!value.empty() && (value.back() == ' ' || value.back() == '\0')) value.pop_back();
    return Lower(value);
}

std::optional<std::int32_t> FindDefenseModifier(
    std::string_view description,
    const std::vector<tcp::tooltips::ModifierRange>& ranges
) {
    const auto defense = std::find_if(ranges.begin(), ranges.end(), [](const auto& range) {
        return range.stat == "armorclass";
    });
    if (defense == ranges.end()) return 0;
    std::size_t start{};
    while (start <= description.size()) {
        const auto end = description.find('\n', start);
        const auto roll = tcp::tooltips::FirstSignedInteger(description.substr(start, end - start));
        if (roll) {
            const auto magnitude = std::llabs(static_cast<long long>(*roll));
            const auto low = std::min(
                std::llabs(static_cast<long long>(defense->minimum)),
                std::llabs(static_cast<long long>(defense->maximum))
            );
            const auto high = std::max(
                std::llabs(static_cast<long long>(defense->minimum)),
                std::llabs(static_cast<long long>(defense->maximum))
            );
            std::string normalizedLine;
            std::string normalizedAnchor;
            for (const auto ch : std::string(description.substr(start, end - start))) {
                if (std::isalpha(static_cast<unsigned char>(ch))) normalizedLine.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(ch))));
            }
            for (const auto ch : defense->anchor) {
                if (std::isalpha(static_cast<unsigned char>(ch))) normalizedAnchor.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(ch))));
            }
            if (magnitude >= low && magnitude <= high
                && !normalizedAnchor.empty()
                && normalizedLine.find(normalizedAnchor) != std::string::npos) return *roll;
        }
        if (end == std::string_view::npos) break;
        start = end + 1;
    }
    return std::nullopt;
}

std::string MetadataLines(
    void* item,
    const std::uint8_t* itemData,
    const ItemAffixIds& ids,
    std::string_view originalDescription,
    const std::vector<tcp::tooltips::ModifierRange>& ranges,
    bool identified
) {
    std::string result;
    const auto maximumSockets = static_cast<unsigned>(GetMaxSockets(item));
    if (maximumSockets > 0) {
        const auto currentSockets = std::max(0, GetUnitStatValue(item, SocketsStat, 0));
        if (currentSockets > 0) {
            result = "\xFF" "c0";
            result += French ? "Chasses : " : "Sockets: ";
            result += std::to_string(currentSockets) + " / \xFF" "c5" + std::to_string(maximumSockets);
        } else {
            result = "\xFF" "c0";
            result += French ? "Chasses maximales : " : "Maximum Sockets: ";
            result += "\xFF" "c5" + std::to_string(maximumSockets);
        }
        result.push_back('\n');
    }

    const auto armor = identified ? Catalog.FindArmor(ItemCode(item)) : std::nullopt;
    if (armor) {
        auto minimum = armor->minimum;
        auto maximum = armor->maximum;
        if ((Read<std::uint32_t>(itemData, ItemDataFlagsOffset) & ItemFlagEthereal) != 0) {
            minimum = minimum * 3 / 2;
            maximum = maximum * 3 / 2;
        }
        const auto totalDefense = GetUnitStatValue(item, ArmorClassStat, 0);
        const auto modifier = FindDefenseModifier(originalDescription, ranges).value_or(0);
        const auto baseDefense = totalDefense - modifier;
        if (baseDefense >= minimum && baseDefense <= maximum) {
            result += "\xFF" "c0";
            result += French ? "Défense de base : " : "Base Defense: ";
            result += std::to_string(baseDefense) + " " + FormatPositiveRange(minimum, maximum) + "\n";
        }
    }
    return result;
}

std::string SocketLine(void* item) {
    const auto maximumSockets = static_cast<unsigned>(GetMaxSockets(item));
    if (maximumSockets == 0) return {};

    std::string result = "\xC3\xBF" "c0";
    const auto currentSockets = std::max(0, GetUnitStatValue(item, SocketsStat, 0));
    if (currentSockets > 0) {
        result += French ? "Chasses : " : "Sockets: ";
        result += std::to_string(currentSockets) + " / " + std::to_string(maximumSockets);
    } else {
        result += French ? "Chasses maximales : " : "Maximum Sockets: ";
        result += std::to_string(maximumSockets);
    }
    return result;
}

bool IsDefenseLine(std::string_view line) {
    return line.find("Defense") != std::string_view::npos
        || line.find("DEFENSE") != std::string_view::npos
        || line.find("D\xC3\xA9" "fense") != std::string_view::npos
        || line.find("D\xC3\x89" "FENSE") != std::string_view::npos;
}

std::string AppendDefenseRange(
    std::string description,
    std::int32_t displayedDefense,
    std::int32_t minimum,
    std::int32_t maximum
) {
    std::size_t start{};
    while (start <= description.size()) {
        const auto end = description.find('\n', start);
        const auto lineEnd = end == std::string::npos ? description.size() : end;
        const auto line = std::string_view(description).substr(start, lineEnd - start);
        const auto value = tcp::tooltips::FirstSignedInteger(line);
        if (value && *value == displayedDefense && IsDefenseLine(line)) {
            auto range = FormatPositiveRange(minimum, maximum);
            range.back() = '0';
            description.insert(lineEnd, " " + range);
            break;
        }
        if (end == std::string::npos) break;
        start = end + 1;
    }
    return description;
}

void __fastcall HookGetStatsDescription(
    void* item,
    char* buffer,
    std::uint32_t bufferSize,
    int a4,
    int a5,
    int a6,
    unsigned a7,
    int a8,
    void* a9,
    void* a10
) noexcept {
    OriginalGetStatsDescription(
        item,
        buffer,
        bufferSize,
        a4,
        a5,
        a6,
        a7,
        a8,
        a9,
        a10
    );
    if (!item || !buffer || bufferSize < 2 || bufferSize > 1024 * 1024) return;
    const auto length = strnlen_s(buffer, static_cast<std::size_t>(bufferSize));
    if (length >= bufferSize) return;
    auto* itemData = GetItemData(item);
    if (!itemData) return;

    const auto ids = ReadAffixIds(itemData);
    const auto identified =
        (Read<std::uint32_t>(itemData, ItemDataFlagsOffset) & ItemFlagIdentified) != 0;
    const auto ranges = identified
        ? Catalog.Resolve(ids)
        : std::vector<tcp::tooltips::ModifierRange>{};
    const std::string original(buffer, length);
    auto enhanced = AppendRanges(original, ranges);
    const auto armor = identified ? Catalog.FindArmor(ItemCode(item)) : std::nullopt;
    if (armor) {
        auto minimum = armor->minimum;
        auto maximum = armor->maximum;
        if ((Read<std::uint32_t>(itemData, ItemDataFlagsOffset) & ItemFlagEthereal) != 0) {
            minimum = minimum * 3 / 2;
            maximum = maximum * 3 / 2;
        }
        enhanced = AppendDefenseRange(
            std::move(enhanced),
            GetUnitStatValue(item, ArmorClassStat, 0),
            minimum,
            maximum
        );
    }
    const auto sockets = SocketLine(item);
    if (!sockets.empty()) {
        if (!enhanced.empty() && enhanced.back() != '\n') enhanced.push_back('\n');
        enhanced += sockets;
    }
    if (enhanced.size() + 1 > bufferSize || enhanced == original) return;

    std::memcpy(buffer, enhanced.c_str(), enhanced.size() + 1);
    EnhancedTooltips.fetch_add(1, std::memory_order_relaxed);
    RangeLines.fetch_add(ranges.size(), std::memory_order_relaxed);
}

bool IsReadable(const void* address, std::size_t size) noexcept {
    if (!address || size == 0) return false;
    MEMORY_BASIC_INFORMATION memory{};
    if (VirtualQuery(address, &memory, sizeof(memory)) != sizeof(memory)
        || memory.State != MEM_COMMIT
        || (memory.Protect & (PAGE_GUARD | PAGE_NOACCESS)) != 0) {
        return false;
    }
    const auto begin = reinterpret_cast<std::uintptr_t>(address);
    const auto regionEnd = reinterpret_cast<std::uintptr_t>(memory.BaseAddress) + memory.RegionSize;
    return begin <= regionEnd && size <= regionEnd - begin;
}

std::string EscapeTooltip(std::string_view text) {
    std::string escaped = "AdvancedItemTooltips final tooltip bytes: ";
    constexpr char Hex[] = "0123456789ABCDEF";
    for (const auto raw : text) {
        const auto byte = static_cast<unsigned char>(raw);
        if (byte == '\n') {
            escaped += "<LF>";
        } else if (byte == '\r') {
            escaped += "<CR>";
        } else if (byte >= 0x20 && byte < 0x7F) {
            escaped.push_back(static_cast<char>(byte));
        } else {
            escaped += "<";
            escaped.push_back(Hex[byte >> 4]);
            escaped.push_back(Hex[byte & 0x0F]);
            escaped += ">";
        }
    }
    return escaped;
}

void* __fastcall HookBuildItemTooltip(
    void* output,
    void* a2,
    void* a3,
    void* item,
    std::uint64_t a5,
    std::uint64_t a6,
    std::uint64_t a7,
    std::uint64_t a8,
    std::uint64_t a9
) noexcept {
    auto* result = OriginalBuildItemTooltip(output, a2, a3, item, a5, a6, a7, a8, a9);
    if (!result || !item || !IsReadable(result, 24)) return result;
    try {
        const auto* object = static_cast<const std::uint8_t*>(result);
        const auto* data = Read<const char*>(object, 0);
        const auto length = Read<std::size_t>(object, 8);
        if (length == 0 || length > 16 * 1024 || !IsReadable(data, length + 1)) return result;

        auto* itemData = GetItemData(item);
        if (!itemData) return result;
        const auto identified =
            (Read<std::uint32_t>(itemData, ItemDataFlagsOffset) & ItemFlagIdentified) != 0;
        const auto ids = ReadAffixIds(itemData);
        const auto ranges = identified
            ? Catalog.Resolve(ids)
            : std::vector<tcp::tooltips::ModifierRange>{};
        const std::string original(data, length);
        auto enhanced = AppendRanges(original, ranges);

        const auto armor = identified ? Catalog.FindArmor(ItemCode(item)) : std::nullopt;
        if (armor) {
            auto minimum = armor->minimum;
            auto maximum = armor->maximum;
            if ((Read<std::uint32_t>(itemData, ItemDataFlagsOffset) & ItemFlagEthereal) != 0) {
                minimum = minimum * 3 / 2;
                maximum = maximum * 3 / 2;
            }
            enhanced = AppendDefenseRange(
                std::move(enhanced),
                GetUnitStatValue(item, ArmorClassStat, 0),
                minimum,
                maximum
            );
        }

        const auto sockets = SocketLine(item);
        if (!sockets.empty()) {
            const auto firstLineEnd = enhanced.find('\n');
            if (firstLineEnd == std::string::npos) {
                enhanced += "\n" + sockets;
            } else {
                enhanced.insert(firstLineEnd + 1, sockets + "\n");
            }
        }
        if (enhanced == original) return result;

        EnsureStringCapacity(result, enhanced.size());
        auto* destination = Read<char*>(static_cast<const std::uint8_t*>(result), 0);
        if (!IsReadable(destination, enhanced.size() + 1)) return result;
        std::memcpy(destination, enhanced.c_str(), enhanced.size() + 1);
        const auto enhancedLength = enhanced.size();
        std::memcpy(static_cast<std::uint8_t*>(result) + 8, &enhancedLength, sizeof(enhancedLength));
        EnhancedTooltips.fetch_add(1, std::memory_order_relaxed);
        RangeLines.fetch_add(ranges.size(), std::memory_order_relaxed);

        if (!LoggedFinalTooltip.exchange(true, std::memory_order_relaxed)) {
            const auto escaped = EscapeTooltip(enhanced);
            Context->LogInfo(escaped.c_str());
        }
    } catch (...) {
        Context->LogError("AdvancedItemTooltips: final tooltip enhancement failed safely.");
    }
    return result;
}

auto Status(
    D2R::Game::Client*,
    const D2RL::ConsoleCommandContext* command,
    void*
) noexcept -> D2RL::ConsoleCommandResult {
    if (!command || !command->plugin) return D2RL::ConsoleCommandResult::Failed;
    char message[384]{};
    std::snprintf(
        message,
        sizeof(message),
        "AdvancedItemTooltips 1.0.2: enhanced tooltips=%llu; candidate variable ranges=%llu; properties=%zu.",
        static_cast<unsigned long long>(EnhancedTooltips.load(std::memory_order_relaxed)),
        static_cast<unsigned long long>(RangeLines.load(std::memory_order_relaxed)),
        Catalog.PropertyCount()
    );
    command->plugin->WriteConsoleMessage(message);
    return D2RL::ConsoleCommandResult::Handled;
}

bool InstallHook() noexcept {
    constexpr std::array<std::uint8_t, 32> expected{
        0x40, 0x55, 0x53, 0x56, 0x57, 0x41, 0x54, 0x41,
        0x55, 0x41, 0x56, 0x41, 0x57, 0x48, 0x8D, 0xAC,
        0x24, 0xF8, 0xB1, 0xFF, 0xFF, 0xB8, 0x08, 0x4F,
        0x00, 0x00, 0xE8, 0x41, 0x3C, 0x01, 0x01, 0x48
    };
    if (!Context->InstallInlineHook(
            BuildItemTooltipRva,
            expected.data(),
            static_cast<std::uint32_t>(expected.size()),
            HookBuildItemTooltip,
            &OriginalBuildItemTooltip
        )) {
        Context->LogError("AdvancedItemTooltips: final item tooltip signature mismatch; hook refused.");
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
        context->LogError("AdvancedItemTooltips: only D2R build 92777 is supported.");
        return false;
    }

    GetMaxSockets = At<GetMaxSocketsFn>(GetMaxSocketsRva);
    GetItemDataContext = At<GetItemDataContextFn>(GetItemDataContextRva);
    GetItemData = At<GetItemDataFn>(GetItemDataRva);
    GetItemsTxtRecord = At<GetItemsTxtRecordFn>(GetItemsTxtRecordRva);
    GetUnitStatValue = At<GetUnitStatValueFn>(GetUnitStatValueRva);
    EnsureStringCapacity = At<EnsureStringCapacityFn>(EnsureStringCapacityRva);
    French = UsesFrenchLocale();

    std::string catalogError;
    if (!context->modDirectory
        || !Catalog.Load(std::filesystem::path(context->modDirectory) / L"data/global/excel", catalogError)) {
        const auto message = "AdvancedItemTooltips: affix catalog unavailable; socket display remains active. " + catalogError;
        context->LogWarn(message.c_str());
    }
    if (!InstallHook()) return false;
    if (!context->RegisterConsoleCommand(
            "advanced-item-tooltips",
            Status,
            "Show advanced item tooltip counters."
        )) {
        context->LogWarn("AdvancedItemTooltips: status command could not be registered.");
    }
    context->LogInfo("AdvancedItemTooltips 1.0.2 active for D2R 3.2.92777 (global/mod-local hybrid)." );
    return true;
}

D2RL_PLUGIN_EXPORT void D2RLoaderUnloadPlugin() noexcept {
    Context = nullptr;
}
