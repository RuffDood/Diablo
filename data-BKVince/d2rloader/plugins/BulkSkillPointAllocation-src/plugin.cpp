#define NOMINMAX
#include <D2RLPlugin/api.h>
#include <nlohmann/json.hpp>
#include "allocation_policy.hpp"

#include <Windows.h>

#include <array>
#include <algorithm>
#include <atomic>
#include <chrono>
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
using tcp::bulk_skills::ClampSkillPointsPerCtrlClick;
using tcp::bulk_skills::DefaultSkillPointsPerCtrlClick;
using tcp::bulk_skills::RequestedSkillPoints;
using tcp::bulk_skills::ResolveMode;

constexpr std::uint32_t SupportedBuild = 92777;
constexpr std::uintptr_t SendFiveBytePacketRva = 0x0EC700;
constexpr std::uintptr_t IsVirtualKeyDownRva = 0x120A100;
constexpr std::uintptr_t CanAllocateSkillRva = 0x14C3DA0;
constexpr std::uintptr_t GetLocalDataContextRva = 0x08B2D0;
constexpr std::uintptr_t GetLocalPlayerRva = 0x09A480;
constexpr std::uintptr_t GetUnitDataContextRva = 0x34A0E0;
constexpr std::uintptr_t GetSkillByIdRva = 0x33DCD0;
constexpr std::uintptr_t GetSkillLevelRva = 0x33D1E0;
constexpr std::uintptr_t GetRuntimeMaxSkillLevelRva = 0x214220;
constexpr std::uintptr_t GetUnitBaseStatRva = 0x2F48C0;
constexpr std::uint8_t AllocateSkillOpcode = 0x3B;
constexpr std::uint16_t ShiftAllocateExtra = 0xFFFF;
constexpr UINT_PTR QueueTimerId = 0x42534B4C;
constexpr std::chrono::milliseconds PollInterval{20};
constexpr std::chrono::milliseconds ServerSyncTimeout{2'000};
constexpr std::int32_t UnspentSkillPointsStat = 5;

constexpr wchar_t ConfigFileName[] = L"BulkSkillPointAllocation.json";

struct Config {
    std::uint32_t skillPointsPerCtrlClick{DefaultSkillPointsPerCtrlClick};
    bool diagnostics{};
};

struct QueueState {
    bool active{};
    bool processing{};
    std::uint16_t skillId{};
    std::uint16_t packetExtra{};
    std::uint32_t remaining{};
    std::int32_t observedBaseLevel{};
    std::int32_t observedUnspentPoints{};
    std::chrono::steady_clock::time_point deadline{};
    std::uint64_t generation{};
};

using SendFiveBytePacketFn = void(__fastcall*)(std::uint8_t, std::uint16_t, std::uint16_t) noexcept;
using IsVirtualKeyDownFn = std::uint32_t(__fastcall*)(std::int32_t) noexcept;
using CanAllocateSkillFn = bool(__fastcall*)(std::int32_t) noexcept;
using GetLocalDataContextFn = std::int32_t(__fastcall*)() noexcept;
using GetLocalPlayerFn = void*(__fastcall*)(std::int32_t) noexcept;
using GetUnitDataContextFn = std::uint8_t(__fastcall*)(void*) noexcept;
using GetSkillByIdFn = void*(__fastcall*)(void*, std::int32_t, std::int32_t) noexcept;
using GetSkillLevelFn = std::int32_t(__fastcall*)(void*, void*, std::int32_t, std::int32_t) noexcept;
using GetRuntimeMaxSkillLevelFn = std::int32_t(__fastcall*)(std::uint8_t, std::int32_t) noexcept;
using GetUnitBaseStatFn = std::int32_t(__fastcall*)(void*, std::int32_t, std::uint16_t) noexcept;

const D2RL::PluginContext* Context{};
std::uint8_t* Base{};
Config Settings{};
std::string LoadedConfigPath{"built-in defaults"};
SendFiveBytePacketFn OriginalSendFiveBytePacket{};
IsVirtualKeyDownFn IsVirtualKeyDown{};
CanAllocateSkillFn CanAllocateSkill{};
GetLocalDataContextFn GetLocalDataContext{};
GetLocalPlayerFn GetLocalPlayer{};
GetUnitDataContextFn GetUnitDataContext{};
GetSkillByIdFn GetSkillById{};
GetSkillLevelFn GetSkillLevel{};
GetRuntimeMaxSkillLevelFn GetRuntimeMaxSkillLevel{};
GetUnitBaseStatFn GetUnitBaseStat{};

std::mutex QueueMutex;
QueueState Queue{};
HWND QueueTimerWindow{};
std::uint64_t NextQueueGeneration{};

std::atomic<std::uint64_t> SingleClicks{};
std::atomic<std::uint64_t> CtrlBatches{};
std::atomic<std::uint64_t> ShiftAccepted{};
std::atomic<std::uint64_t> ShiftCancelled{};
std::atomic<std::uint64_t> QueuedPointsSent{};
std::atomic<std::uint64_t> CompletedBatches{};
std::atomic<std::uint64_t> RuleStops{};
std::atomic<std::uint64_t> SyncTimeouts{};
std::atomic<std::uint32_t> LastModifierMask{};
std::atomic<std::uint16_t> LastPacketExtra{};

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
    .version = "1.1.0",
    .author = "RuffnecKk",
    .description = "Adds configurable bulk skill allocation with Ctrl and Shift clicks.",
    .flags = D2RL::PluginFlags::NativeHooks,
};

