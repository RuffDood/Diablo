#define NOMINMAX
#include <D2RLPlugin/api.h>
#include "charm_aura_policy.hpp"

#include <Windows.h>
#include <intrin.h>

#include <array>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <cstdio>

namespace {
using tcp::charm_auras::CharmItemTypeId;
using tcp::charm_auras::HasNonzeroStat;
using tcp::charm_auras::IsEligible;
using tcp::charm_auras::ItemAuraStatId;
using tcp::charm_auras::MaximumRefreshedCharms;
using tcp::charm_auras::PackedStatRecord;

constexpr std::uint32_t SupportedBuild = 92777;
constexpr std::uintptr_t ActTransitionRva = 0x502D00;
constexpr std::uintptr_t ZoneTransitionReturnRva = 0x486AE5;
constexpr std::uintptr_t AttachSoundRva = 0x491960;
constexpr std::uintptr_t CorpseRecoveryReturnRva = 0x4B35A6;
constexpr std::uint16_t CorpseRecoverySoundId = 0x64;
constexpr std::uintptr_t GetInventoryRva = 0x34A360;
constexpr std::uintptr_t GetItemDataRva = 0x34A500;
constexpr std::uintptr_t GetStatListRva = 0x34B870;
constexpr std::uintptr_t CheckItemTypeRva = 0x373890;
constexpr std::uintptr_t GetFirstItemRva = 0x388C10;
constexpr std::uintptr_t GetNextItemRva = 0x38ABA0;
constexpr std::uintptr_t MergeStatListsRva = 0x2F81A0;
constexpr std::uintptr_t RefreshPlayerItemsRva = 0x46F220;
constexpr std::uintptr_t GetSkillListRva = 0x34B6E0;
constexpr std::uintptr_t SetLeftActiveSkillRva = 0x33EC70;
constexpr std::uintptr_t SetRightActiveSkillRva = 0x33EF10;
constexpr std::size_t ItemFlagsOffset = 0x18;
constexpr std::size_t InventoryNodePositionOffset = 0xB8;
constexpr std::size_t StatListOwnerOffset = 0;
constexpr std::size_t StatListBaseStatsOffset = 0x30;
constexpr std::size_t SkillListLeftSkillOffset = 0x08;
constexpr std::size_t SkillListRightSkillOffset = 0x10;
constexpr std::size_t SkillRecordOffset = 0;
constexpr std::size_t SkillOwnerGuidOffset = 0x4C;
constexpr std::size_t SkillsTxtSkillIdOffset = 0;
constexpr std::size_t MaximumTraversedItems = 4096;
constexpr std::size_t MaximumStatsPerCharm = 4096;

struct RuntimeStatArray {
    const PackedStatRecord* records{};
    std::uint64_t count{};
};

struct ActiveSkillIdentity {
    std::int32_t skillId{};
    std::int32_t ownerGuid{-1};
    bool valid{};
};

struct ActiveSkillSnapshot {
    ActiveSkillIdentity left{};
    ActiveSkillIdentity right{};
};

using ActTransitionFn = void(__fastcall*)(void*, void*, std::int32_t, std::int32_t) noexcept;
using AttachSoundFn = void(__fastcall*)(void*, std::uint16_t, void*) noexcept;
using GetInventoryFn = void*(__fastcall*)(void*, const char*, std::int32_t) noexcept;
using GetItemDataFn = std::uint8_t*(__fastcall*)(void*) noexcept;
using GetStatListFn = std::uint8_t*(__fastcall*)(void*) noexcept;
using CheckItemTypeFn = std::int32_t(__fastcall*)(void*, std::int32_t) noexcept;
using GetFirstItemFn = void*(__fastcall*)(void*) noexcept;
using GetNextItemFn = void*(__fastcall*)(void*) noexcept;
using MergeStatListsFn = void(__fastcall*)(void*, void*, std::int32_t) noexcept;
using RefreshPlayerItemsFn = void(__fastcall*)(void*, void*) noexcept;
using GetSkillListFn = std::uint8_t*(__fastcall*)(void*) noexcept;
using SetActiveSkillFn = void(__fastcall*)(void*, std::int32_t, std::int32_t) noexcept;

const D2RL::PluginContext* Context{};
std::uint8_t* Base{};
ActTransitionFn OriginalActTransition{};
AttachSoundFn OriginalAttachSound{};
GetInventoryFn GetInventory{};
GetItemDataFn GetItemData{};
GetStatListFn GetStatList{};
CheckItemTypeFn CheckItemType{};
GetFirstItemFn GetFirstItem{};
GetNextItemFn GetNextItem{};
MergeStatListsFn MergeStatLists{};
RefreshPlayerItemsFn RefreshPlayerItems{};
GetSkillListFn GetSkillList{};
SetActiveSkillFn SetLeftActiveSkill{};
SetActiveSkillFn SetRightActiveSkill{};
std::atomic<std::uint64_t> ZoneTransitions{};
std::atomic<std::uint64_t> CorpseRecoveries{};
std::atomic<std::uint64_t> NativeCorpseRefreshes{};
std::atomic<std::uint64_t> ScannedItems{};
std::atomic<std::uint64_t> RefreshedCharms{};
std::atomic<std::uint64_t> SkippedWithoutAura{};
std::atomic<std::uint64_t> RestoredActiveSkills{};
std::atomic<std::uint64_t> FailedActiveSkillRestores{};
std::atomic<std::uint64_t> InvalidStatArrays{};
std::atomic<std::uint64_t> RefreshCapHits{};
std::atomic<std::uint64_t> TraversalGuardHits{};

constexpr D2RL::PluginInfo Info{
    .infoSize = D2RL::PluginInfoSize,
    .apiVersion = D2RL_PLUGIN_API_VERSION,
    .id = "charm-inventory-auras",
    .name = "Charm Inventory Auras",
    .version = "1.5.0",
    .author = "RuffnecKk",
    .description = "Keeps identified inventory charm auras active after changing zones or recovering a corpse.",
    .flags = D2RL::PluginFlags::NativeHooks,
};

template<class T>
T At(std::uintptr_t rva) noexcept {
    return reinterpret_cast<T>(Base + rva);
}

ActiveSkillIdentity CaptureActiveSkill(const std::uint8_t* skill) noexcept {
    if (!skill) return {};
    const auto* record = *reinterpret_cast<const std::uint8_t* const*>(
        skill + SkillRecordOffset
    );
    if (!record) return {};
    return {
        static_cast<std::int32_t>(*reinterpret_cast<const std::int16_t*>(
            record + SkillsTxtSkillIdOffset
        )),
        *reinterpret_cast<const std::int32_t*>(skill + SkillOwnerGuidOffset),
        true
    };
}

ActiveSkillSnapshot CaptureActiveSkills(void* player) noexcept {
    const auto* skillList = GetSkillList(player);
    if (!skillList) return {};
    const auto* left = *reinterpret_cast<const std::uint8_t* const*>(
        skillList + SkillListLeftSkillOffset
    );
    const auto* right = *reinterpret_cast<const std::uint8_t* const*>(
        skillList + SkillListRightSkillOffset
    );
    return {CaptureActiveSkill(left), CaptureActiveSkill(right)};
}

bool MatchesActiveSkill(const ActiveSkillIdentity& expected, const ActiveSkillIdentity& actual) noexcept {
    return expected.valid == actual.valid
        && (!expected.valid
            || (expected.skillId == actual.skillId && expected.ownerGuid == actual.ownerGuid));
}

void RestoreActiveSkill(
    void* player,
    const ActiveSkillIdentity& identity,
    SetActiveSkillFn setter,
    std::size_t slotOffset
) noexcept {
    if (!identity.valid) return;
    setter(player, identity.skillId, identity.ownerGuid);

    const auto* skillList = GetSkillList(player);
    const auto* skill = skillList
        ? *reinterpret_cast<const std::uint8_t* const*>(skillList + slotOffset)
        : nullptr;
    if (MatchesActiveSkill(identity, CaptureActiveSkill(skill))) {
        RestoredActiveSkills.fetch_add(1, std::memory_order_relaxed);
    } else {
        FailedActiveSkillRestores.fetch_add(1, std::memory_order_relaxed);
    }
}

void RefreshCharmAuras(void* player) noexcept {
    if (!player) return;

    auto* inventory = GetInventory(player, "CharmInventoryAuras", __LINE__);
    if (!inventory) return;

    std::array<void*, MaximumRefreshedCharms> charms{};
    std::size_t charmCount{};
    std::size_t traversed{};
    for (auto* item = GetFirstItem(inventory); item && traversed < MaximumTraversedItems;
         item = GetNextItem(item)) {
        ++traversed;
        auto* itemData = GetItemData(item);
        if (!itemData) continue;

        const auto itemFlags = *reinterpret_cast<const std::uint32_t*>(itemData + ItemFlagsOffset);
        const auto nodePosition = itemData[InventoryNodePositionOffset];
        const bool matchesCharm = CheckItemType(item, CharmItemTypeId) != 0;
        if (!IsEligible(matchesCharm, nodePosition, itemFlags)) continue;

        const auto* statList = GetStatList(item);
        if (!statList) continue;
        const auto* stats = reinterpret_cast<const RuntimeStatArray*>(
            statList + StatListBaseStatsOffset
        );
        if (!stats->records || stats->count > MaximumStatsPerCharm) {
            InvalidStatArrays.fetch_add(1, std::memory_order_relaxed);
            continue;
        }
        if (!HasNonzeroStat(stats->records, static_cast<std::size_t>(stats->count), ItemAuraStatId)) {
            SkippedWithoutAura.fetch_add(1, std::memory_order_relaxed);
            continue;
        }
        if (charmCount < charms.size()) charms[charmCount++] = item;
        else RefreshCapHits.fetch_add(1, std::memory_order_relaxed);
    }

    ScannedItems.fetch_add(traversed, std::memory_order_relaxed);
    if (traversed == MaximumTraversedItems) {
        TraversalGuardHits.fetch_add(1, std::memory_order_relaxed);
    }

    if (charmCount == 0) return;

    const auto activeSkills = CaptureActiveSkills(player);
    for (std::size_t index = 0; index < charmCount; ++index) {
        auto* item = charms[index];
        if (auto* statList = GetStatList(item)) {
            *reinterpret_cast<void**>(statList + StatListOwnerOffset) = nullptr;
        }
        MergeStatLists(player, item, 1);
    }
    RestoreActiveSkill(
        player,
        activeSkills.left,
        SetLeftActiveSkill,
        SkillListLeftSkillOffset
    );
    RestoreActiveSkill(
        player,
        activeSkills.right,
        SetRightActiveSkill,
        SkillListRightSkillOffset
    );
    RefreshedCharms.fetch_add(charmCount, std::memory_order_relaxed);
}

__declspec(noinline) void __fastcall HookAttachSound(
    void* unit,
    std::uint16_t soundId,
    void* source
) noexcept {
    const auto returnRva = reinterpret_cast<std::uintptr_t>(_ReturnAddress())
        - reinterpret_cast<std::uintptr_t>(Base);
    OriginalAttachSound(unit, soundId, source);
    if (returnRva != CorpseRecoveryReturnRva
        || soundId != CorpseRecoverySoundId
        || unit != source) {
        return;
    }

    CorpseRecoveries.fetch_add(1, std::memory_order_relaxed);
    // Corpse recovery needs the game's complete expire -> merge sequence. Merely
    // clearing the charm's direct stat-list owner (the transition workaround)
    // does not invalidate the stale extended owner left by death. This native
    // helper snapshots vitals and active skills, expires every owned item
    // stat-list, merges it again, and restores the snapshot.
    RefreshPlayerItems(nullptr, unit);
    NativeCorpseRefreshes.fetch_add(1, std::memory_order_relaxed);
}

__declspec(noinline) void __fastcall HookActTransition(
    void* game,
    void* player,
    std::int32_t previousAct,
    std::int32_t nextAct
) noexcept {
    const auto returnRva = reinterpret_cast<std::uintptr_t>(_ReturnAddress())
        - reinterpret_cast<std::uintptr_t>(Base);
    OriginalActTransition(game, player, previousAct, nextAct);
    if (returnRva != ZoneTransitionReturnRva) return;

    ZoneTransitions.fetch_add(1, std::memory_order_relaxed);
    RefreshCharmAuras(player);
}

auto Status(
    D2R::Game::Client*,
    const D2RL::ConsoleCommandContext* command,
    void*
) noexcept -> D2RL::ConsoleCommandResult {
    if (!command || !command->plugin) return D2RL::ConsoleCommandResult::Failed;

    char message[768]{};
    std::snprintf(
        message,
        sizeof(message),
        "CharmInventoryAuras 1.5.0: transitions=%llu; corpse recoveries=%llu; native corpse refreshes=%llu; items scanned=%llu; aura charms refreshed=%llu; non-aura charms skipped=%llu; active skills restored=%llu; active skill restore failures=%llu; invalid stat arrays=%llu; over-cap charms=%llu; traversal guards=%llu.",
        static_cast<unsigned long long>(ZoneTransitions.load(std::memory_order_relaxed)),
        static_cast<unsigned long long>(CorpseRecoveries.load(std::memory_order_relaxed)),
        static_cast<unsigned long long>(NativeCorpseRefreshes.load(std::memory_order_relaxed)),
        static_cast<unsigned long long>(ScannedItems.load(std::memory_order_relaxed)),
        static_cast<unsigned long long>(RefreshedCharms.load(std::memory_order_relaxed)),
        static_cast<unsigned long long>(SkippedWithoutAura.load(std::memory_order_relaxed)),
        static_cast<unsigned long long>(RestoredActiveSkills.load(std::memory_order_relaxed)),
        static_cast<unsigned long long>(FailedActiveSkillRestores.load(std::memory_order_relaxed)),
        static_cast<unsigned long long>(InvalidStatArrays.load(std::memory_order_relaxed)),
        static_cast<unsigned long long>(RefreshCapHits.load(std::memory_order_relaxed)),
        static_cast<unsigned long long>(TraversalGuardHits.load(std::memory_order_relaxed))
    );
    command->plugin->WriteConsoleMessage(message);
    return D2RL::ConsoleCommandResult::Handled;
}

bool InstallHooks() noexcept {
    constexpr std::array<std::uint8_t, 15> actTransitionExpected{
        0x48, 0x89, 0x5C, 0x24, 0x08,
        0x48, 0x89, 0x6C, 0x24, 0x10,
        0x48, 0x89, 0x74, 0x24, 0x18
    };
    constexpr std::array<std::uint8_t, 15> attachSoundExpected{
        0x48, 0x89, 0x5C, 0x24, 0x08,
        0x48, 0x89, 0x74, 0x24, 0x18,
        0x57, 0x48, 0x83, 0xEC, 0x20
    };
    constexpr std::array<std::uint8_t, 18> corpseRecoveryCallExpected{
        0xBA, 0x64, 0x00, 0x00, 0x00,
        0x48, 0x8B, 0x4C, 0x24, 0x68,
        0x4C, 0x8B, 0xC1,
        0xE8, 0xBA, 0xE3, 0xFD, 0xFF
    };
    if (!Context->CheckExpectedBytes(
            ActTransitionRva,
            actTransitionExpected.data(),
            static_cast<std::uint32_t>(actTransitionExpected.size())
        )
        || !Context->CheckExpectedBytes(
            AttachSoundRva,
            attachSoundExpected.data(),
            static_cast<std::uint32_t>(attachSoundExpected.size())
        )
        || !Context->CheckExpectedBytes(
            CorpseRecoveryReturnRva - corpseRecoveryCallExpected.size(),
            corpseRecoveryCallExpected.data(),
            static_cast<std::uint32_t>(corpseRecoveryCallExpected.size())
        )) {
        Context->LogError("CharmInventoryAuras: hook or corpse-recovery call-site signature mismatch; plugin refused.");
        return false;
    }
    if (!Context->InstallInlineHook(
            ActTransitionRva,
            actTransitionExpected.data(),
            static_cast<std::uint32_t>(actTransitionExpected.size()),
            HookActTransition,
            &OriginalActTransition
        )) {
        Context->LogError("CharmInventoryAuras: act-transition signature mismatch; hook refused.");
        return false;
    }
    if (!Context->InstallInlineHook(
            AttachSoundRva,
            attachSoundExpected.data(),
            static_cast<std::uint32_t>(attachSoundExpected.size()),
            HookAttachSound,
            &OriginalAttachSound
        )) {
        Context->LogError("CharmInventoryAuras: attach-sound signature mismatch; corpse-recovery hook refused.");
        return false;
    }
    return true;
}

bool ValidateSkillRuntime() noexcept {
    constexpr std::array<std::uint8_t, 14> getSkillListExpected{
        0x40, 0x53, 0x48, 0x83, 0xEC, 0x20, 0x48,
        0x8B, 0xD9, 0x48, 0x85, 0xC9, 0x75, 0x20
    };
    constexpr std::array<std::uint8_t, 20> setActiveSkillExpected{
        0x48, 0x89, 0x5C, 0x24, 0x08,
        0x48, 0x89, 0x6C, 0x24, 0x10,
        0x48, 0x89, 0x74, 0x24, 0x18,
        0x57, 0x48, 0x83, 0xEC, 0x20
    };
    constexpr std::array<std::uint8_t, 4> leftSlotStoreExpected{0x48, 0x89, 0x58, 0x08};
    constexpr std::array<std::uint8_t, 4> rightSlotStoreExpected{0x48, 0x89, 0x58, 0x10};
    return Context->CheckExpectedBytes(
            GetSkillListRva,
            getSkillListExpected.data(),
            static_cast<std::uint32_t>(getSkillListExpected.size())
        )
        && Context->CheckExpectedBytes(
            SetLeftActiveSkillRva,
            setActiveSkillExpected.data(),
            static_cast<std::uint32_t>(setActiveSkillExpected.size())
        )
        && Context->CheckExpectedBytes(
            SetLeftActiveSkillRva + 0x82,
            leftSlotStoreExpected.data(),
            static_cast<std::uint32_t>(leftSlotStoreExpected.size())
        )
        && Context->CheckExpectedBytes(
            SetRightActiveSkillRva,
            setActiveSkillExpected.data(),
            static_cast<std::uint32_t>(setActiveSkillExpected.size())
        )
        && Context->CheckExpectedBytes(
            SetRightActiveSkillRva + 0x82,
            rightSlotStoreExpected.data(),
            static_cast<std::uint32_t>(rightSlotStoreExpected.size())
        );
}

bool ValidateCorpseRefreshRuntime() noexcept {
    constexpr std::array<std::uint8_t, 14> refreshPlayerItemsExpected{
        0x48, 0x85, 0xD2,
        0x0F, 0x84, 0xD9, 0x00, 0x00, 0x00,
        0x56, 0x48, 0x83, 0xEC, 0x50
    };
    constexpr std::array<std::uint8_t, 45> expireAndMergeExpected{
        0x48, 0x8D, 0x54, 0x24, 0x68,
        0x48, 0x8B, 0xCB,
        0xE8, 0x67, 0x8E, 0xE8, 0xFF,
        0x48, 0x85, 0xC0,
        0x74, 0x1B,
        0x48, 0x8B, 0xD3,
        0x48, 0x8B, 0xCE,
        0xE8, 0xC7, 0x8F, 0xE8, 0xFF,
        0x44, 0x8B, 0x44, 0x24, 0x68,
        0x48, 0x8B, 0xD3,
        0x48, 0x8B, 0xCE,
        0xE8, 0xC7, 0x8E, 0xE8, 0xFF
    };
    return Context->CheckExpectedBytes(
            RefreshPlayerItemsRva,
            refreshPlayerItemsExpected.data(),
            static_cast<std::uint32_t>(refreshPlayerItemsExpected.size())
        )
        && Context->CheckExpectedBytes(
            RefreshPlayerItemsRva + 0x8C,
            expireAndMergeExpected.data(),
            static_cast<std::uint32_t>(expireAndMergeExpected.size())
        );
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
        context->LogError("CharmInventoryAuras: only D2R build 92777 is supported.");
        return false;
    }

