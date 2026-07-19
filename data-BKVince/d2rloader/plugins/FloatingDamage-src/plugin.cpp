#include <D2RLPlugin/api.h>

#include "D3D12Hook.h"
#include "FloatingDamage.h"

#include <Windows.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <charconv>
#include <cctype>
#include <cstdint>
#include <cstdio>
#include <sstream>
#include <string>
#include <string_view>
#include <vector>

namespace {
constexpr std::uint32_t SupportedBuild = 92777;
constexpr std::uintptr_t DamageInfoRva = 0x427150;
constexpr std::uint16_t CriticalStrikeResultFlag = 0x2000;
constexpr std::uint32_t MonsterUnitType = 1;

const D2RL::PluginContext* Context{};
std::uint8_t* Base{};
HMODULE Module{};
std::atomic<std::uint64_t> CapturedEvents{};
std::atomic<std::uint64_t> DisplayedEvents{};
std::atomic<bool> OverlayReady{};
HANDLE OverlayStopEvent{};
HANDLE OverlayWorker{};

struct DynamicPathView {
    std::uint16_t offsetX;
    std::uint16_t positionX;
    std::uint16_t offsetY;
    std::uint16_t positionY;
};

#pragma pack(push, 1)
struct UnitView {
    std::uint32_t unitType;
    std::uint32_t classId;
    std::uint32_t unitId;
    std::uint32_t mode;
    std::uint8_t data[0x28];
    DynamicPathView* dynamicPath;
};
#pragma pack(pop)
static_assert(offsetof(UnitView, dynamicPath) == 0x38);

using DamageInfoFn = void(__fastcall*)(
    void*, UnitView*, UnitView*, std::int32_t, std::int32_t, std::uintptr_t,
    std::int32_t, const char*, void*, std::uintptr_t) noexcept;
DamageInfoFn OriginalDamageInfo{};

constexpr D2RL::PluginInfo Info{
    .infoSize = D2RL::PluginInfoSize,
    .apiVersion = D2RL_PLUGIN_API_VERSION,
    .id = "floating-damage",
    .name = "Floating Damage",
    .version = "1.0.0",
    .author = "TCP / d2rlan",
    .description = "D2RLAN floating combat numbers and rolling DPS for D2R 3.2.92777.",
    .flags = D2RL::PluginFlags::ModScopedOnly | D2RL::PluginFlags::NativeHooks,
};

constexpr char DefaultToml[] = R"toml(# Floating Damage configuration for BKVince.
# All damage values are visual only and never alter combat simulation.

[general]
enabled = true
max_numbers_on_screen = 160
font_index = 0
color_by_damage_type = false

[appearance]
text_size = 38.0
critical_hit_size = 48.0
text_outline_width = 1
shadow_left_right_offset = 0.0
shadow_up_down_offset = 0.0

[animation]
display_time_seconds = 0.85
critical_display_time_seconds = 0.95
fade_out_start = 0.75
spawn_size = 0.01
pop_bounce_size = 1.75
pop_in_time_seconds = 0.08
settle_time_seconds = 0.12
upward_drift_speed = 45.0
sideways_spread = 0.0
spawn_height_offset = 0.0

[combining]
enable_hit_combining = true
max_combined_hit_size = 999999
combine_window_ms = 500
extend_display_on_hit_seconds = 0.52
hit_pulse_size = 1.24
hit_pulse_time_seconds = 0.13
show_tick_popups = true
tick_popup_time_seconds = 0.70
tick_popup_size = 0.60
tick_popup_travel = 64.0
tick_popup_height_offset = -28.0

[layout]
spread_numbers_horizontally = true
number_of_columns = 7
column_spacing = 40.0
stack_height_step = 24.0
column_reuse_time_seconds = 0.60
max_stack_height = 96.0

[dps]
show_dps_counter = true
horizontal_position_percent = 2.0
vertical_position_percent = 98.0
dps_sample_time_seconds = 5.0

[preview]
preview_number_count = 8
preview_spread = 32.0

[colors]
normal = [0.92, 0.92, 0.88, 1.0]
critical = [1.0, 0.84, 0.27, 1.0]
physical = [0.92, 0.92, 0.88, 1.0]
fire = [1.0, 0.45, 0.12, 1.0]
lightning = [1.0, 0.95, 0.35, 1.0]
cold = [0.45, 0.78, 1.0, 1.0]
poison = [0.35, 0.90, 0.30, 1.0]
magic = [0.72, 0.45, 1.0, 1.0]
outline = [0.16, 0.11, 0.03, 1.0]
shadow = [0.16, 0.11, 0.02, 1.0]
)toml";

