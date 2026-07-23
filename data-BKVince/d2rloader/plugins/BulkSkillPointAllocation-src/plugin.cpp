#define NOMINMAX
#include <D2RLPlugin/api.h>
#include <nlohmann/json.hpp>
#include "allocation_policy.hpp"

#include <Windows.h>

#include <array>
#include <atomic>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <mutex>
#include <string>
#include <vector>

namespace {
using tcp::bulk_skills::AllocationMode;
using tcp::bulk_skills::AssignAllSkillPointsExtra;
using tcp::bulk_skills::ClampSkillPointsPerCtrlClick;
using tcp::bulk_skills::DefaultSkillPointsPerCtrlClick;
using tcp::bulk_skills::NativeSkillPacketExtra;
using tcp::bulk_skills::ResolveMode;

constexpr std::uint32_t SupportedBuild = 92777;
constexpr std::uintptr_t SendFiveBytePacketRva = 0x0EC700;
constexpr std::uintptr_t IsVirtualKeyDownRva = 0x120A100;
constexpr std::uintptr_t GetLocalizedStringByKeyRva = 0x5F4B90;
constexpr std::uintptr_t ShowAssignAllStatsConfirmationRva = 0x14EF670;
constexpr std::uintptr_t UiDispatchMessageRva = 0x843D90;
constexpr std::uint8_t AllocateSkillOpcode = 0x3B;
constexpr std::int32_t SkillConfirmationSentinel = 0x42534B50;
constexpr std::size_t FakeStatWidgetSize = 0xB90;
constexpr std::size_t FakeStatIndexOffset = 0xB88;
constexpr std::size_t MessagePayloadOffset = 0x110;
constexpr char AssignAllStatPointsConfirmationKey[] = "AssignAllStatPointsConfirmation";
constexpr char DefaultShiftConfirmationLocalizationKey[] = "shiftConfirmation";
constexpr char DefaultShiftConfirmation[] =
    "Invest all currently usable skill points in this skill?";

constexpr wchar_t ConfigFileName[] = L"BulkSkillPointAllocation.json";
constexpr wchar_t StringsFileName[] = L"BulkSkillPointAllocation.strings.json";

struct GameStringView {
    const char* data{};
    std::size_t size{};
};

struct Config {
    std::uint32_t skillPointsPerCtrlClick{DefaultSkillPointsPerCtrlClick};
    bool diagnostics{};
    std::string shiftConfirmationKey{DefaultShiftConfirmationLocalizationKey};
    std::string shiftConfirmationFallback{DefaultShiftConfirmation};
};

struct PendingConfirmationState {
    bool active{};
    std::uint16_t skillId{};
};

using SendFiveBytePacketFn = void(__fastcall*)(std::uint8_t, std::uint16_t, std::uint16_t) noexcept;
using IsVirtualKeyDownFn = std::uint32_t(__fastcall*)(std::int32_t) noexcept;
using GetLocalizedStringByKeyFn = const char*(__fastcall*)(const GameStringView*) noexcept;
using ShowAssignAllStatsConfirmationFn = void(__fastcall*)(const void*) noexcept;
using UiDispatchMessageFn = void(__fastcall*)(void*) noexcept;

const D2RL::PluginContext* Context{};
std::uint8_t* Base{};
Config Settings{};
std::string LoadedConfigPath{"built-in defaults"};
SendFiveBytePacketFn OriginalSendFiveBytePacket{};
IsVirtualKeyDownFn IsVirtualKeyDown{};
GetLocalizedStringByKeyFn OriginalGetLocalizedStringByKey{};
ShowAssignAllStatsConfirmationFn ShowAssignAllStatsConfirmation{};
UiDispatchMessageFn OriginalUiDispatchMessage{};

std::mutex ConfirmationMutex;
PendingConfirmationState PendingConfirmation{};
alignas(16) std::array<std::uint8_t, FakeStatWidgetSize> FakeStatWidget{};
thread_local bool OpeningSkillConfirmation{};

std::atomic<std::uint64_t> SingleClicks{};
std::atomic<std::uint64_t> CtrlBatches{};
std::atomic<std::uint64_t> ShiftAccepted{};
std::atomic<std::uint64_t> ShiftCancelled{};
std::atomic<std::uint64_t> NativeBulkPacketsSent{};
std::atomic<std::uint32_t> LastModifierMask{};
std::atomic<std::uint16_t> LastIncomingExtra{};
std::atomic<std::uint16_t> LastOutgoingExtra{};

enum ModifierMask : std::uint32_t {
    NativeCtrl = 1U << 0,
    NativeLeftCtrl = 1U << 1,
    NativeRightCtrl = 1U << 2,
    Win32Ctrl = 1U << 3,
    Win32LeftCtrl = 1U << 4,
    Win32RightCtrl = 1U << 5,
    PacketShift = 1U << 6,
};

constexpr D2RL::PluginInfo Info{
    .infoSize = D2RL::PluginInfoSize,
    .apiVersion = D2RL_PLUGIN_API_VERSION,
    .id = "bulk-skill-point-allocation",
    .name = "Bulk Skill Point Allocation",
    .version = "1.2.2",
    .author = "RuffnecKk",
    .description = "Adds fast Ctrl and confirmed Shift skill allocation.",
    .flags = D2RL::PluginFlags::NativeHooks,
};

template<class T>
T At(std::uintptr_t rva) noexcept {
    return reinterpret_cast<T>(Base + rva);
}

std::vector<std::filesystem::path> ConfigCandidates(const wchar_t* fileName) {
    std::vector<std::filesystem::path> candidates;
    if (Context && Context->modDirectory && Context->modDirectory[0] != L'\0') {
        candidates.emplace_back(std::filesystem::path(Context->modDirectory) / fileName);
    }
    candidates.emplace_back(fileName);
    return candidates;
}

bool LoadConfig() noexcept {
    Settings = {};
    LoadedConfigPath = "built-in defaults";

    bool malformedConfigFound{};
    for (const auto& path : ConfigCandidates(ConfigFileName)) {
        std::error_code error;
        if (!std::filesystem::is_regular_file(path, error)) continue;

        try {
            std::ifstream input(path);
            if (!input.is_open()) continue;
            const auto config = nlohmann::json::parse(input, nullptr, true, true);
            if (!config.is_object()) {
                throw nlohmann::json::type_error::create(302, "configuration root must be an object", &config);
            }

            const auto configuredPoints = config.value(
                "skillPointsPerCtrlClick",
                DefaultSkillPointsPerCtrlClick
            );
            Settings.skillPointsPerCtrlClick = ClampSkillPointsPerCtrlClick(configuredPoints);
            Settings.diagnostics = config.value("diagnostics", false);
            LoadedConfigPath = path.string();
            return true;
        } catch (const std::exception& exception) {
            malformedConfigFound = true;
            if (Context) {
                const auto message = std::string("BulkSkillPointAllocation: invalid ")
                    + path.string() + " (" + exception.what() + ").";
                Context->LogError(message.c_str());
            }
        }
    }

    return !malformedConfigFound;
}

bool LoadStrings() noexcept {
    for (const auto& path : ConfigCandidates(StringsFileName)) {
        std::error_code error;
        if (!std::filesystem::is_regular_file(path, error)) continue;

        try {
            std::ifstream input(path);
            if (!input.is_open()) continue;
            const auto strings = nlohmann::json::parse(input, nullptr, true, true);
            if (!strings.is_object()) {
                throw nlohmann::json::type_error::create(
                    302,
                    "strings root must be an object",
                    &strings
                );
            }
            const auto localizationKey = strings.value(
                "shiftConfirmationKey",
                std::string{DefaultShiftConfirmationLocalizationKey}
            );
            if (localizationKey.empty() || localizationKey.size() > 255) {
                throw nlohmann::json::out_of_range::create(
                    401,
                    "shiftConfirmationKey must contain 1 through 255 UTF-8 bytes",
                    &strings
                );
            }
            const auto fallback = strings.value(
                "shiftConfirmationFallback",
                std::string{DefaultShiftConfirmation}
            );
            if (fallback.empty() || fallback.size() > 1024) {
                throw nlohmann::json::out_of_range::create(
                    401,
                    "shiftConfirmationFallback must contain 1 through 1024 UTF-8 bytes",
                    &strings
                );
            }
            Settings.shiftConfirmationKey = localizationKey;
            Settings.shiftConfirmationFallback = fallback;
            return true;
        } catch (const std::exception& exception) {
            if (Context) {
                const auto message = std::string("BulkSkillPointAllocation: invalid ")
                    + path.string() + " (" + exception.what() + ").";
                Context->LogError(message.c_str());
            }
            return false;
        }
    }
    return true;
}

const char* __fastcall HookGetLocalizedStringByKey(
    const GameStringView* key
) noexcept {
    constexpr std::size_t expectedLength = sizeof(AssignAllStatPointsConfirmationKey) - 1;
    if (OpeningSkillConfirmation
        && key
        && key->data
        && key->size == expectedLength
        && std::memcmp(
            key->data,
            AssignAllStatPointsConfirmationKey,
            expectedLength
        ) == 0) {
        const GameStringView localizedKey{
            .data = Settings.shiftConfirmationKey.data(),
            .size = Settings.shiftConfirmationKey.size(),
        };
        const auto localized = OriginalGetLocalizedStringByKey(&localizedKey);
        if (localized
            && localized[0] != '\0'
            && std::strcmp(localized, Settings.shiftConfirmationKey.c_str()) != 0) {
            return localized;
        }
        return Settings.shiftConfirmationFallback.c_str();
    }
    return OriginalGetLocalizedStringByKey(key);
}

bool CancelPendingConfirmation() noexcept {
    std::scoped_lock lock(ConfirmationMutex);
    if (!PendingConfirmation.active) return false;
    PendingConfirmation = {};
    return true;
}

void ShowShiftConfirmation(std::uint16_t skillId) noexcept {
    {
        std::scoped_lock lock(ConfirmationMutex);
        if (PendingConfirmation.active) ++ShiftCancelled;
        PendingConfirmation = {
            .active = true,
            .skillId = skillId,
        };
    }

    std::int32_t sentinel = SkillConfirmationSentinel;
    std::memcpy(
        FakeStatWidget.data() + FakeStatIndexOffset,
        &sentinel,
        sizeof(sentinel)
    );
    OpeningSkillConfirmation = true;
    ShowAssignAllStatsConfirmation(FakeStatWidget.data());
    OpeningSkillConfirmation = false;
}

bool ReadMessagePayload(
    void* message,
    std::int32_t& statIndex,
    std::int32_t& mode
) noexcept {
    if (!message) return false;
    __try {
        const auto payload = *reinterpret_cast<std::uint8_t**>(
            static_cast<std::uint8_t*>(message) + MessagePayloadOffset
        );
        if (!payload) return false;
        std::memcpy(&statIndex, payload, sizeof(statIndex));
        std::memcpy(&mode, payload + sizeof(statIndex), sizeof(mode));
        return true;
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        return false;
    }
}

bool Win32KeyDown(std::int32_t virtualKey) noexcept {
    return (GetAsyncKeyState(virtualKey) & 0x8000) != 0
        || (GetKeyState(virtualKey) & 0x8000) != 0;
}

std::uint32_t ReadModifierMask(std::uint16_t packetExtra) noexcept {
    std::uint32_t mask{};
    if (IsVirtualKeyDown(VK_CONTROL) != 0) mask |= NativeCtrl;
    if (IsVirtualKeyDown(VK_LCONTROL) != 0) mask |= NativeLeftCtrl;
    if (IsVirtualKeyDown(VK_RCONTROL) != 0) mask |= NativeRightCtrl;
    if (Win32KeyDown(VK_CONTROL)) mask |= Win32Ctrl;
    if (Win32KeyDown(VK_LCONTROL)) mask |= Win32LeftCtrl;
    if (Win32KeyDown(VK_RCONTROL)) mask |= Win32RightCtrl;
    if (packetExtra == AssignAllSkillPointsExtra) mask |= PacketShift;
    return mask;
}

void BeginBulkAllocation(
    AllocationMode mode,
    std::uint16_t skillId
) noexcept {
    const auto requested = mode == AllocationMode::ShiftAll
        ? 1U
        : Settings.skillPointsPerCtrlClick;
    const auto nativeBulkExtra = NativeSkillPacketExtra(mode, requested);
    LastOutgoingExtra.store(nativeBulkExtra, std::memory_order_relaxed);
    OriginalSendFiveBytePacket(AllocateSkillOpcode, skillId, nativeBulkExtra);
    ++NativeBulkPacketsSent;

    if (Settings.diagnostics && Context) {
        char message[192]{};
        std::snprintf(
            message,
            sizeof(message),
            "BulkSkillPointAllocation native bulk: mode=%s skill=%u requested=%u extra=0x%04X.",
            mode == AllocationMode::ShiftAll ? "shift-all" : "ctrl",
            static_cast<unsigned>(skillId),
            requested,
            static_cast<unsigned>(nativeBulkExtra)
        );
        Context->LogInfo(message);
    }
}

void __fastcall HookUiDispatchMessage(void* message) noexcept {
    std::int32_t statIndex{};
    std::int32_t mode{};
    const bool payloadRead = ReadMessagePayload(message, statIndex, mode);
    bool confirmationPending{};
    {
        std::scoped_lock lock(ConfirmationMutex);
        confirmationPending = PendingConfirmation.active;
    }
    if (Settings.diagnostics
        && Context
        && confirmationPending
        && payloadRead
        && statIndex == SkillConfirmationSentinel) {
        char diagnostic[192]{};
        std::snprintf(
            diagnostic,
            sizeof(diagnostic),
            "BulkSkillPointAllocation UI dispatch: payload=%s stat=0x%08X mode=%d pending=%s opening=%s.",
            payloadRead ? "yes" : "no",
            static_cast<unsigned>(statIndex),
            mode,
            confirmationPending ? "yes" : "no",
            OpeningSkillConfirmation ? "yes" : "no"
        );
        Context->LogInfo(diagnostic);
    }
    if (OpeningSkillConfirmation
        || !payloadRead
        || statIndex != SkillConfirmationSentinel) {
        OriginalUiDispatchMessage(message);
        return;
    }

    PendingConfirmationState pending;
    {
        std::scoped_lock lock(ConfirmationMutex);
        pending = PendingConfirmation;
        PendingConfirmation = {};
    }
    if (!pending.active) return;

    ++ShiftAccepted;
    BeginBulkAllocation(AllocationMode::ShiftAll, pending.skillId);
}

void __fastcall HookSendFiveBytePacket(
    std::uint8_t opcode,
    std::uint16_t value,
    std::uint16_t extra
) noexcept {
    if (opcode != AllocateSkillOpcode) {
        OriginalSendFiveBytePacket(opcode, value, extra);
        return;
    }

    const auto modifierMask = ReadModifierMask(extra);
    LastModifierMask.store(modifierMask, std::memory_order_relaxed);
    LastIncomingExtra.store(extra, std::memory_order_relaxed);
    const bool shiftPressed = (modifierMask & PacketShift) != 0;
    const bool ctrlPressed = (modifierMask & (
        NativeCtrl | NativeLeftCtrl | NativeRightCtrl
        | Win32Ctrl | Win32LeftCtrl | Win32RightCtrl
    )) != 0;
    const auto mode = ResolveMode(shiftPressed, ctrlPressed);
    if (mode == AllocationMode::Single) {
        if (CancelPendingConfirmation()) ++ShiftCancelled;
        ++SingleClicks;
        LastOutgoingExtra.store(extra, std::memory_order_relaxed);
        OriginalSendFiveBytePacket(opcode, value, extra);
        return;
    }

    if (mode == AllocationMode::ShiftAll) {
        ShowShiftConfirmation(value);
        return;
    } else {
        if (CancelPendingConfirmation()) ++ShiftCancelled;
        ++CtrlBatches;
    }
    BeginBulkAllocation(mode, value);
}

D2RL::ConsoleCommandResult __cdecl Status(
    D2R::Game::Client*,
    const D2RL::ConsoleCommandContext* command,
    void*
) noexcept {
    if (!command || !command->plugin) return D2RL::ConsoleCommandResult::Failed;

    PendingConfirmationState confirmation;
    {
        std::scoped_lock lock(ConfirmationMutex);
        confirmation = PendingConfirmation;
    }
    char message[640]{};
    std::snprintf(
        message,
        sizeof(message),
        "BulkSkillPointAllocation 1.2.2: native modal and native bulk; ctrl skill points=%u; confirmation=%s; localization key=%s; last modifiers=0x%02X; incoming extra=0x%04X; outgoing extra=0x%04X; single=%llu; ctrl batches=%llu; shift confirmed=%llu; shift superseded=%llu; native bulk packets=%llu.",
        Settings.skillPointsPerCtrlClick,
        confirmation.active ? "pending" : "idle",
        Settings.shiftConfirmationKey.c_str(),
        static_cast<unsigned>(LastModifierMask.load(std::memory_order_relaxed)),
        static_cast<unsigned>(LastIncomingExtra.load(std::memory_order_relaxed)),
        static_cast<unsigned>(LastOutgoingExtra.load(std::memory_order_relaxed)),
        static_cast<unsigned long long>(SingleClicks.load()),
        static_cast<unsigned long long>(CtrlBatches.load()),
        static_cast<unsigned long long>(ShiftAccepted.load()),
        static_cast<unsigned long long>(ShiftCancelled.load()),
        static_cast<unsigned long long>(NativeBulkPacketsSent.load())
    );
    command->plugin->WriteConsoleMessage(message);
    return D2RL::ConsoleCommandResult::Handled;
}

bool ValidateRuntime() noexcept {
    constexpr std::array<std::uint8_t, 29> sendPacketExpected{
        0x48, 0x83, 0xEC, 0x28, 0x88, 0x4C, 0x24, 0x48,
        0x48, 0x8D, 0x4C, 0x24, 0x48, 0x66, 0x89, 0x54,
        0x24, 0x49, 0xBA, 0x05, 0x00, 0x00, 0x00, 0x66,
        0x44, 0x89, 0x44, 0x24, 0x4B
    };
    constexpr std::array<std::uint8_t, 21> isVirtualKeyDownExpected{
        0x48, 0x83, 0xEC, 0x28, 0xFF, 0x15, 0x86, 0x6E,
        0xAA, 0x00, 0xC1, 0xE8, 0x0F, 0x83, 0xE0, 0x01,
        0x48, 0x83, 0xC4, 0x28, 0xC3
    };
    constexpr std::array<std::uint8_t, 29> localizedStringByKeyExpected{
        0x4C, 0x8B, 0xDC, 0x55, 0x53, 0x57, 0x49, 0x8D,
        0x6B, 0xA1, 0x48, 0x81, 0xEC, 0xB0, 0x00, 0x00,
        0x00, 0x48, 0x8B, 0x05, 0x20, 0x67, 0x3D, 0x02,
        0x48, 0x33, 0xC4, 0x48, 0x89
    };
    constexpr std::array<std::uint8_t, 29> statsConfirmationExpected{
        0x48, 0x89, 0x5C, 0x24, 0x18, 0x48, 0x89, 0x74,
        0x24, 0x20, 0x55, 0x57, 0x41, 0x55, 0x41, 0x56,
        0x41, 0x57, 0x48, 0x8D, 0xAC, 0x24, 0x70, 0xFC,
        0xFF, 0xFF, 0x48, 0x81, 0xEC
    };
    constexpr std::array<std::uint8_t, 29> uiDispatchExpected{
        0x40, 0x53, 0x56, 0x57, 0x48, 0x83, 0xEC, 0x20,
        0x4C, 0x89, 0x7C, 0x24, 0x58, 0x4C, 0x8B, 0xF9,
        0xE8, 0x7B, 0x1C, 0xA6, 0x00, 0x0F, 0xB6, 0x90,
        0x18, 0x01, 0x00, 0x00, 0x84
    };
    return Context->CheckExpectedBytes(SendFiveBytePacketRva, sendPacketExpected.data(), sendPacketExpected.size())
        && Context->CheckExpectedBytes(IsVirtualKeyDownRva, isVirtualKeyDownExpected.data(), isVirtualKeyDownExpected.size())
        && Context->CheckExpectedBytes(GetLocalizedStringByKeyRva, localizedStringByKeyExpected.data(), localizedStringByKeyExpected.size())
        && Context->CheckExpectedBytes(ShowAssignAllStatsConfirmationRva, statsConfirmationExpected.data(), statsConfirmationExpected.size())
        && Context->CheckExpectedBytes(UiDispatchMessageRva, uiDispatchExpected.data(), uiDispatchExpected.size());
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
        context->LogError("BulkSkillPointAllocation: only D2R build 92777 is supported.");
        return false;
    }
    if (!LoadConfig()) {
        context->LogError("BulkSkillPointAllocation: configuration could not be loaded.");
        return false;
    }
    if (!LoadStrings()) {
        context->LogError("BulkSkillPointAllocation: strings configuration could not be loaded.");
        return false;
    }

