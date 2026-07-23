#define NOMINMAX
#include <D2RLPlugin/api.h>
#include <nlohmann/json.hpp>
#include "quantity_tooltip.hpp"

#include <Windows.h>

#include <array>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

namespace {
constexpr std::uint32_t SupportedBuild = 92777;
constexpr std::uintptr_t GetStatsDescriptionRva = 0x2DC4B0;
constexpr std::uintptr_t GetUnitStatValueRva = 0x2F5C60;
constexpr std::uintptr_t GetItemDataRva = 0x34A500;
constexpr std::uintptr_t GetTotalMaxStackRva = 0x3719E0;

constexpr std::int32_t QuantityStat = 70;
constexpr std::size_t ItemDataFlagsOffset = 0x18;
constexpr std::uint32_t ItemFlagSocketed = 0x00000800;
constexpr wchar_t ConfigFileName[] = L"QtyDisplayIssue.json";

using GetStatsDescriptionFn = void(__fastcall*)(
    void*, char*, std::uint32_t, int, int, int, unsigned, int, void*, void*
) noexcept;
using GetUnitStatValueFn = std::int32_t(__fastcall*)(void*, std::int32_t, std::int32_t) noexcept;
using GetItemDataFn = std::uint8_t*(__fastcall*)(void*) noexcept;
using GetTotalMaxStackFn = std::int32_t(__fastcall*)(void*) noexcept;

struct Config {
    bool enabled{true};
};

const D2RL::PluginContext* Context{};
std::uint8_t* Base{};
GetStatsDescriptionFn OriginalGetStatsDescription{};
GetUnitStatValueFn GetUnitStatValue{};
GetItemDataFn GetItemData{};
GetTotalMaxStackFn GetTotalMaxStack{};
Config Settings{};
std::string LoadedConfigPath{"built-in defaults"};
std::atomic<std::uint64_t> RepairedTooltips{};

constexpr D2RL::PluginInfo Info{
    .infoSize = D2RL::PluginInfoSize,
    .apiVersion = D2RL_PLUGIN_API_VERSION,
    .id = "qty-display-issue",
    .name = "Qty Display Issue",
    .version = "1.0.0",
    .author = "RuffnecKk",
    .description = "Shows quantity on socketed stackable item tooltips.",
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

bool LoadConfig() noexcept {
    Settings = {};
    LoadedConfigPath = "built-in defaults";

    std::vector<std::filesystem::path> candidates;
    if (Context && Context->modDirectory && Context->modDirectory[0] != L'\0') {
        candidates.emplace_back(std::filesystem::path(Context->modDirectory) / ConfigFileName);
    }
    candidates.emplace_back(ConfigFileName);

    bool malformedConfigFound{};
    for (const auto& path : candidates) {
        std::error_code error;
        if (!std::filesystem::is_regular_file(path, error)) continue;

        try {
            std::ifstream input(path);
            if (!input.is_open()) continue;
            const auto config = nlohmann::json::parse(input, nullptr, true, true);
            if (!config.is_object()) {
                throw nlohmann::json::type_error::create(
                    302,
                    "configuration root must be an object",
                    &config
                );
            }
            Settings.enabled = config.value("enabled", true);
            LoadedConfigPath = path.string();
            return true;
        } catch (const std::exception& exception) {
            malformedConfigFound = true;
            if (Context) {
                const auto message = std::string("QtyDisplayIssue: invalid ")
                    + path.string() + " (" + exception.what() + ").";
                Context->LogError(message.c_str());
            }
        }
    }

    return !malformedConfigFound;
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
    OriginalGetStatsDescription(item, buffer, bufferSize, a4, a5, a6, a7, a8, a9, a10);
    if (!item || !buffer || bufferSize < 2 || bufferSize > 1024 * 1024) return;

    auto* itemData = GetItemData(item);
    if (!itemData) return;
    const auto flags = Read<std::uint32_t>(itemData, ItemDataFlagsOffset);
    if ((flags & ItemFlagSocketed) == 0) return;

    const auto currentQuantity = GetUnitStatValue(item, QuantityStat, 0);
    if (currentQuantity <= 0) return;
    const auto maximumQuantity = GetTotalMaxStack(item);
    if (maximumQuantity <= 0) return;

    if (tcp::qty_display_issue::AppendQuantityLine(
            buffer,
            static_cast<std::size_t>(bufferSize),
            currentQuantity,
            maximumQuantity
        )) {
        RepairedTooltips.fetch_add(1, std::memory_order_relaxed);
    }
}

auto Status(D2R::Game::Client*, const D2RL::ConsoleCommandContext* command, void*) noexcept
    -> D2RL::ConsoleCommandResult {
    if (!command || !command->plugin) return D2RL::ConsoleCommandResult::Failed;
    char message[320]{};
    std::snprintf(
        message,
        sizeof(message),
        "QtyDisplayIssue 1.0.0: enabled=%s; JSON config=%s; repaired tooltips=%llu.",
        Settings.enabled ? "true" : "false",
        LoadedConfigPath.c_str(),
        static_cast<unsigned long long>(RepairedTooltips.load(std::memory_order_relaxed))
    );
    command->plugin->WriteConsoleMessage(message);
    return D2RL::ConsoleCommandResult::Handled;
}

bool InstallHook() noexcept {
    constexpr std::array<std::uint8_t, 32> expected{
        0x48, 0x89, 0x5C, 0x24, 0x20, 0x55, 0x56, 0x57,
        0x41, 0x54, 0x41, 0x55, 0x41, 0x56, 0x41, 0x57,
        0x48, 0x8D, 0xAC, 0x24, 0xC0, 0xFB, 0xFF, 0xFF,
        0x48, 0x81, 0xEC, 0x40, 0x05, 0x00, 0x00, 0x48
    };
    if (!Context->InstallInlineHook(
            GetStatsDescriptionRva,
            expected.data(),
            static_cast<std::uint32_t>(expected.size()),
            HookGetStatsDescription,
            &OriginalGetStatsDescription
        )) {
        Context->LogError("QtyDisplayIssue: item-stat tooltip signature mismatch; hook refused.");
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
    if (!LoadConfig()) {
        context->LogError("QtyDisplayIssue: configuration is invalid.");
        return false;
    }
    if (context->modDataVersionBuild != 0 && context->modDataVersionBuild != SupportedBuild) {
        context->LogError("QtyDisplayIssue: only D2R build 92777 is supported.");
        return false;
    }

    GetUnitStatValue = At<GetUnitStatValueFn>(GetUnitStatValueRva);
    GetItemData = At<GetItemDataFn>(GetItemDataRva);
    GetTotalMaxStack = At<GetTotalMaxStackFn>(GetTotalMaxStackRva);

    if (Settings.enabled && !InstallHook()) return false;
    if (!context->RegisterConsoleCommand(
            "qty-display-issue",
            Status,
            "Show socketed quantity tooltip repair status."
        )) {
        context->LogWarn("QtyDisplayIssue: status command could not be registered.");
    }

    const auto state = Settings.enabled ? "active" : "disabled";
    const auto message = std::string("QtyDisplayIssue 1.0.0 ") + state
        + " for D2R 3.2.92777 (JSON config: " + LoadedConfigPath + ").";
    context->LogInfo(message.c_str());
    return true;
}

D2RL_PLUGIN_EXPORT void D2RLoaderUnloadPlugin() noexcept {
    OriginalGetStatsDescription = nullptr;
    GetUnitStatValue = nullptr;
    GetItemData = nullptr;
    GetTotalMaxStack = nullptr;
    Base = nullptr;
    Context = nullptr;
}