std::string Trim(std::string_view value) {
    std::size_t first{};
    while (first < value.size() && std::isspace(static_cast<unsigned char>(value[first]))) ++first;
    std::size_t last = value.size();
    while (last > first && std::isspace(static_cast<unsigned char>(value[last - 1]))) --last;
    return std::string(value.substr(first, last - first));
}

std::string Lower(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    return value;
}

bool ParseBool(std::string_view value, bool& output) {
    const std::string text = Lower(Trim(value));
    if (text == "true") { output = true; return true; }
    if (text == "false") { output = false; return true; }
    return false;
}

bool ParseInt(std::string_view value, int& output) {
    const std::string text = Trim(value);
    const auto result = std::from_chars(text.data(), text.data() + text.size(), output);
    return result.ec == std::errc{} && result.ptr == text.data() + text.size();
}

bool ParseFloat(std::string_view value, float& output) {
    const std::string text = Trim(value);
    char* end{};
    output = std::strtof(text.c_str(), &end);
    return end == text.c_str() + text.size();
}

bool ParseColor(std::string_view value, ImVec4& output) {
    std::string text = Trim(value);
    if (text.size() < 2 || text.front() != '[' || text.back() != ']') return false;
    text = text.substr(1, text.size() - 2);
    std::array<float, 4> components{};
    std::size_t start{};
    for (std::size_t index = 0; index < components.size(); ++index) {
        const std::size_t comma = text.find(',', start);
        const std::size_t end = index + 1 == components.size() ? text.size() : comma;
        if (end == std::string::npos || !ParseFloat(std::string_view(text).substr(start, end - start), components[index])) return false;
        start = end + 1;
    }
    output = ImVec4(components[0], components[1], components[2], components[3]);
    return true;
}