    GetInventory = At<GetInventoryFn>(GetInventoryRva);
    GetItemData = At<GetItemDataFn>(GetItemDataRva);
    GetStatList = At<GetStatListFn>(GetStatListRva);
    CheckItemType = At<CheckItemTypeFn>(CheckItemTypeRva);
    GetFirstItem = At<GetFirstItemFn>(GetFirstItemRva);
    GetNextItem = At<GetNextItemFn>(GetNextItemRva);
    MergeStatLists = At<MergeStatListsFn>(MergeStatListsRva);
    RefreshPlayerItems = At<RefreshPlayerItemsFn>(RefreshPlayerItemsRva);
    GetSkillList = At<GetSkillListFn>(GetSkillListRva);
    SetLeftActiveSkill = At<SetActiveSkillFn>(SetLeftActiveSkillRva);
    SetRightActiveSkill = At<SetActiveSkillFn>(SetRightActiveSkillRva);
    if (!ValidateSkillRuntime()) {
        context->LogError("CharmInventoryAuras: active-skill runtime signature mismatch; plugin refused.");
        return false;
    }
    if (!ValidateCorpseRefreshRuntime()) {
        context->LogError("CharmInventoryAuras: native corpse-refresh runtime signature mismatch; plugin refused.");
        return false;
    }
    if (!InstallHooks()) return false;

    if (!context->RegisterConsoleCommand(
            "charm-inventory-auras",
            Status,
            "Show zone-transition and corpse-recovery charm-aura refresh counters."
        )) {
        context->LogWarn("CharmInventoryAuras: status command could not be registered.");
    }
    context->LogInfo("CharmInventoryAuras 1.5.0 active for D2R 3.2.92777 (global/mod-local hybrid; transition aura refresh plus native corpse item-stat refresh).");
    return true;
}

D2RL_PLUGIN_EXPORT void D2RLoaderUnloadPlugin() noexcept {
    Context = nullptr;
}
