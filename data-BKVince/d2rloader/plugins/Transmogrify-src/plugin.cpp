#define NOMINMAX
#include <D2RLPlugin/api.h>
#include <Windows.h>

#include <algorithm>
#include <array>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <string_view>

namespace {
constexpr std::uintptr_t GetItemsTxtRecordRva = 0x314110;
constexpr std::uintptr_t GetItemRecordFromCodeRva = 0x314070;
constexpr std::uintptr_t BuildItemTooltipRva = 0x2BD480;
constexpr std::uintptr_t EnsureStringCapacityRva = 0x076210;
constexpr std::uintptr_t GetLocalizedStringRva = 0x5F4A50;
constexpr std::uintptr_t GetItemDataContextRva = 0x34A0E0;
constexpr std::uintptr_t GetUnitClassIdRva = 0x349860;
constexpr std::uintptr_t GetUnitInventoryRva = 0x34A360;
constexpr std::uintptr_t GetInventoryGridRva = 0x34A410;
constexpr std::uintptr_t GetItemCellRva = 0x34A330;
constexpr std::uintptr_t GetUnitTypeRva = 0x34B9D0;
constexpr std::uintptr_t CaptureItemPacketStateRva = 0x382D20;
constexpr std::uintptr_t InitializeItemPacketStateRva = 0x382E30;
constexpr std::uintptr_t FindFreeInventoryPositionRva = 0x3865B0;
constexpr std::uintptr_t GetItemParentInventoryRva = 0x38AC50;
constexpr std::uintptr_t RemoveItemFromInventoryRva = 0x389820;
constexpr std::uintptr_t GetServerUnitRva = 0x48FE80;
constexpr std::uintptr_t UseItemHandlerRva = 0x4F40C0;
constexpr std::uintptr_t CreateItemUnitRva = 0x43D530;
constexpr std::uintptr_t GetPlayerItemLevelRva = 0x43E8A0;
constexpr std::uintptr_t FinalizePlacedItemRva = 0x46E8C0;
constexpr std::uintptr_t RefreshPlayerInventoryRva = 0x470C90;
constexpr std::uintptr_t PlaceItemForPlayerRva = 0x471500;
constexpr std::uintptr_t AttachPlacedItemRva = 0x36AE00;
constexpr std::uintptr_t SetItemCellRva = 0x36DEA0;
constexpr std::uintptr_t SendItemUpdateRva = 0x535F60;
constexpr std::uintptr_t SetUnitStatRva = 0x2F7D10;
constexpr std::uintptr_t DeleteItemRva = 0x43EC10;

constexpr std::uint32_t ItemUnitType = 4;
constexpr std::uint32_t QuantityStat = 70;
constexpr std::uint16_t ConvertstoStringId = 5387;
constexpr std::size_t TmogTypeOffset = 0x0D0;
constexpr std::size_t NameStringIdOffset = 0x0FC;
constexpr std::size_t UseableOffset = 0x12C;
constexpr std::size_t TransmogrifyOffset = 0x149;
constexpr std::size_t TmogMinOffset = 0x14A;
constexpr std::size_t TmogMaxOffset = 0x14B;

using GetItemsTxtRecordFn = std::uint8_t*(__fastcall*)(std::uint8_t, std::int32_t) noexcept;
using GetItemRecordFromCodeFn = std::uint8_t*(__fastcall*)(
    std::uint8_t, std::uint32_t, std::int32_t*) noexcept;
using GetLocalizedStringFn = const char*(__fastcall*)(std::uint16_t) noexcept;
using BuildItemTooltipFn = void*(__fastcall*)(
    void*, void*, void*, void*, std::uint64_t, std::uint64_t, std::uint64_t,
    std::uint64_t, std::uint64_t) noexcept;
using EnsureStringCapacityFn = void(__fastcall*)(void*, std::size_t) noexcept;
using UnitFn = void*(__fastcall*)(void*) noexcept;
using UnitIntFn = std::uint32_t(__fastcall*)(void*) noexcept;
using UnitByteFn = std::uint8_t(__fastcall*)(void*) noexcept;
using GetUnitClassIdFn = std::uint32_t(__fastcall*)(void*, const char*, int) noexcept;
using GetUnitInventoryFn = void*(__fastcall*)(void*, const char*, int) noexcept;
using GetInventoryGridFn = std::int32_t(__fastcall*)(void*, std::uint8_t, bool) noexcept;
using GetItemCellFn = std::uint32_t(__fastcall*)(void*, const char*, int) noexcept;
using RemoveItemFromInventoryFn = void*(__fastcall*)(void*, void*) noexcept;
struct ItemPacketState {
    std::uint32_t mode;
    std::uint32_t inventoryPage;
    std::uint32_t packedPosition;
    std::uint32_t nodePage;
};
static_assert(sizeof(ItemPacketState) == 16);
using CaptureItemPacketStateFn = ItemPacketState*(__fastcall*)(ItemPacketState*, void*) noexcept;
using GetServerUnitFn = void*(__fastcall*)(void*, std::uint32_t, std::uint32_t) noexcept;
using UseItemHandlerFn = std::int32_t(__fastcall*)(void*, void*, const std::uint8_t*, bool) noexcept;
using CreateItemUnitFn = void*(__fastcall*)(
    void*, std::int32_t, void*, std::int32_t, std::int32_t, std::int32_t,
    std::int32_t, std::int32_t, std::int32_t, std::int32_t, std::int32_t) noexcept;
using SetItemByteFn = void(__fastcall*)(void*, std::uint8_t) noexcept;
using InitializeItemPacketStateFn = ItemPacketState*(__fastcall*)(ItemPacketState*) noexcept;
using FindFreeInventoryPositionFn = std::int32_t(__fastcall*)(
    void*, void*, std::int32_t, std::uint16_t*, std::uint16_t*, std::uint8_t) noexcept;
using GetPlayerItemLevelFn = std::int32_t(__fastcall*)(void*, std::int32_t) noexcept;
using PlaceItemForPlayerFn = bool(__fastcall*)(
    void*, ItemPacketState*, std::uint32_t*, std::int32_t, bool) noexcept;
using FinalizePlacedItemFn = void(__fastcall*)(void*, void*, void*, std::int32_t) noexcept;
using AttachPlacedItemFn = std::int32_t(__fastcall*)(void*, void*) noexcept;
using RefreshPlayerInventoryFn = void(__fastcall*)(void*, void*, void*, void*) noexcept;
using SendItemUpdateFn = void(__fastcall*)(void*, void*, void*, std::uint32_t,
    std::uint32_t, std::uint32_t, std::uint32_t, std::uint32_t, std::uint32_t) noexcept;
using SetUnitStatFn = void(__fastcall*)(void*, std::uint32_t, std::int32_t, std::uint32_t) noexcept;
using DeleteItemFn = void(__fastcall*)(void*, void*) noexcept;

const D2RL::PluginContext* Context{};
std::uint8_t* Base{};
GetItemsTxtRecordFn OriginalGetItemsTxtRecord{};
GetItemRecordFromCodeFn GetItemRecordFromCode{};
BuildItemTooltipFn OriginalBuildItemTooltip{};
EnsureStringCapacityFn EnsureStringCapacity{};
GetLocalizedStringFn GetLocalizedString{};
UnitByteFn GetItemDataContext{};
GetUnitClassIdFn GetUnitClassId{};
GetUnitInventoryFn GetUnitInventory{};
GetInventoryGridFn GetInventoryGrid{};
GetItemCellFn GetItemCell{};
UnitIntFn GetUnitType{};
CaptureItemPacketStateFn CaptureItemPacketState{};
InitializeItemPacketStateFn InitializeItemPacketState{};
FindFreeInventoryPositionFn FindFreeInventoryPosition{};
UnitFn GetItemParentInventory{};
RemoveItemFromInventoryFn RemoveItemFromInventory{};
GetServerUnitFn GetServerUnit{};
UseItemHandlerFn OriginalUseItemHandler{};
CreateItemUnitFn OriginalCreateItemUnit{};
GetPlayerItemLevelFn GetPlayerItemLevel{};
PlaceItemForPlayerFn PlaceItemForPlayer{};
FinalizePlacedItemFn FinalizePlacedItem{};
AttachPlacedItemFn AttachPlacedItem{};
RefreshPlayerInventoryFn RefreshPlayerInventory{};
SetItemByteFn SetItemCell{};
SendItemUpdateFn SendItemUpdate{};
SetUnitStatFn SetUnitStat{};
DeleteItemFn DeleteItem{};
thread_local bool ForceNoSocketsForTransmogrify{};

constexpr D2RL::PluginInfo Info{
    .infoSize = D2RL::PluginInfoSize,
    .apiVersion = D2RL_PLUGIN_API_VERSION,
    .id = "transmogrify",
    .name = "Transmogrify",
    .version = "1.1.0",
    .author = "RuffnecKk",
    .description = "Transforms configured items with a right-click.",
    .flags = D2RL::PluginFlags::NativeHooks,
};

template<class T> T At(std::uintptr_t rva) noexcept {
    return reinterpret_cast<T>(Base + rva);
}

std::uint8_t* ItemRecord(void* item) noexcept {
    if (!item) return nullptr;
    const auto context = GetItemDataContext(item);
    const auto classId = GetUnitClassId(item, nullptr, 0);
    return OriginalGetItemsTxtRecord(context, static_cast<std::int32_t>(classId));
}

bool IsTransmogrifyRecord(const std::uint8_t* record) noexcept {
    if (!record || record[TransmogrifyOffset] == 0) return false;
    std::uint32_t outputCode{};
    std::memcpy(&outputCode, record + TmogTypeOffset, sizeof(outputCode));
    return outputCode != 0;
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

template<std::size_t Size>
bool MatchesCode(std::uintptr_t rva, const std::array<std::uint8_t, Size>& expected) noexcept {
    const auto* address = Base + rva;
    return IsReadable(address, expected.size())
        && std::memcmp(address, expected.data(), expected.size()) == 0;
}

std::string ReadNativeString(const char* text, std::size_t limit = 512) {
    if (!text || limit == 0) return {};
    MEMORY_BASIC_INFORMATION memory{};
    if (VirtualQuery(text, &memory, sizeof(memory)) != sizeof(memory)
        || memory.State != MEM_COMMIT
        || (memory.Protect & (PAGE_GUARD | PAGE_NOACCESS)) != 0) {
        return {};
    }
    const auto begin = reinterpret_cast<std::uintptr_t>(text);
    const auto regionEnd = reinterpret_cast<std::uintptr_t>(memory.BaseAddress) + memory.RegionSize;
    const auto available = std::min<std::size_t>(limit, regionEnd - begin);
    const auto* terminator = static_cast<const char*>(std::memchr(text, '\0', available));
    return terminator ? std::string(text, terminator) : std::string{};
}

bool IsRequiredStatLine(std::string_view line) {
    std::string lower(line);
    std::transform(lower.begin(), lower.end(), lower.begin(), [](unsigned char ch) {
        return ch >= 'A' && ch <= 'Z' ? static_cast<char>(ch + ('a' - 'A'))
                                     : static_cast<char>(ch);
    });
    return lower.find("required ") != std::string::npos
        || lower.find(" requis") != std::string::npos
        || lower.find("requise") != std::string::npos;
}

std::string BuildTransmogrifyTooltipLine(void* item, const std::uint8_t* sourceRecord) {
    if (!item || !sourceRecord) return {};

    std::uint32_t outputCode{};
    std::memcpy(&outputCode, sourceRecord + TmogTypeOffset, sizeof(outputCode));
    std::int32_t outputClassId{};
    auto* outputRecord = GetItemRecordFromCode(
        GetItemDataContext(item), outputCode, &outputClassId);
    if (!outputRecord) return {};

    std::uint16_t outputNameStringId{};
    std::memcpy(&outputNameStringId,
        outputRecord + NameStringIdOffset, sizeof(outputNameStringId));
    auto action = ReadNativeString(GetLocalizedString(ConvertstoStringId));
    const auto outputName = ReadNativeString(GetLocalizedString(outputNameStringId));
    if (action.empty() || outputName.empty()) return {};
    if (action.back() != ' ') action.push_back(' ');
    return action + outputName;
}

std::string InsertTransmogrifyLine(std::string tooltip, std::string_view text) {
    if (text.empty() || tooltip.find(text) != std::string::npos) return tooltip;
    const std::string line = "\xEE\x81\xBE" "1" + std::string(text);

    std::size_t insertion{};
    std::size_t start{};
    bool foundRequired{};
    while (start <= tooltip.size()) {
        const auto end = tooltip.find('\n', start);
        const auto lineEnd = end == std::string::npos ? tooltip.size() : end;
        if (IsRequiredStatLine(std::string_view(tooltip).substr(start, lineEnd - start))) {
            insertion = start;
            foundRequired = true;
            break;
        }
        if (end == std::string::npos) break;
        start = end + 1;
    }

    if (!foundRequired) insertion = 0;
    tooltip.insert(insertion, line + "\n");
    return tooltip;
}

std::uint8_t* __fastcall HookGetItemsTxtRecord(std::uint8_t context, std::int32_t classId) noexcept {
    auto* record = OriginalGetItemsTxtRecord(context, classId);
    if (IsTransmogrifyRecord(record)) {
        record[UseableOffset] = 1;
    }
    return record;
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
    std::uint64_t a9) noexcept {
    auto* result = OriginalBuildItemTooltip(output, a2, a3, item, a5, a6, a7, a8, a9);
    auto* sourceRecord = ItemRecord(item);
    if (!result || !item || !IsTransmogrifyRecord(sourceRecord) || !IsReadable(result, 24)) {
        return result;
    }

    try {
        const auto* object = static_cast<const std::uint8_t*>(result);
        const auto* data = *reinterpret_cast<char* const*>(object);
        const auto length = *reinterpret_cast<const std::size_t*>(object + 8);
        if (length == 0 || length > 16 * 1024 || !IsReadable(data, length + 1)) return result;

        const std::string original(data, length);
        const auto line = BuildTransmogrifyTooltipLine(item, sourceRecord);
        const auto enhanced = InsertTransmogrifyLine(original, line);
        if (enhanced == original) return result;

        EnsureStringCapacity(result, enhanced.size());
        auto* destination = *reinterpret_cast<char**>(result);
        if (!IsReadable(destination, enhanced.size() + 1)) return result;
        std::memcpy(destination, enhanced.c_str(), enhanced.size() + 1);
        const auto enhancedLength = enhanced.size();
        std::memcpy(static_cast<std::uint8_t*>(result) + 8,
            &enhancedLength, sizeof(enhancedLength));
    } catch (...) {
        Context->LogError("Transmogrify: tooltip enhancement failed safely.");
    }
    return result;
}

std::int32_t RolledQuantity(std::uint8_t minimum, std::uint8_t maximum, std::uint32_t salt) noexcept {
    if (minimum == 0 || maximum == 0) return 0;
    if (maximum < minimum) std::swap(minimum, maximum);
    const auto span = static_cast<std::uint32_t>(maximum - minimum) + 1u;
    const auto mixed = salt * 1664525u + GetTickCount() + 1013904223u;
    return static_cast<std::int32_t>(minimum + (mixed % span));
}

void* __fastcall HookCreateItemUnit(
    void* player,
    std::int32_t itemId,
    void* game,
    std::int32_t spawnTarget,
    std::int32_t quality,
    std::int32_t noSockets,
    std::int32_t noEthereal,
    std::int32_t itemLevel,
    std::int32_t useSeed,
    std::int32_t seed,
    std::int32_t itemSeed) noexcept {
    if (ForceNoSocketsForTransmogrify) noSockets = 1;
    return OriginalCreateItemUnit(
        player, itemId, game, spawnTarget, quality, noSockets, noEthereal,
        itemLevel, useSeed, seed, itemSeed);
}

void* CreateTransmogrifyOutput(void* game, void* player, std::uint8_t dataContext,
    std::uint32_t outputCode) noexcept {
    std::int32_t outputClassId{};
    if (!GetItemRecordFromCode(dataContext, outputCode, &outputClassId)) return nullptr;

    const auto itemLevel = GetPlayerItemLevel(player, 0);
    const auto previousForceNoSockets = ForceNoSocketsForTransmogrify;
    ForceNoSocketsForTransmogrify = true;
    auto* output = HookCreateItemUnit(
        player, outputClassId, game, 4, 2, 0, 1, itemLevel, 0, 0, 0);
    ForceNoSocketsForTransmogrify = previousForceNoSockets;
    return output;
}

bool RestoreDetachedSource(void* player, void* sourceInventory, void* source,
    const ItemPacketState& originalState, std::uint32_t sourceCell) noexcept {
    auto restoreState = originalState;
    if (!PlaceItemForPlayer(player, &restoreState, &sourceCell, 1, false)) return false;
    return GetItemParentInventory(source) == sourceInventory;
}

bool PlaceOutputInSourceContainer(void* game, void* player, void* sourceInventory,
    void* source, void* output, const ItemPacketState& sourceState,
    ItemPacketState& outputState) noexcept {
    const auto sourceCell = GetItemCell(source, nullptr, 0);
    if (RemoveItemFromInventory(sourceInventory, source) != source) {
        Context->LogError("Transmogrify: source inventory detach failed; source was preserved.");
        return false;
    }

    const auto page = static_cast<std::uint8_t>(sourceState.inventoryPage);
    const auto expansion = *reinterpret_cast<const std::uint8_t*>(
        static_cast<const std::uint8_t*>(game) + 0x106) != 1;
    const auto grid = GetInventoryGrid(player, page, expansion);
    std::uint16_t x{};
    std::uint16_t y{};
    const auto foundPosition = grid >= 0 && FindFreeInventoryPosition(
        sourceInventory, output, grid, &x, &y, page) != 0;
    if (!foundPosition) {
        if (!RestoreDetachedSource(player, sourceInventory, source, sourceState, sourceCell)) {
            Context->LogError("Transmogrify: CRITICAL source rollback failed after a full container.");
        } else {
            Context->LogWarn("Transmogrify: source container has no room; source was preserved.");
        }
        return false;
    }

    InitializeItemPacketState(&outputState);
    outputState.mode = 0;
    outputState.inventoryPage = sourceState.inventoryPage;
    outputState.packedPosition = static_cast<std::uint32_t>(x)
        | (static_cast<std::uint32_t>(y) << 16);
    outputState.nodePage = sourceState.nodePage;

    auto outputCell = GetItemCell(output, nullptr, 0);
    if (!PlaceItemForPlayer(player, &outputState, &outputCell, 1, false)
        || GetItemParentInventory(output) != sourceInventory) {
        if (auto* actualOutputInventory = GetItemParentInventory(output)) {
            RemoveItemFromInventory(actualOutputInventory, output);
        }
        if (!RestoreDetachedSource(player, sourceInventory, source, sourceState, sourceCell)) {
            Context->LogError("Transmogrify: CRITICAL source rollback failed after output placement.");
        } else {
            Context->LogWarn("Transmogrify: output placement failed; source was preserved.");
        }
        return false;
    }
    return true;
}

bool TransformServerItem(void* game, void* player, void* source, std::uint32_t sourceGuid) noexcept {
    if (!game || !player || !source || GetUnitType(player) != 0 ||
        GetUnitType(source) != ItemUnitType) return false;
    auto* record = ItemRecord(source);
    if (!IsTransmogrifyRecord(record)) return false;

    auto* playerInventory = GetUnitInventory(player, nullptr, 0);
    auto* sourceInventory = GetItemParentInventory(source);
    if (!playerInventory || !sourceInventory) {
        Context->LogWarn("Transmogrify: source item is not stored in an accessible inventory.");
        return false;
    }

    bool belongsToPlayer = sourceInventory == playerInventory;
    if (!belongsToPlayer) {
        auto* container = *reinterpret_cast<void**>(
            static_cast<std::uint8_t*>(sourceInventory) + sizeof(void*));
        belongsToPlayer = container && GetUnitType(container) == ItemUnitType &&
            GetItemParentInventory(container) == playerInventory;
    }
    if (!belongsToPlayer) {
        Context->LogWarn("Transmogrify: source item does not belong to the requesting player.");
        return false;
    }

    std::uint32_t outputCode{};
    std::memcpy(&outputCode, record + TmogTypeOffset, sizeof(outputCode));
    ItemPacketState sourceState{};
    CaptureItemPacketState(&sourceState, source);
    if (sourceState.inventoryPage != 0 && sourceState.inventoryPage != 3
        && sourceState.inventoryPage != 4) {
        Context->LogWarn("Transmogrify: source is outside inventory, Cube, or stash.");
        return true;
    }

    Context->LogInfo("Transmogrify: creating an unplaced output item.");
    auto* output = CreateTransmogrifyOutput(
        game, player, GetItemDataContext(source), outputCode);
    if (!output) {
        Context->LogWarn("Transmogrify: output creation failed; source item was preserved.");
        return true;
    }

    const auto quantity = RolledQuantity(record[TmogMinOffset], record[TmogMaxOffset], sourceGuid);
    if (quantity > 0) SetUnitStat(output, QuantityStat, quantity, 0);

    ItemPacketState outputState{};
    if (!PlaceOutputInSourceContainer(
            game, player, sourceInventory, source, output, sourceState, outputState)) {
        DeleteItem(game, output);
        return true;
    }

    Context->LogInfo("Transmogrify: output placed in the source container.");
    SetItemCell(source, 0);
    Context->LogInfo("Transmogrify: sending remove-from-container item action.");
    SendItemUpdate(game, player, source,
        0x20, 4, 0, 0, 0, sourceState.packedPosition);
    SendItemUpdate(game, player, output,
        1, 2, outputState.mode, outputState.inventoryPage,
        outputState.packedPosition, outputState.nodePage);

    FinalizePlacedItem(game, player, output, 0);
    if (AttachPlacedItem(output, player) != 0) {
        RefreshPlayerInventory(game, player, nullptr, nullptr);
    }

    Context->LogInfo("Transmogrify: releasing the replaced source unit.");
    DeleteItem(game, source);

    std::array<char, 160> message{};
    std::snprintf(message.data(), message.size(),
        "Transmogrify: source guid=%u transformed into code=0x%08X quantity=%d page=%u node=%u.",
        sourceGuid, outputCode, quantity, outputState.inventoryPage, outputState.nodePage);
    Context->LogInfo(message.data());
    return true;
}

std::int32_t __fastcall HookUseItemHandler(void* game, void* player,
    const std::uint8_t* packet, bool flag) noexcept {
    std::uint32_t sourceGuid{};
    if (packet) std::memcpy(&sourceGuid, packet + 0x0A, sizeof(sourceGuid));
    auto* source = game && sourceGuid
        ? GetServerUnit(game, ItemUnitType, sourceGuid)
        : nullptr;
    auto* record = ItemRecord(source);

    if (!source || !IsTransmogrifyRecord(record)) {
        return OriginalUseItemHandler(game, player, packet, flag);
    }

    std::array<char, 192> diagnostic{};
    const auto classId = GetUnitClassId(source, nullptr, 0);
    std::uint32_t outputCode{};
    std::memcpy(&outputCode, record + TmogTypeOffset, sizeof(outputCode));
    std::snprintf(diagnostic.data(), diagnostic.size(),
        "Transmogrify server click: guid=%u class=%u output=0x%08X.",
        sourceGuid, classId, outputCode);
    Context->LogInfo(diagnostic.data());

    if (!TransformServerItem(game, player, source, sourceGuid)) {
        Context->LogWarn("Transmogrify: invalid player or source unit was received.");
        return OriginalUseItemHandler(game, player, packet, flag);
    }
    return 1;
}

auto Status(D2R::Game::Client*, const D2RL::ConsoleCommandContext* command, void*) noexcept
    -> D2RL::ConsoleCommandResult {
    if (!command || !command->plugin) return D2RL::ConsoleCommandResult::Failed;
    command->plugin->WriteConsoleMessage(
        "Transmogrify 1.1.0: same-container TXT transformations are active.");
    return D2RL::ConsoleCommandResult::Handled;
}

}

D2RL_PLUGIN_EXPORT auto D2RLoaderGetPluginInfo() noexcept -> const D2RL::PluginInfo* {
    return &Info;
}

D2RL_PLUGIN_EXPORT auto D2RLoaderLoadPlugin(const D2RL::PluginContext* context) noexcept -> bool {
    if (!context) return false;
    Context = context;
    Base = reinterpret_cast<std::uint8_t*>(GetModuleHandleW(nullptr));
    if (!Base) return false;

    constexpr std::array<std::uint8_t, 16> itemCodeResolverExpected{
        0x48,0x89,0x5C,0x24,0x08,0x48,0x89,0x74,
        0x24,0x10,0x57,0x48,0x83,0xEC,0x30,0x49};
    constexpr std::array<std::uint8_t, 14> localizedStringExpected{
        0x80,0x3D,0x05,0xAE,0xCF,0x02,0x00,
        0x48,0x8D,0x05,0xDA,0x96,0xDB,0x01};
    constexpr std::array<std::uint8_t, 16> inventoryGridExpected{
        0x48,0x89,0x5C,0x24,0x10,0x48,0x89,0x6C,
        0x24,0x18,0x48,0x89,0x74,0x24,0x20,0x57};
    constexpr std::array<std::uint8_t, 16> itemCellExpected{
        0x48,0x83,0xEC,0x28,0x48,0x85,0xC9,0x75,
        0x1D,0x88,0x4C,0x24,0x30,0x48,0x8D,0x4C};
    constexpr std::array<std::uint8_t, 16> findPositionExpected{
        0x40,0x55,0x53,0x56,0x57,0x41,0x54,0x41,
        0x56,0x41,0x57,0x48,0x8B,0xEC,0x48,0x83};
    constexpr std::array<std::uint8_t, 16> initializeStateExpected{
        0x33,0xC0,0xC7,0x01,0x04,0x00,0x00,0x00,
        0x48,0x89,0x41,0x08,0x48,0x8B,0xC1,0xC7};
    constexpr std::array<std::uint8_t, 16> playerItemLevelExpected{
        0x48,0x89,0x5C,0x24,0x08,0x57,0x48,0x83,
        0xEC,0x20,0x8B,0xFA,0x48,0x8B,0xD9,0xE8};
    constexpr std::array<std::uint8_t, 16> placeItemExpected{
        0x48,0x89,0x5C,0x24,0x20,0x55,0x56,0x57,
        0x41,0x54,0x41,0x55,0x41,0x56,0x41,0x57};
    constexpr std::array<std::uint8_t, 16> finalizeItemExpected{
        0x48,0x89,0x6C,0x24,0x20,0x41,0x54,0x41,
        0x56,0x41,0x57,0x48,0x83,0xEC,0x50,0x49};
    constexpr std::array<std::uint8_t, 16> attachItemExpected{
        0x48,0x89,0x5C,0x24,0x08,0x57,0x48,0x83,
        0xEC,0x40,0x48,0x8B,0xFA,0x48,0x8B,0xD9};
    constexpr std::array<std::uint8_t, 16> refreshInventoryExpected{
        0x45,0x8B,0xC1,0xE9,0x08,0x00,0x00,0x00,
        0xCC,0xCC,0xCC,0xCC,0xCC,0xCC,0xCC,0xCC};
    if (!MatchesCode(GetItemRecordFromCodeRva, itemCodeResolverExpected)
        || !MatchesCode(GetLocalizedStringRva, localizedStringExpected)) {
        context->LogError(
            "Transmogrify: D2R 3.2.92777 localization signature mismatch; plugin refused.");
        return false;
    }
    if (!MatchesCode(GetInventoryGridRva, inventoryGridExpected)
        || !MatchesCode(GetItemCellRva, itemCellExpected)
        || !MatchesCode(InitializeItemPacketStateRva, initializeStateExpected)
        || !MatchesCode(FindFreeInventoryPositionRva, findPositionExpected)
        || !MatchesCode(GetPlayerItemLevelRva, playerItemLevelExpected)
        || !MatchesCode(PlaceItemForPlayerRva, placeItemExpected)
        || !MatchesCode(FinalizePlacedItemRva, finalizeItemExpected)
        || !MatchesCode(AttachPlacedItemRva, attachItemExpected)
        || !MatchesCode(RefreshPlayerInventoryRva, refreshInventoryExpected)) {
        context->LogError(
            "Transmogrify: D2R 3.2.92777 item-placement signature mismatch; plugin refused.");
        return false;
    }

    EnsureStringCapacity = At<EnsureStringCapacityFn>(EnsureStringCapacityRva);
    GetItemRecordFromCode = At<GetItemRecordFromCodeFn>(GetItemRecordFromCodeRva);
    GetLocalizedString = At<GetLocalizedStringFn>(GetLocalizedStringRva);
    GetItemDataContext = At<UnitByteFn>(GetItemDataContextRva);
    GetUnitClassId = At<GetUnitClassIdFn>(GetUnitClassIdRva);
    GetUnitInventory = At<GetUnitInventoryFn>(GetUnitInventoryRva);
    GetInventoryGrid = At<GetInventoryGridFn>(GetInventoryGridRva);
    GetItemCell = At<GetItemCellFn>(GetItemCellRva);
    GetUnitType = At<UnitIntFn>(GetUnitTypeRva);
    CaptureItemPacketState = At<CaptureItemPacketStateFn>(CaptureItemPacketStateRva);
    InitializeItemPacketState = At<InitializeItemPacketStateFn>(InitializeItemPacketStateRva);
    FindFreeInventoryPosition = At<FindFreeInventoryPositionFn>(FindFreeInventoryPositionRva);
    GetItemParentInventory = At<UnitFn>(GetItemParentInventoryRva);
    RemoveItemFromInventory = At<RemoveItemFromInventoryFn>(RemoveItemFromInventoryRva);
    GetServerUnit = At<GetServerUnitFn>(GetServerUnitRva);
    GetPlayerItemLevel = At<GetPlayerItemLevelFn>(GetPlayerItemLevelRva);
    PlaceItemForPlayer = At<PlaceItemForPlayerFn>(PlaceItemForPlayerRva);
    FinalizePlacedItem = At<FinalizePlacedItemFn>(FinalizePlacedItemRva);
    AttachPlacedItem = At<AttachPlacedItemFn>(AttachPlacedItemRva);
    RefreshPlayerInventory = At<RefreshPlayerInventoryFn>(RefreshPlayerInventoryRva);
    SetItemCell = At<SetItemByteFn>(SetItemCellRva);
    SendItemUpdate = At<SendItemUpdateFn>(SendItemUpdateRva);
    SetUnitStat = At<SetUnitStatFn>(SetUnitStatRva);
    DeleteItem = At<DeleteItemFn>(DeleteItemRva);

    constexpr std::array<std::uint8_t, 8> itemsExpected{0x40,0x57,0x48,0x83,0xEC,0x30,0x8B,0xFA};
    if (!context->InstallInlineHook(GetItemsTxtRecordRva, itemsExpected.data(),
            static_cast<std::uint32_t>(itemsExpected.size()), HookGetItemsTxtRecord,
            &OriginalGetItemsTxtRecord)) {
        context->LogError("Transmogrify: D2R 3.2.92777 ItemsTxt signature mismatch; hook refused.");
        return false;
    }

    constexpr std::array<std::uint8_t, 32> tooltipExpected{
        0x40,0x55,0x53,0x56,0x57,0x41,0x54,0x41,
        0x55,0x41,0x56,0x41,0x57,0x48,0x8D,0xAC,
        0x24,0xF8,0xB1,0xFF,0xFF,0xB8,0x08,0x4F,
        0x00,0x00,0xE8,0x41,0x3C,0x01,0x01,0x48};
    if (!context->InstallInlineHook(BuildItemTooltipRva, tooltipExpected.data(),
            static_cast<std::uint32_t>(tooltipExpected.size()), HookBuildItemTooltip,
            &OriginalBuildItemTooltip)) {
        context->LogError("Transmogrify: D2R 3.2.92777 item-tooltip signature mismatch; hook refused.");
        return false;
    }

    constexpr std::array<std::uint8_t, 8> useItemHandlerExpected{
        0x40,0x55,0x53,0x56,0x57,0x41,0x54,0x41};

    constexpr std::array<std::uint8_t, 16> createItemUnitExpected{
        0x40,0x55,0x53,0x56,0x57,0x48,0x8D,0x6C,
        0x24,0xF8,0x48,0x81,0xEC,0x08,0x01,0x00};
    if (!context->InstallInlineHook(CreateItemUnitRva, createItemUnitExpected.data(),
            static_cast<std::uint32_t>(createItemUnitExpected.size()), HookCreateItemUnit,
            &OriginalCreateItemUnit)) {
        context->LogError("Transmogrify: D2R 3.2.92777 item-creation signature mismatch; hook refused.");
        return false;
    }

    if (!context->InstallInlineHook(UseItemHandlerRva, useItemHandlerExpected.data(),
            static_cast<std::uint32_t>(useItemHandlerExpected.size()), HookUseItemHandler,
            &OriginalUseItemHandler)) {
        context->LogError("Transmogrify: D2R 3.2.92777 use-item signature mismatch; hook refused.");
        return false;
    }

    if (!context->RegisterConsoleCommand("transmogrify", Status,
            "Show Transmogrify native-hook status.")) {
        context->LogError("Transmogrify: console command registration failed.");
        return false;
    }
    context->LogInfo("Transmogrify 1.1.0 native hooks active for D2R 3.2.92777.");
    return true;
}

D2RL_PLUGIN_EXPORT void D2RLoaderUnloadPlugin() noexcept {
    Context = nullptr;
}