void ApplySetting(std::string_view rawKey, std::string_view value, FloatingDamage::Config& config) {
    const std::string key = Lower(Trim(rawKey));
    if (key == "enabled") ParseBool(value, config.enabled);
    else if (key == "max_numbers_on_screen") ParseInt(value, config.maxNumbersOnScreen);
    else if (key == "font_index") ParseInt(value, config.fontIndex);
    else if (key == "color_by_damage_type") ParseBool(value, config.colorByDamageType);
    else if (key == "text_size") ParseFloat(value, config.textSize);
    else if (key == "critical_hit_size") ParseFloat(value, config.criticalHitSize);
    else if (key == "text_outline_width") ParseInt(value, config.textOutlineWidth);
    else if (key == "shadow_left_right_offset") ParseFloat(value, config.shadowLeftRightOffset);
    else if (key == "shadow_up_down_offset") ParseFloat(value, config.shadowUpDownOffset);
    else if (key == "display_time_seconds") ParseFloat(value, config.displayTimeSeconds);
    else if (key == "critical_display_time_seconds") ParseFloat(value, config.criticalDisplayTimeSeconds);
    else if (key == "fade_out_start") ParseFloat(value, config.fadeOutStart);
    else if (key == "spawn_size") ParseFloat(value, config.spawnSize);
    else if (key == "pop_bounce_size") ParseFloat(value, config.popBounceSize);
    else if (key == "pop_in_time_seconds") ParseFloat(value, config.popInTimeSeconds);
    else if (key == "settle_time_seconds") ParseFloat(value, config.settleTimeSeconds);
    else if (key == "upward_drift_speed") ParseFloat(value, config.upwardDriftSpeed);
    else if (key == "sideways_spread") ParseFloat(value, config.sidewaysSpread);
    else if (key == "spawn_height_offset") ParseFloat(value, config.spawnHeightOffset);
    else if (key == "enable_hit_combining") ParseBool(value, config.enableHitCombining);
    else if (key == "max_combined_hit_size") ParseInt(value, config.maxCombinedHitSize);
    else if (key == "combine_window_ms") ParseInt(value, config.combineWindowMs);
    else if (key == "extend_display_on_hit_seconds") ParseFloat(value, config.extendDisplayOnHitSeconds);
    else if (key == "hit_pulse_size") ParseFloat(value, config.hitPulseSize);
    else if (key == "hit_pulse_time_seconds") ParseFloat(value, config.hitPulseTimeSeconds);
    else if (key == "show_tick_popups") ParseBool(value, config.showTickPopups);
    else if (key == "tick_popup_time_seconds") ParseFloat(value, config.tickPopupTimeSeconds);
    else if (key == "tick_popup_size") ParseFloat(value, config.tickPopupSize);
    else if (key == "tick_popup_travel") ParseFloat(value, config.tickPopupTravel);
    else if (key == "tick_popup_height_offset") ParseFloat(value, config.tickPopupHeightOffset);
    else if (key == "spread_numbers_horizontally") ParseBool(value, config.spreadNumbersHorizontally);
    else if (key == "number_of_columns") ParseInt(value, config.numberOfColumns);
    else if (key == "column_spacing") ParseFloat(value, config.columnSpacing);
    else if (key == "stack_height_step") ParseFloat(value, config.stackHeightStep);
    else if (key == "column_reuse_time_seconds") ParseFloat(value, config.columnReuseTimeSeconds);
    else if (key == "max_stack_height") ParseFloat(value, config.maxStackHeight);
    else if (key == "show_dps_counter") ParseBool(value, config.showDpsCounter);
    else if (key == "horizontal_position_percent") ParseFloat(value, config.horizontalPositionPercent);
    else if (key == "vertical_position_percent") ParseFloat(value, config.verticalPositionPercent);
    else if (key == "dps_sample_time_seconds") ParseFloat(value, config.dpsSampleTimeSeconds);
    else if (key == "preview_number_count") ParseInt(value, config.previewNumberCount);
    else if (key == "preview_spread") ParseFloat(value, config.previewSpread);
    else if (key == "normal") ParseColor(value, config.normalColor);
    else if (key == "critical") ParseColor(value, config.criticalColor);
    else if (key == "physical") ParseColor(value, config.physicalColor);
    else if (key == "fire") ParseColor(value, config.fireColor);
    else if (key == "lightning") ParseColor(value, config.lightningColor);
    else if (key == "cold") ParseColor(value, config.coldColor);
    else if (key == "poison") ParseColor(value, config.poisonColor);
    else if (key == "magic") ParseColor(value, config.magicColor);
    else if (key == "outline") ParseColor(value, config.outlineColor);
    else if (key == "shadow") ParseColor(value, config.shadowColor);
}

void ParseConfig(std::string_view text) {
    FloatingDamage::ResetToDefaults();
    auto& config = FloatingDamage::GetConfig();
    std::size_t cursor{};
    while (cursor < text.size()) {
        const std::size_t lineEnd = text.find('\n', cursor);
        std::string line = Trim(text.substr(cursor, lineEnd == std::string_view::npos ? text.size() - cursor : lineEnd - cursor));
        cursor = lineEnd == std::string_view::npos ? text.size() : lineEnd + 1;
        const std::size_t comment = line.find('#');
        if (comment != std::string::npos) line.resize(comment);
        line = Trim(line);
        if (line.empty() || line.front() == '[') continue;
        const std::size_t equals = line.find('=');
        if (equals == std::string::npos) continue;
        ApplySetting(std::string_view(line).substr(0, equals), std::string_view(line).substr(equals + 1), config);
    }
    config.fontIndex = std::clamp(config.fontIndex, 0, D3D12::kFloatingDamageFontCount - 1);
    config.maxNumbersOnScreen = std::max(config.maxNumbersOnScreen, 1);
    config.numberOfColumns = std::max(config.numberOfColumns, 1);
}

bool LoadConfig() {
    std::array<char, 16384> buffer{};
    std::uint32_t required{};
    if (!Context->ReadConfig(buffer.data(), static_cast<std::uint32_t>(buffer.size()), &required)) return false;
    ParseConfig(std::string_view(buffer.data()));
    return true;
}

