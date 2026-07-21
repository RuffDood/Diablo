#define NOMINMAX
#include <D2RLPlugin/api.h>
#include "allocation_policy.hpp"

#include <Windows.h>

#include <array>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <cstdio>
#include <mutex>
#include <string>
#include <string_view>
#include <thread>

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
constexpr std::uint8_t AllocateSkillOpcode = 0x3B;
constexpr std::chrono::milliseconds PollInterval{20};
constexpr std::chrono::milliseconds ServerSyncTimeout{2'000};

constexpr char DefaultConfig[] = R"toml(# Bulk skill point allocation
# Values take effect after a cold start.

[allocation]
# Ctrl + click invests up to this many points without confirmation.
# Range: 1..1000. Native allocation rules can stop the batch earlier.
skill_points_per_ctrl_click = 5

[diagnostics]
enabled = false
)toml";

struct Config {
    std::uint32_t skillPointsPerCtrlClick{DefaultSkillPointsPerCtrlClick};
    bool diagnostics{};
};

struct QueueState {
    bool active{};
    std::uint16_t skillId{};
    std::uint16_t packetExtra{};
    std::uint32_t remaining{};
    std::int32_t observedBaseLevel{};
    std::chrono::steady_clock::time_point deadline{};
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

const D2RL::PluginContext* Context{};
std::uint8_t* Base{};
Config Settings{};
SendFiveBytePacketFn OriginalSendFiveBytePacket{};
IsVirtualKeyDownFn IsVirtualKeyDown{};
CanAllocateSkillFn CanAllocateSkill{};
GetLocalDataContextFn GetLocalDataContext{};
GetLocalPlayerFn GetLocalPlayer{};
GetUnitDataContextFn GetUnitDataContext{};
GetSkillByIdFn GetSkillById{};
GetSkillLevelFn GetSkillLevel{};
GetRuntimeMaxSkillLevelFn GetRuntimeMaxSkillLevel{};

std::mutex QueueMutex;
std::condition_variable QueueChanged;
QueueState Queue{};
std::thread QueueWorker;
std::atomic<bool> StopWorker{};

std::atomic<std::uint64_t> SingleClicks{};
std::atomic<std::uint64_t> CtrlBatches{};
std::atomic<std::uint64_t> ShiftAccepted{};
std::atomic<std::uint64_t> ShiftCancelled{};
std::atomic<std::uint64_t> QueuedPointsSent{};
std::atomic<std::uint64_t> CompletedBatches{};
std::atomic<std::uint64_t> RuleStops{};
std::atomic<std::uint64_t> SyncTimeouts{};

constexpr D2RL::PluginInfo Info{
    .infoSize = D2RL::PluginInfoSize,
    .apiVersion = D2RL_PLUGIN_API_VERSION,
    .id = "bulk-skill-point-allocation",
    .name = "Bulk Skill Point Allocation",
    .version = "1.0.2",
    .author = "RuffnecKk",
    .description = "Adds configurable bulk skill allocation with Ctrl and Shift clicks.",
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

std::uint32_t ParseUnsigned(std::string_view value, std::uint32_t fallback) noexcept {
    try {
        std::size_t consumed{};
        const auto parsed = std::stoul(std::string(value), &consumed, 10);
        return consumed == value.size() ? static_cast<std::uint32_t>(parsed) : fallback;
    } catch (...) {
        return fallback;
    }
}

bool ParseBool(std::string_view value, bool fallback) noexcept {
    if (value == "true") return true;
    if (value == "false") return false;
    return fallback;
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

        if (section == "allocation" && key == "skill_points_per_ctrl_click") {
            Settings.skillPointsPerCtrlClick = ClampSkillPointsPerCtrlClick(
                ParseUnsigned(value, Settings.skillPointsPerCtrlClick)
            );
        } else if (section == "diagnostics" && key == "enabled") {
            Settings.diagnostics = ParseBool(value, Settings.diagnostics);
        }
    }
    return true;
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

void StopActiveQueue() noexcept {
    std::scoped_lock lock(QueueMutex);
    Queue = {};
}

void StartQueue(
    std::uint16_t skillId,
    std::uint16_t packetExtra,
    std::uint32_t requestedRanks,
    std::int32_t currentBaseLevel
) noexcept {
    std::scoped_lock lock(QueueMutex);
    Queue = {
        .active = requestedRanks > 1,
        .skillId = skillId,
        .packetExtra = packetExtra,
        .remaining = requestedRanks > 0 ? requestedRanks - 1 : 0,
        .observedBaseLevel = currentBaseLevel,
        .deadline = std::chrono::steady_clock::now()
            + ServerSyncTimeout,
    };
    QueueChanged.notify_all();
}

void QueueLoop() noexcept {
    std::unique_lock lock(QueueMutex);
    while (!StopWorker.load(std::memory_order_acquire)) {
        QueueChanged.wait_for(lock, PollInterval, [] {
            return StopWorker.load(std::memory_order_acquire) || Queue.active;
        });
        if (StopWorker.load(std::memory_order_acquire)) break;
        if (!Queue.active) continue;

        const auto queued = Queue;
        lock.unlock();
        const auto currentBaseLevel = CurrentBaseLevel(queued.skillId);
        const auto now = std::chrono::steady_clock::now();
        lock.lock();

        if (!Queue.active || Queue.skillId != queued.skillId) continue;
        if (currentBaseLevel == queued.observedBaseLevel) {
            if (now >= queued.deadline) {
                Queue = {};
                ++SyncTimeouts;
            }
            continue;
        }

        if (Queue.remaining == 0) {
            Queue = {};
            ++CompletedBatches;
            continue;
        }

        lock.unlock();
        const bool allowed = CanAllocateSkill(static_cast<std::int32_t>(queued.skillId));
        lock.lock();
        if (!Queue.active || Queue.skillId != queued.skillId) continue;
        if (!allowed) {
            Queue = {};
            ++RuleStops;
            continue;
        }

        Queue.observedBaseLevel = currentBaseLevel;
        --Queue.remaining;
        Queue.deadline = now + ServerSyncTimeout;
        const auto skillId = Queue.skillId;
        const auto packetExtra = Queue.packetExtra;
        lock.unlock();
        OriginalSendFiveBytePacket(AllocateSkillOpcode, skillId, packetExtra);
        ++QueuedPointsSent;
        lock.lock();
    }
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

    const bool shiftPressed = IsVirtualKeyDown(VK_SHIFT) != 0;
    const bool ctrlPressed = IsVirtualKeyDown(VK_CONTROL) != 0;
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
    if (currentBaseLevel < 0 || runtimeMaxLevel <= 0) {
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

    StartQueue(value, extra, requested, currentBaseLevel);
    OriginalSendFiveBytePacket(opcode, value, extra);
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
        "BulkSkillPointAllocation 1.0.2: ctrl skill points=%u; safeguard=2000 ms; active=%s; skill=%u; remaining=%u; single=%llu; ctrl batches=%llu; shift accepted=%llu; shift cancelled=%llu; queued points=%llu; completed=%llu; rule stops=%llu; sync timeouts=%llu.",
        Settings.skillPointsPerCtrlClick,
        queue.active ? "yes" : "no",
        static_cast<unsigned>(queue.skillId),
        queue.remaining,
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
        && Context->CheckExpectedBytes(GetRuntimeMaxSkillLevelRva, getMaxExpected.data(), getMaxExpected.size());
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

    StopWorker.store(false, std::memory_order_release);
    QueueWorker = std::thread(QueueLoop);
    if (!context->RegisterConsoleCommand(
            "bulk-skill-points",
            Status,
            "Show bulk skill allocation settings, queue state, and counters."
        )) {
        context->LogWarn("BulkSkillPointAllocation: status command could not be registered.");
    }
    context->LogInfo("BulkSkillPointAllocation 1.0.2 active for D2R 3.2.92777 (native async modifiers; Ctrl batches and Shift-all queue enabled).");
    return true;
}

D2RL_PLUGIN_EXPORT void D2RLoaderUnloadPlugin() noexcept {
    StopWorker.store(true, std::memory_order_release);
    QueueChanged.notify_all();
    if (QueueWorker.joinable()) QueueWorker.join();
    Context = nullptr;
}