template<class T>
T At(std::uintptr_t rva) noexcept {
    return reinterpret_cast<T>(Base + rva);
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

void* LocalPlayer() noexcept {
    return GetLocalPlayer ? GetLocalPlayer(GetLocalDataContext()) : nullptr;
}

std::int32_t CurrentBaseLevel(std::uint16_t skillId) noexcept {
    void* player = LocalPlayer();
    if (!player) return -1;
    void* skill = GetSkillById(player, skillId, -1);
    return skill ? GetSkillLevel(player, skill, 0, 0) : 0;
}

std::int32_t RuntimeMaxLevel(std::uint16_t skillId) noexcept {
    void* player = LocalPlayer();
    if (!player) return 0;
    return GetRuntimeMaxSkillLevel(GetUnitDataContext(player), skillId);
}

std::int32_t CurrentUnspentSkillPoints() noexcept {
    void* player = LocalPlayer();
    return player ? GetUnitBaseStat(player, UnspentSkillPointsStat, 0) : -1;
}

BOOL CALLBACK FindGameWindow(HWND window, LPARAM output) noexcept {
    DWORD processId{};
    GetWindowThreadProcessId(window, &processId);
    if (processId != GetCurrentProcessId() || !IsWindowVisible(window) || GetWindow(window, GW_OWNER)) {
        return TRUE;
    }
    *reinterpret_cast<HWND*>(output) = window;
    return FALSE;
}

bool ConfirmShiftAllocation() noexcept {
    HWND owner{};
    EnumWindows(FindGameWindow, reinterpret_cast<LPARAM>(&owner));
    const int result = MessageBoxW(
        owner,
        L"Invest all currently usable skill points in this skill?",
        L"Allocate Skill Points",
        MB_YESNO | MB_ICONQUESTION | MB_DEFBUTTON2 | MB_SETFOREGROUND
    );
    return result == IDYES;
}

void LogQueueDiagnostic(
    const char* event,
    std::uint16_t skillId,
    std::int32_t currentBaseLevel,
    std::int32_t observedBaseLevel,
    std::int32_t currentUnspentPoints,
    std::int32_t observedUnspentPoints,
    std::uint32_t remaining,
    std::uint64_t generation
) noexcept {
    if (!Settings.diagnostics || !Context) return;
    char message[320]{};
    std::snprintf(
        message,
        sizeof(message),
        "BulkSkillPointAllocation queue: event=%s skill=%u current=%d observed=%d points=%d observed_points=%d remaining=%u generation=%llu.",
        event,
        static_cast<unsigned>(skillId),
        currentBaseLevel,
        observedBaseLevel,
        currentUnspentPoints,
        observedUnspentPoints,
        remaining,
        static_cast<unsigned long long>(generation)
    );
    Context->LogInfo(message);
}

void StopActiveQueue() noexcept {
    HWND timerWindow{};
    {
        std::scoped_lock lock(QueueMutex);
        Queue = {};
        timerWindow = QueueTimerWindow;
        QueueTimerWindow = nullptr;
    }
    if (timerWindow) KillTimer(timerWindow, QueueTimerId);
}

void CALLBACK QueueTimerProc(HWND window, UINT, UINT_PTR timerId, DWORD) noexcept;

void StartQueue(
    std::uint16_t skillId,
    std::uint16_t packetExtra,
    std::uint32_t requestedRanks,
    std::int32_t currentBaseLevel,
    std::int32_t currentUnspentPoints
) noexcept {
    HWND timerWindow{};
    EnumWindows(FindGameWindow, reinterpret_cast<LPARAM>(&timerWindow));
    const bool needsTimer = requestedRanks > 1;
    const bool timerStarted = !needsTimer || (
        timerWindow
        && SetTimer(timerWindow, QueueTimerId,
            static_cast<UINT>(PollInterval.count()), QueueTimerProc) != 0
    );
    std::uint64_t generation{};
    {
        std::scoped_lock lock(QueueMutex);
        generation = ++NextQueueGeneration;
        Queue = {
            .active = needsTimer && timerStarted,
            .processing = false,
            .skillId = skillId,
            .packetExtra = packetExtra,
            .remaining = requestedRanks > 0 ? requestedRanks - 1 : 0,
            .observedBaseLevel = currentBaseLevel,
            .observedUnspentPoints = currentUnspentPoints,
            .deadline = std::chrono::steady_clock::now()
                + ServerSyncTimeout,
            .generation = generation,
        };
        QueueTimerWindow = Queue.active ? timerWindow : nullptr;
    }
    LogQueueDiagnostic(
        timerStarted ? "started" : "timer-failed",
        skillId,
        currentBaseLevel,
        currentBaseLevel,
        currentUnspentPoints,
        currentUnspentPoints,
        requestedRanks > 0 ? requestedRanks - 1 : 0,
        generation
    );
    if (needsTimer && !timerStarted && Settings.diagnostics && Context) {
        Context->LogWarn("BulkSkillPointAllocation: client-thread queue timer could not be started; sending one vanilla rank only.");
    }
}

void CALLBACK QueueTimerProc(HWND window, UINT, UINT_PTR timerId, DWORD) noexcept {
    if (timerId != QueueTimerId) return;

    std::unique_lock lock(QueueMutex);
    if (!Queue.active || QueueTimerWindow != window) {
        lock.unlock();
        KillTimer(window, QueueTimerId);
        return;
    }
    if (Queue.processing) return;

    Queue.processing = true;
    const auto queued = Queue;
    lock.unlock();
    const auto currentBaseLevel = CurrentBaseLevel(queued.skillId);
    const auto currentUnspentPoints = CurrentUnspentSkillPoints();
    const auto now = std::chrono::steady_clock::now();
    lock.lock();

    if (!Queue.active || Queue.generation != queued.generation) return;
    if (currentBaseLevel == queued.observedBaseLevel) {
        if (now < queued.deadline) {
            Queue.processing = false;
            return;
        }
        Queue = {};
        QueueTimerWindow = nullptr;
        ++SyncTimeouts;
        lock.unlock();
        LogQueueDiagnostic("timeout", queued.skillId, currentBaseLevel,
            queued.observedBaseLevel, currentUnspentPoints,
            queued.observedUnspentPoints, queued.remaining, queued.generation);
        KillTimer(window, QueueTimerId);
        return;
    }

    if (currentBaseLevel != queued.observedBaseLevel + 1) {
        Queue = {};
        QueueTimerWindow = nullptr;
        ++RuleStops;
        lock.unlock();
        LogQueueDiagnostic("non-monotone-ack", queued.skillId, currentBaseLevel,
            queued.observedBaseLevel, currentUnspentPoints,
            queued.observedUnspentPoints, queued.remaining, queued.generation);
        KillTimer(window, QueueTimerId);
        return;
    }

    if (currentUnspentPoints < 0
        || currentUnspentPoints >= queued.observedUnspentPoints) {
        if (now < queued.deadline) {
            Queue.processing = false;
            return;
        }
        Queue = {};
        QueueTimerWindow = nullptr;
        ++SyncTimeouts;
        lock.unlock();
        LogQueueDiagnostic("points-timeout", queued.skillId, currentBaseLevel,
            queued.observedBaseLevel, currentUnspentPoints,
            queued.observedUnspentPoints, queued.remaining, queued.generation);
        KillTimer(window, QueueTimerId);
        return;
    }

    if (Queue.remaining == 0) {
        Queue = {};
        QueueTimerWindow = nullptr;
        ++CompletedBatches;
        lock.unlock();
        LogQueueDiagnostic("completed", queued.skillId, currentBaseLevel,
            queued.observedBaseLevel, currentUnspentPoints,
            queued.observedUnspentPoints, queued.remaining, queued.generation);
        KillTimer(window, QueueTimerId);
        return;
    }

    lock.unlock();
    const bool allowed = CanAllocateSkill(static_cast<std::int32_t>(queued.skillId));
    lock.lock();
    if (!Queue.active || Queue.generation != queued.generation) return;
    if (!allowed) {
        Queue = {};
        QueueTimerWindow = nullptr;
        ++RuleStops;
        lock.unlock();
        LogQueueDiagnostic("native-rule-stop", queued.skillId, currentBaseLevel,
            queued.observedBaseLevel, currentUnspentPoints,
            queued.observedUnspentPoints, queued.remaining, queued.generation);
        KillTimer(window, QueueTimerId);
        return;
    }

    Queue.observedBaseLevel = currentBaseLevel;
    Queue.observedUnspentPoints = currentUnspentPoints;
    --Queue.remaining;
    Queue.deadline = now + ServerSyncTimeout;
    const auto skillId = Queue.skillId;
    const auto packetExtra = Queue.packetExtra;
    lock.unlock();
    LogQueueDiagnostic("send", skillId, currentBaseLevel,
        queued.observedBaseLevel, currentUnspentPoints,
        queued.observedUnspentPoints, queued.remaining - 1, queued.generation);
    OriginalSendFiveBytePacket(AllocateSkillOpcode, skillId, packetExtra);
    ++QueuedPointsSent;
    lock.lock();
    if (Queue.active && Queue.generation == queued.generation) {
        Queue.processing = false;
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
    if (packetExtra == ShiftAllocateExtra) mask |= PacketShift;
    return mask;
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
    LastPacketExtra.store(extra, std::memory_order_relaxed);
    const bool shiftPressed = (modifierMask & PacketShift) != 0;
    const bool ctrlPressed = (modifierMask & (
        NativeCtrl | NativeLeftCtrl | NativeRightCtrl
        | Win32Ctrl | Win32LeftCtrl | Win32RightCtrl
    )) != 0;
    const auto mode = ResolveMode(shiftPressed, ctrlPressed);
    if (mode == AllocationMode::Single) {
        StopActiveQueue();
        ++SingleClicks;
        OriginalSendFiveBytePacket(opcode, value, extra);
        return;
    }

    StopActiveQueue();
    if (mode == AllocationMode::ShiftAll) {
        if (!ConfirmShiftAllocation()) {
            ++ShiftCancelled;
            return;
        }
        ++ShiftAccepted;
    } else {
        ++CtrlBatches;
    }

    const auto currentBaseLevel = CurrentBaseLevel(value);
    const auto runtimeMaxLevel = RuntimeMaxLevel(value);
    const auto currentUnspentPoints = CurrentUnspentSkillPoints();
    if (currentBaseLevel < 0 || runtimeMaxLevel <= 0 || currentUnspentPoints < 0) {
        if (Settings.diagnostics && Context) {
            Context->LogWarn("BulkSkillPointAllocation: runtime skill snapshot unavailable; sending one vanilla rank only.");
        }
        OriginalSendFiveBytePacket(opcode, value, extra);
        return;
    }
    const auto requested = RequestedSkillPoints(
        mode,
        Settings.skillPointsPerCtrlClick,
        currentBaseLevel,
        runtimeMaxLevel
    );
    if (requested == 0) {
        OriginalSendFiveBytePacket(opcode, value, extra);
        return;
    }

    LogQueueDiagnostic("click", value, currentBaseLevel, runtimeMaxLevel,
        currentUnspentPoints, currentUnspentPoints, requested, 0);

    OriginalSendFiveBytePacket(opcode, value, extra);
    StartQueue(value, extra, requested, currentBaseLevel, currentUnspentPoints);
}

D2RL::ConsoleCommandResult __cdecl Status(
    D2R::Game::Client*,
    const D2RL::ConsoleCommandContext* command,
    void*
) noexcept {
    if (!command || !command->plugin) return D2RL::ConsoleCommandResult::Failed;

    QueueState queue;
    {
        std::scoped_lock lock(QueueMutex);
        queue = Queue;
    }
    char message[768]{};
    std::snprintf(
        message,
        sizeof(message),
        "BulkSkillPointAllocation 1.1.0: JSON config; dual-ack queue; safeguard=2000 ms; ctrl skill points=%u; active=%s; skill=%u; remaining=%u; last modifiers=0x%02X; last extra=0x%04X; single=%llu; ctrl batches=%llu; shift accepted=%llu; shift cancelled=%llu; queued points=%llu; completed=%llu; rule stops=%llu; sync timeouts=%llu.",
        Settings.skillPointsPerCtrlClick,
        queue.active ? "yes" : "no",
        static_cast<unsigned>(queue.skillId),
        queue.remaining,
        static_cast<unsigned>(LastModifierMask.load(std::memory_order_relaxed)),
        static_cast<unsigned>(LastPacketExtra.load(std::memory_order_relaxed)),
        static_cast<unsigned long long>(SingleClicks.load()),
        static_cast<unsigned long long>(CtrlBatches.load()),
        static_cast<unsigned long long>(ShiftAccepted.load()),
        static_cast<unsigned long long>(ShiftCancelled.load()),
        static_cast<unsigned long long>(QueuedPointsSent.load()),
        static_cast<unsigned long long>(CompletedBatches.load()),
        static_cast<unsigned long long>(RuleStops.load()),
        static_cast<unsigned long long>(SyncTimeouts.load())
    );
    command->plugin->WriteConsoleMessage(message);
    return D2RL::ConsoleCommandResult::Handled;
}

bool ValidateUnitBaseStatEntry() noexcept {
    constexpr std::array<std::uint8_t, 15> nativeExpected{
        0x48, 0x89, 0x5C, 0x24, 0x10, 0x48, 0x89, 0x6C,
        0x24, 0x18, 0x48, 0x89, 0x74, 0x24, 0x20
    };
    const auto* entry = Base + GetUnitBaseStatRva;
    if (std::equal(nativeExpected.begin(), nativeExpected.end(), entry)) {
        return true;
    }
    if (entry[0] != 0xE9
        || !std::equal(nativeExpected.begin() + 5, nativeExpected.end(), entry + 5)) {
        return false;
    }

    std::int32_t displacement{};
    std::memcpy(&displacement, entry + 1, sizeof(displacement));
    const auto* relay = entry + 5 + displacement;
    constexpr std::array<std::uint8_t, 6> absoluteJump{
        0xFF, 0x25, 0x00, 0x00, 0x00, 0x00
    };
    if (!std::equal(absoluteJump.begin(), absoluteJump.end(), relay)) {
        return false;
    }

    const void* target{};
    std::memcpy(&target, relay + absoluteJump.size(), sizeof(target));
    const auto durabilityModule = GetModuleHandleW(L"DurabilityResistance.dll");
    if (!durabilityModule) return false;

    MEMORY_BASIC_INFORMATION memory{};
    return VirtualQuery(target, &memory, sizeof(memory)) == sizeof(memory)
        && memory.AllocationBase == durabilityModule;
}

bool ValidateRuntime() noexcept {
    constexpr std::array<std::uint8_t, 29> sendPacketExpected{
        0x48, 0x83, 0xEC, 0x28, 0x88, 0x4C, 0x24, 0x48,
        0x48, 0x8D, 0x4C, 0x24, 0x48, 0x66, 0x89, 0x54,
        0x24, 0x49, 0xBA, 0x05, 0x00, 0x00, 0x00, 0x66,
        0x44, 0x89, 0x44, 0x24, 0x4B
    };
    constexpr std::array<std::uint8_t, 27> canAllocateExpected{
        0x48, 0x89, 0x5C, 0x24, 0x18, 0x55, 0x56, 0x41,
        0x57, 0x48, 0x83, 0xEC, 0x30, 0x8B, 0xE9, 0xE8,
        0x1C, 0x75, 0xBC, 0xFE, 0x8B, 0xC8, 0xE8, 0xC5,
        0x66, 0xBD, 0xFE
    };
    constexpr std::array<std::uint8_t, 21> isVirtualKeyDownExpected{
        0x48, 0x83, 0xEC, 0x28, 0xFF, 0x15, 0x86, 0x6E,
        0xAA, 0x00, 0xC1, 0xE8, 0x0F, 0x83, 0xE0, 0x01,
        0x48, 0x83, 0xC4, 0x28, 0xC3
    };
    constexpr std::array<std::uint8_t, 10> localContextExpected{
        0x8B, 0x05, 0x2E, 0x84, 0x99, 0x02, 0xC3, 0xCC, 0xCC, 0xCC
    };
    constexpr std::array<std::uint8_t, 19> localPlayerExpected{
        0x48, 0x89, 0x5C, 0x24, 0x08, 0x57, 0x48, 0x83,
        0xEC, 0x20, 0x83, 0xF9, 0x08, 0x0F, 0x83, 0x85,
        0x00, 0x00, 0x00
    };
    constexpr std::array<std::uint8_t, 14> unitContextExpected{
        0x48, 0x83, 0xEC, 0x28, 0x48, 0x85, 0xC9, 0x75,
        0x1A, 0x88, 0x4C, 0x24, 0x30, 0x48
    };
    constexpr std::array<std::uint8_t, 16> getSkillExpected{
        0x48, 0x89, 0x5C, 0x24, 0x08, 0x57, 0x48, 0x83,
        0xEC, 0x20, 0x41, 0x8B, 0xD8, 0x8B, 0xFA, 0xE8
    };
    constexpr std::array<std::uint8_t, 14> getLevelExpected{
        0x40, 0x57, 0x48, 0x83, 0xEC, 0x20, 0x48, 0x8B,
        0xF9, 0x48, 0x85, 0xC9, 0x75, 0x1B
    };
    constexpr std::array<std::uint8_t, 16> getMaxExpected{
        0x48, 0x89, 0x5C, 0x24, 0x08, 0x48, 0x89, 0x74,
        0x24, 0x20, 0x57, 0x48, 0x83, 0xEC, 0x30, 0x48
    };
    return Context->CheckExpectedBytes(SendFiveBytePacketRva, sendPacketExpected.data(), sendPacketExpected.size())
        && Context->CheckExpectedBytes(IsVirtualKeyDownRva, isVirtualKeyDownExpected.data(), isVirtualKeyDownExpected.size())
        && Context->CheckExpectedBytes(CanAllocateSkillRva, canAllocateExpected.data(), canAllocateExpected.size())
        && Context->CheckExpectedBytes(GetLocalDataContextRva, localContextExpected.data(), localContextExpected.size())
        && Context->CheckExpectedBytes(GetLocalPlayerRva, localPlayerExpected.data(), localPlayerExpected.size())
        && Context->CheckExpectedBytes(GetUnitDataContextRva, unitContextExpected.data(), unitContextExpected.size())
        && Context->CheckExpectedBytes(GetSkillByIdRva, getSkillExpected.data(), getSkillExpected.size())
        && Context->CheckExpectedBytes(GetSkillLevelRva, getLevelExpected.data(), getLevelExpected.size())
        && Context->CheckExpectedBytes(GetRuntimeMaxSkillLevelRva, getMaxExpected.data(), getMaxExpected.size())
        && ValidateUnitBaseStatEntry();
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

    IsVirtualKeyDown = At<IsVirtualKeyDownFn>(IsVirtualKeyDownRva);
    CanAllocateSkill = At<CanAllocateSkillFn>(CanAllocateSkillRva);
    GetLocalDataContext = At<GetLocalDataContextFn>(GetLocalDataContextRva);
    GetLocalPlayer = At<GetLocalPlayerFn>(GetLocalPlayerRva);
    GetUnitDataContext = At<GetUnitDataContextFn>(GetUnitDataContextRva);
    GetSkillById = At<GetSkillByIdFn>(GetSkillByIdRva);
    GetSkillLevel = At<GetSkillLevelFn>(GetSkillLevelRva);
    GetRuntimeMaxSkillLevel = At<GetRuntimeMaxSkillLevelFn>(GetRuntimeMaxSkillLevelRva);
    GetUnitBaseStat = At<GetUnitBaseStatFn>(GetUnitBaseStatRva);
    if (!ValidateRuntime()) {
        context->LogError("BulkSkillPointAllocation: 92777 runtime signature mismatch; plugin refused.");
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
            "Show bulk skill allocation settings, queue state, and counters."
        )) {
        context->LogWarn("BulkSkillPointAllocation: status command could not be registered.");
    }
    const auto activeMessage = std::string(
        "BulkSkillPointAllocation 1.1.0 active for D2R 3.2.92777 "
        "(standalone DLL; JSON config: "
    ) + LoadedConfigPath + "; dual acknowledgements enabled).";
    context->LogInfo(activeMessage.c_str());
    return true;
}

D2RL_PLUGIN_EXPORT void D2RLoaderUnloadPlugin() noexcept {
    StopActiveQueue();
    Context = nullptr;
}