bool SaveEnabled(bool enabled) {
    std::array<char, 16384> buffer{};
    if (!Context->ReadConfig(buffer.data(), static_cast<std::uint32_t>(buffer.size()), nullptr)) return false;
    std::string text(buffer.data());
    const std::size_t key = text.find("enabled");
    if (key == std::string::npos) return false;
    const std::size_t equals = text.find('=', key);
    const std::size_t lineEnd = text.find_first_of("\r\n", equals);
    if (equals == std::string::npos) return false;
    const std::size_t valueStart = text.find_first_not_of(" \t", equals + 1);
    if (valueStart == std::string::npos) return false;
    const std::size_t valueEnd = lineEnd == std::string::npos ? text.size() : lineEnd;
    text.replace(valueStart, valueEnd - valueStart, enabled ? "true" : "false");
    return Context->WriteConfig(text.c_str());
}

bool SafeCopyTypeName(const char* name, char* output, std::size_t outputSize) noexcept {
    __try {
        if (!name || !output || outputSize == 0) return false;
        strncpy_s(output, outputSize, name, _TRUNCATE);
        return true;
    }
    __except (EXCEPTION_EXECUTE_HANDLER) {
        return false;
    }
}

FloatingDamage::Element ElementFromName(const char* name) noexcept {
    char text[16]{};
    if (!SafeCopyTypeName(name, text, sizeof(text))) return FloatingDamage::Element::Physical;
    const std::string type = Lower(text);
    if (type.find("fire") != std::string::npos || type.find("burn") != std::string::npos) return FloatingDamage::Element::Fire;
    if (type.find("ligt") != std::string::npos || type.find("ltng") != std::string::npos || type.find("light") != std::string::npos) return FloatingDamage::Element::Lightning;
    if (type.find("cold") != std::string::npos) return FloatingDamage::Element::Cold;
    if (type.find("pois") != std::string::npos) return FloatingDamage::Element::Poison;
    if (type.find("mag") != std::string::npos) return FloatingDamage::Element::Magic;
    return FloatingDamage::Element::Physical;
}

bool ComputeScreenPosition(UnitView* attacker, UnitView* target, float& screenX, float& screenY) noexcept {
    __try {
        if (!target || !target->dynamicPath) return false;
        if (!attacker || !attacker->dynamicPath) attacker = target;
        const DynamicPathView* source = attacker->dynamicPath;
        const DynamicPathView* destination = target->dynamicPath;
        constexpr float inverseSubtile = 1.0f / 65536.0f;
        const float sourceX = source->positionX + source->offsetX * inverseSubtile;
        const float sourceY = source->positionY + source->offsetY * inverseSubtile;
        const float targetX = destination->positionX + destination->offsetX * inverseSubtile;
        const float targetY = destination->positionY + destination->offsetY * inverseSubtile;
        const float isoX = (targetX - sourceX) - (targetY - sourceY);
        const float isoY = (targetX - sourceX) + (targetY - sourceY);
        float width{}, height{};
        D3D12::GetDisplaySize(width, height);
        screenX = width * 0.5f + 40.0f + isoX * 30.0f;
        screenY = height * 0.5f - (120.0f - isoY * 12.5f);
        return true;
    }
    __except (EXCEPTION_EXECUTE_HANDLER) {
        return false;
    }
}

bool IsCritical(void* damage) noexcept {
    __try {
        if (!damage) return false;
        const auto flags = *reinterpret_cast<const std::uint16_t*>(static_cast<const std::uint8_t*>(damage) + 4);
        return (flags & CriticalStrikeResultFlag) != 0;
    }
    __except (EXCEPTION_EXECUTE_HANDLER) {
        return false;
    }
}