    IsVirtualKeyDown = At<IsVirtualKeyDownFn>(IsVirtualKeyDownRva);
    ShowAssignAllStatsConfirmation = At<ShowAssignAllStatsConfirmationFn>(
        ShowAssignAllStatsConfirmationRva
    );
    if (!ValidateRuntime()) {
        context->LogError("BulkSkillPointAllocation: 92777 runtime signature mismatch; plugin refused.");
        return false;
    }

    constexpr std::array<std::uint8_t, 29> localizedStringByKeyExpected{
        0x4C, 0x8B, 0xDC, 0x55, 0x53, 0x57, 0x49, 0x8D,
        0x6B, 0xA1, 0x48, 0x81, 0xEC, 0xB0, 0x00, 0x00,
        0x00, 0x48, 0x8B, 0x05, 0x20, 0x67, 0x3D, 0x02,
        0x48, 0x33, 0xC4, 0x48, 0x89
    };
    if (!context->InstallInlineHook(
            GetLocalizedStringByKeyRva,
            localizedStringByKeyExpected.data(),
            static_cast<std::uint32_t>(localizedStringByKeyExpected.size()),
            HookGetLocalizedStringByKey,
            &OriginalGetLocalizedStringByKey
        )) {
        context->LogError("BulkSkillPointAllocation: localized-string hook installation failed.");
        return false;
    }