__declspec(noinline) void __fastcall HookDamageInfo(
    void* game,
    UnitView* attacker,
    UnitView* target,
    std::int32_t baseDamage,
    std::int32_t resistance,
    std::uintptr_t reduction,
    std::int32_t finalDamage,
    const char* typeName,
    void* damage,
    std::uintptr_t finalFlag
) noexcept {
    const std::uint64_t captured = CapturedEvents.fetch_add(1, std::memory_order_relaxed) + 1;
    if (captured == 1 && Context) {
        Context->LogInfo("FloatingDamage captured its first resolved damage event.");
    }
    const FloatingDamage::Element element = ElementFromName(typeName);
    const bool critical = IsCritical(damage);
    OriginalDamageInfo(game, attacker, target, baseDamage, resistance, reduction, finalDamage, typeName, damage, finalFlag);

    const int amount = finalDamage >> 8;
    if (amount <= 0 || !FloatingDamage::GetConfig().enabled) return;
    __try { if (!target || target->unitType != MonsterUnitType) return; }
    __except (EXCEPTION_EXECUTE_HANDLER) { return; }

    float screenX{}, screenY{};
    if (!ComputeScreenPosition(attacker, target, screenX, screenY)) return;
    FloatingDamage::QueueGameDamage(
        amount,
        screenX,
        screenY,
        target->unitType,
        target->unitId,
        critical ? FloatingDamage::Kind::Critical : FloatingDamage::Kind::Normal,
        element);
    const std::uint64_t displayed = DisplayedEvents.fetch_add(1, std::memory_order_relaxed) + 1;
    if (displayed == 1 && Context) {
        Context->LogInfo("FloatingDamage displayed its first player-to-monster damage event.");
    }
}

bool InstallDamageHook() noexcept {
    constexpr std::array<std::uint8_t, 26> expected{
        0x4C, 0x8B, 0xDC, 0x55, 0x53, 0x49, 0x8D, 0xAB, 0x08, 0xFD,
        0xFF, 0xFF, 0x48, 0x81, 0xEC, 0xE8, 0x03, 0x00, 0x00,
        0x48, 0x8B, 0x05, 0x5E, 0x41, 0x5A, 0x02
    };
    return Context->InstallInlineHook(
        DamageInfoRva,
        expected.data(),
        static_cast<std::uint32_t>(expected.size()),
        HookDamageInfo,
        &OriginalDamageInfo);
}

DWORD WINAPI OverlayWorkerMain(void*) noexcept {
    while (WaitForSingleObject(OverlayStopEvent, 500) == WAIT_TIMEOUT) {
        if (!D3D12::InstallHooks()) continue;
        OverlayReady.store(true, std::memory_order_release);
        if (Context) Context->LogInfo("FloatingDamage: DirectX 12 overlay hooks installed after graphics startup.");
        return 0;
    }
    return 0;
}

bool StartOverlayWorker() noexcept {
    OverlayStopEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    if (!OverlayStopEvent) return false;
    OverlayWorker = CreateThread(nullptr, 0, OverlayWorkerMain, nullptr, 0, nullptr);
    if (OverlayWorker) return true;
    CloseHandle(OverlayStopEvent);
    OverlayStopEvent = nullptr;
    return false;
}

auto ConsoleCommand(
    D2R::Game::Client*,
    const D2RL::ConsoleCommandContext* command,
    void*
) noexcept -> D2RL::ConsoleCommandResult {
    if (!command || !command->plugin) return D2RL::ConsoleCommandResult::Failed;
    const std::string action = Lower(Trim(command->args ? std::string_view(command->args, command->argsLength) : std::string_view{}));
    auto& config = FloatingDamage::GetConfig();

    if (action.empty() || action == "status") {
        char message[384]{};
        std::snprintf(
            message,
            sizeof(message),
            "FloatingDamage 1.0.0: enabled=%s; overlay=%s; captured=%llu; displayed=%llu; active=%zu; pending=%zu; font=%d.",
            config.enabled ? "true" : "false",
            OverlayReady.load(std::memory_order_acquire) ? "ready" : "waiting",
            static_cast<unsigned long long>(CapturedEvents.load(std::memory_order_relaxed)),
            static_cast<unsigned long long>(DisplayedEvents.load(std::memory_order_relaxed)),
            FloatingDamage::ActiveCount(),
            FloatingDamage::PendingCount(),
            config.fontIndex);
        command->plugin->WriteConsoleMessage(message);
        return D2RL::ConsoleCommandResult::Handled;
    }
    if (action == "on" || action == "off" || action == "toggle") {
        config.enabled = action == "toggle" ? !config.enabled : action == "on";
        if (!SaveEnabled(config.enabled)) return D2RL::ConsoleCommandResult::Failed;
        command->plugin->WriteConsoleMessage(config.enabled ? "Floating Damage enabled." : "Floating Damage disabled.");
        return D2RL::ConsoleCommandResult::Handled;
    }
    if (action == "preview") {
        float width{}, height{};
        D3D12::GetDisplaySize(width, height);
        FloatingDamage::QueuePreviewBurstAt(width * 0.5f, height * 0.5f);
        command->plugin->WriteConsoleMessage("Floating Damage preview queued.");
        return D2RL::ConsoleCommandResult::Handled;
    }
    if (action == "reload") {
        if (!LoadConfig()) return D2RL::ConsoleCommandResult::Failed;
        command->plugin->WriteConsoleMessage("Floating Damage configuration reloaded.");
        return D2RL::ConsoleCommandResult::Handled;
    }
    if (action == "reset") {
        FloatingDamage::ResetToDefaults();
        if (!Context->WriteConfig(DefaultToml)) return D2RL::ConsoleCommandResult::Failed;
        command->plugin->WriteConsoleMessage("Floating Damage defaults restored and saved.");
        return D2RL::ConsoleCommandResult::Handled;
    }
    command->plugin->WriteConsoleMessage("Usage: floating-damage [status|on|off|toggle|preview|reload|reset].");
    return D2RL::ConsoleCommandResult::InvalidArguments;
}
} // namespace