    constexpr std::array<std::uint8_t, 29> uiDispatchExpected{
        0x40, 0x53, 0x56, 0x57, 0x48, 0x83, 0xEC, 0x20,
        0x4C, 0x89, 0x7C, 0x24, 0x58, 0x4C, 0x8B, 0xF9,
        0xE8, 0x7B, 0x1C, 0xA6, 0x00, 0x0F, 0xB6, 0x90,
        0x18, 0x01, 0x00, 0x00, 0x84
    };
    if (!context->InstallInlineHook(
            UiDispatchMessageRva,
            uiDispatchExpected.data(),
            static_cast<std::uint32_t>(uiDispatchExpected.size()),
            HookUiDispatchMessage,
            &OriginalUiDispatchMessage
        )) {
        context->LogError("BulkSkillPointAllocation: UI-dispatch hook installation failed.");
        return false;
    }

    constexpr std::array<std::uint8_t, 29> sendPacketExpected{
        0x48, 0x83, 0xEC, 0x28, 0x88, 0x4C, 0x24, 0x48,
        0x48, 0x8D, 0x4C, 0x24, 0x48, 0x66, 0x89, 0x54,
        0x24, 0x49, 0xBA, 0x05, 0x00, 0x00, 0x00, 0x66,
        0x44, 0x89, 0x44, 0x24, 0x4B
    };
    if (!context->InstallInlineHook(
            SendFiveBytePacketRva,
            sendPacketExpected.data(),
            static_cast<std::uint32_t>(sendPacketExpected.size()),
            HookSendFiveBytePacket,
            &OriginalSendFiveBytePacket
        )) {
        context->LogError("BulkSkillPointAllocation: skill-packet hook installation failed.");
        return false;
    }

    if (!context->RegisterConsoleCommand(
            "bulk-skill-points",
            Status,
            "Show bulk skill allocation settings and counters."
        )) {
        context->LogWarn("BulkSkillPointAllocation: status command could not be registered.");
    }
    const auto activeMessage = std::string(
        "BulkSkillPointAllocation 1.2.2 active for D2R 3.2.92777 "
        "(native confirmation modal; standalone DLL; JSON config: "
    ) + LoadedConfigPath + "; native bulk enabled).";
    context->LogInfo(activeMessage.c_str());
    return true;
}

D2RL_PLUGIN_EXPORT void D2RLoaderUnloadPlugin() noexcept {
    CancelPendingConfirmation();
    OpeningSkillConfirmation = false;
    Context = nullptr;
}