D2RL_PLUGIN_EXPORT auto D2RLoaderGetPluginInfo() noexcept -> const D2RL::PluginInfo* {
    return &Info;
}

D2RL_PLUGIN_EXPORT auto D2RLoaderLoadPlugin(const D2RL::PluginContext* context) noexcept -> bool {
    if (!context) return false;
    Context = context;
    Base = reinterpret_cast<std::uint8_t*>(GetModuleHandleW(nullptr));
    Module = GetModuleHandleW(L"FloatingDamage.dll");
    if (!Base || !Module) return false;
    if (context->modDataVersionBuild != 0 && context->modDataVersionBuild != SupportedBuild) {
        context->LogError("FloatingDamage: only D2R build 92777 is supported.");
        return false;
    }
    if (!context->EnsureConfig(DefaultToml) || !LoadConfig()) {
        context->LogError("FloatingDamage: configuration could not be created or read.");
        return false;
    }
    if (!InstallDamageHook()) {
        context->LogError("FloatingDamage: D2R 3.2.92777 damage-info signature mismatch; hook refused.");
        return false;
    }
    D3D12::SetDllModule(Module);
    if (!StartOverlayWorker()) {
        context->LogError("FloatingDamage: DirectX 12 overlay worker could not be started.");
        return false;
    }

    D2RL::ConsoleCommandRegistration registration = D2RL::MakeConsoleCommand(
        "floating-damage", ConsoleCommand, "Control Floating Damage and show its status.");
    registration.usage = "floating-damage [status|on|off|toggle|preview|reload|reset]";
    if (!context->RegisterConsoleCommand(registration)) {
        context->LogWarn("FloatingDamage: console command could not be registered.");
    }
    context->LogInfo("FloatingDamage 1.0.0 active for D2R 3.2.92777 with D2RLAN defaults.");
    return true;
}

D2RL_PLUGIN_EXPORT void D2RLoaderUnloadPlugin() noexcept {
    if (Context) {
        char message[192]{};
        std::snprintf(
            message,
            sizeof(message),
            "FloatingDamage stopped: captured=%llu; displayed=%llu.",
            static_cast<unsigned long long>(CapturedEvents.load(std::memory_order_relaxed)),
            static_cast<unsigned long long>(DisplayedEvents.load(std::memory_order_relaxed)));
        Context->LogInfo(message);
    }
    if (OverlayStopEvent) SetEvent(OverlayStopEvent);
    if (OverlayWorker) {
        WaitForSingleObject(OverlayWorker, 3000);
        CloseHandle(OverlayWorker);
        OverlayWorker = nullptr;
    }
    if (OverlayStopEvent) {
        CloseHandle(OverlayStopEvent);
        OverlayStopEvent = nullptr;
    }
    D3D12::RemoveHooks();
    OverlayReady.store(false, std::memory_order_release);
    Context = nullptr;
}
