#define NOMINMAX
#include <D2RLPlugin/api.h>
#include "reward_state.hpp"
#include "target_policy.hpp"

#include <Windows.h>
#include <algorithm>
#include <array>
#include <cctype>
#include <cstdint>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <unordered_set>
#include <utility>
#include <vector>

namespace {
using tcp::charsi::AddBonusRewards;
using tcp::charsi::CompleteSuccessfulImbue;
using tcp::charsi::NativeRewardBecamePending;
using tcp::charsi::RewardState;
using tcp::charsi::MatchesTarget;
using tcp::charsi::TargetKind;

constexpr std::uint32_t SupportedBuild = 92777;
constexpr std::uintptr_t TreasureDropRva = 0x441300;
constexpr std::uintptr_t CharsiRewardRva = 0x5DA1C0;
constexpr std::uintptr_t QuestSetRva = 0x325C00;
constexpr std::uintptr_t QuestClearRva = 0x325990;
constexpr std::uintptr_t QuestGetRva = 0x325C50;
constexpr std::uintptr_t PlayerDataRva = 0x34B240;
constexpr std::uintptr_t EnumerateUnitsRva = 0x2EFDE0;
constexpr std::uintptr_t FirstUnitRva = 0x2EFD90;
constexpr std::uintptr_t NextUnitRva = 0x34B4A0;
constexpr std::uintptr_t UnitTypeRva = 0x34B9D0;
constexpr std::uintptr_t IsMonsterFlagRva = 0x38E870;
constexpr std::uintptr_t SuperuniqueIndexRva = 0x38E3D0;
constexpr std::uintptr_t UpdateQuestFlagsRva = 0x518620;

constexpr std::uint32_t PlayerUnitType = 0;
constexpr std::uint32_t MonsterUnitType = 1;
constexpr std::uint16_t SuperuniqueMonsterFlag = 0x0002;
constexpr std::int32_t CharsiQuest = 3;
constexpr std::int32_t RewardGranted = 0;
constexpr std::int32_t RewardPending = 1;
constexpr std::int32_t CountLow = 7;         // QFLAG_CUSTOM3, unused by A1Q3.
constexpr std::int32_t CountHigh = 8;        // QFLAG_CUSTOM4, unused by A1Q3.
constexpr std::int32_t BonusActive = 9;      // QFLAG_CUSTOM5, unused by A1Q3.
constexpr std::int32_t NormalOwed = 10;      // QFLAG_CUSTOM6, unused by A1Q3.
constexpr std::int32_t BaselineGranted = 11; // QFLAG_CUSTOM7, unused by A1Q3.

constexpr char DefaultConfig[] = R"toml(# Tweaked Charsi Imbue Reward
# Grants the native Charsi quest service

[reward]
# Set to true to activate this plugin.
enabled = false
# target_type accepted values: "superunique" or "boss".
target_type = "superunique"
# "superunique": exact Superunique value from superuniques.txt, like "Bishibosh".
# "boss": exact Id value of an Act boss, Uber, or mini-Uber from monstats.txt. Example: "andariel", "uberandariel", etc.
target = ""
# Accepted values: 1, 2 or 3 additional Imbues per kill.
reward_count = 3
# reward_count = 1: three kills grant 1 -> 2 -> 3 pending Imbues.
# reward_count = 2: the first kill grants 2; the second raises the total to 3.
# reward_count = 3: the first kill immediately fills the reward queue.

[difficulties]
normal = true
nightmare = true
hell = true
)toml";

struct Config {
    bool enabled{};
    TargetKind targetKind{TargetKind::Superunique};
    std::string target;
    std::uint8_t rewardCount{3};
    std::array<bool, 3> difficulties{true, true, true};
    bool diagnostics{};
    std::uint32_t resolvedIndex{};
};

struct CatalogEntry {
    std::string_view name;
    std::uint32_t index;
};

constexpr std::array<CatalogEntry, 66> VanillaSuperuniqueCatalog{
    CatalogEntry{"Bishibosh", 0},
    CatalogEntry{"Bonebreak", 1},
    CatalogEntry{"Coldcrow", 2},
    CatalogEntry{"Rakanishu", 3},
    CatalogEntry{"Treehead WoodFist", 4},
    CatalogEntry{"Griswold", 5},
    CatalogEntry{"The Countess", 6},
    CatalogEntry{"Pitspawn Fouldog", 7},
    CatalogEntry{"Flamespike the Crawler", 8},
    CatalogEntry{"Boneash", 9},
    CatalogEntry{"Radament", 10},
    CatalogEntry{"Bloodwitch the Wild", 11},
    CatalogEntry{"Fangskin", 12},
    CatalogEntry{"Beetleburst", 13},
    CatalogEntry{"Leatherarm", 14},
    CatalogEntry{"Coldworm the Burrower", 15},
    CatalogEntry{"Fire Eye", 16},
    CatalogEntry{"Dark Elder", 17},
    CatalogEntry{"The Summoner", 18},
    CatalogEntry{"Ancient Kaa the Soulless", 19},
    CatalogEntry{"The Smith", 20},
    CatalogEntry{"Web Mage the Burning", 21},
    CatalogEntry{"Witch Doctor Endugu", 22},
    CatalogEntry{"Stormtree", 23},
    CatalogEntry{"Sarina the Battlemaid", 24},
    CatalogEntry{"Icehawk Riftwing", 25},
    CatalogEntry{"Ismail Vilehand", 26},
    CatalogEntry{"Geleb Flamefinger", 27},
    CatalogEntry{"Bremm Sparkfist", 28},
    CatalogEntry{"Toorc Icefist", 29},
    CatalogEntry{"Wyand Voidfinger", 30},
    CatalogEntry{"Maffer Dragonhand", 31},
    CatalogEntry{"Winged Death", 32},
    CatalogEntry{"The Tormentor", 33},
    CatalogEntry{"Taintbreeder", 34},
    CatalogEntry{"Riftwraith the Cannibal", 35},
    CatalogEntry{"Infector of Souls", 36},
    CatalogEntry{"Lord De Seis", 37},
    CatalogEntry{"Grand Vizier of Chaos", 38},
    CatalogEntry{"The Cow King", 39},
    CatalogEntry{"Corpsefire", 40},
    CatalogEntry{"The Feature Creep", 41},
    CatalogEntry{"Siege Boss", 42},
    CatalogEntry{"Ancient Barbarian 1", 43},
    CatalogEntry{"Ancient Barbarian 2", 44},
    CatalogEntry{"Ancient Barbarian 3", 45},
    CatalogEntry{"Axe Dweller", 46},
    CatalogEntry{"Bonesaw Breaker", 47},
    CatalogEntry{"Dac Farren", 48},
    CatalogEntry{"Megaflow Rectifier", 49},
    CatalogEntry{"Eyeback Unleashed", 50},
    CatalogEntry{"Threash Socket", 51},
    CatalogEntry{"Pindleskin", 52},
    CatalogEntry{"Snapchip Shatter", 53},
    CatalogEntry{"Anodized Elite", 54},
    CatalogEntry{"Vinvear Molech", 55},
    CatalogEntry{"Sharp Tooth Sayer", 56},
    CatalogEntry{"Magma Torquer", 57},
    CatalogEntry{"Blaze Ripper", 58},
    CatalogEntry{"Frozenstein", 59},
    CatalogEntry{"Nihlathak Boss", 60},
    CatalogEntry{"Baal Subject 1", 61},
    CatalogEntry{"Baal Subject 2", 62},
    CatalogEntry{"Baal Subject 3", 63},
    CatalogEntry{"Baal Subject 4", 64},
    CatalogEntry{"Baal Subject 5", 65},
};

// Vanilla 3.2 fallback values, used only when the active monstats.txt cannot
// be located. An available active table always remains authoritative.
constexpr std::array<CatalogEntry, 13> VanillaBossCatalog{
    CatalogEntry{"andariel", 156},
    CatalogEntry{"duriel", 211},
    CatalogEntry{"mephisto", 242},
    CatalogEntry{"diablo", 243},
    CatalogEntry{"izual", 256},
    CatalogEntry{"diabloclone", 333},
    CatalogEntry{"baalcrab", 545},
    CatalogEntry{"ubermephisto", 705},
    CatalogEntry{"uberdiablo", 706},
    CatalogEntry{"uberizual", 707},
    CatalogEntry{"uberandariel", 708},
    CatalogEntry{"uberduriel", 709},
    CatalogEntry{"uberbaal", 710},
};

using TreasureDropFn = void(__fastcall*)(void*, void*, void*, std::uint16_t, std::uint32_t, std::uint32_t, std::uint32_t, void*, void*, std::uint32_t);
using CharsiRewardFn = std::int32_t(__fastcall*)(void*, void*);
using QuestSetFn = void(__fastcall*)(void*, std::int32_t, std::int32_t);
using QuestClearFn = void(__fastcall*)(void*, std::int32_t, std::int32_t);
using QuestGetFn = std::int32_t(__fastcall*)(void*, std::int32_t, std::int32_t);
using PlayerDataFn = void*(__fastcall*)(void*);
using EnumerateUnitsFn = void(__fastcall*)(void*, void***, std::uint32_t*);
using UnitFn = void*(__fastcall*)(void*);
using UnitTypeFn = std::uint32_t(__fastcall*)(void*);
using IsMonsterFlagFn = bool(__fastcall*)(void*, std::uint16_t);
using SuperuniqueIndexFn = std::int32_t(__fastcall*)(void*);
using UpdateQuestFlagsFn = void(__fastcall*)(void*, void*);

const D2RL::PluginContext* Context{};
std::uint8_t* Base{};
Config Settings{};
TreasureDropFn OriginalTreasureDrop{};
CharsiRewardFn OriginalCharsiReward{};
QuestSetFn OriginalQuestSet{};
QuestClearFn QuestClear{};
QuestGetFn QuestGet{};
PlayerDataFn GetPlayerData{};
EnumerateUnitsFn EnumerateUnits{};
UnitFn FirstUnit{}, NextUnit{};
UnitTypeFn UnitType{};
IsMonsterFlagFn IsMonsterFlag{};
SuperuniqueIndexFn GetSuperuniqueIndex{};
UpdateQuestFlagsFn UpdateQuestFlags{};
thread_local std::uint32_t TreasureDropDepth{};
void* SeenGame{};
std::unordered_set<void*> RewardedMonsters;

constexpr D2RL::PluginInfo Info{
    .infoSize = D2RL::PluginInfoSize,
    .apiVersion = D2RL_PLUGIN_API_VERSION,
    .id = "configurable-charsi-reward",
    .name = "Configurable Charsi Reward",
    .version = "2.1.0",
    .author = "RuffnecKk",
    .description = "Adds one to three native Charsi Imbues when a configured superunique or boss dies; no item drop or token.",
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

bool ParseBool(std::string_view value, bool& result) {
    if (value == "true") { result = true; return true; }
    if (value == "false") { result = false; return true; }
    return false;
}

bool ParseQuoted(std::string_view value, std::string& result) {
    if (value.size() < 2 || value.front() != '"' || value.back() != '"') return false;
    result.assign(value.substr(1, value.size() - 2));
    return true;
}

const char* TargetKindName(TargetKind kind) noexcept {
    return kind == TargetKind::Boss ? "boss" : "superunique";
}

bool LoadConfig(std::string& error) {
    if (!Context->EnsureConfig(DefaultConfig)) {
        error = "could not create or locate configurable-charsi-reward.toml";
        return false;
    }

    std::array<char, 65'536> buffer{};
    std::uint32_t required{};
    if (!Context->ReadConfig(buffer.data(), static_cast<std::uint32_t>(buffer.size()), &required)) {
        error = required > buffer.size() ? "configuration exceeds 65535 bytes" : "could not read configurable-charsi-reward.toml";
        return false;
    }

    Settings = {};
    Settings.rewardCount = 3;
    Settings.difficulties = {true, true, true};
    std::string legacySuperunique;
    const std::string input(buffer.data());
    std::string section;
    std::size_t start{};
    while (start < input.size()) {
        const auto end = input.find('\n', start);
        auto line = Trim(input.substr(start, end - start));
        start = end == std::string::npos ? input.size() : end + 1;
        if (const auto hash = line.find('#'); hash != std::string::npos) line = Trim(line.substr(0, hash));
        if (line.empty()) continue;
        if (line.front() == '[' && line.back() == ']') {
            section = line.substr(1, line.size() - 2);
            continue;
        }
        const auto equal = line.find('=');
        if (equal == std::string::npos) continue;
        const auto key = Trim(line.substr(0, equal));
        const auto value = Trim(line.substr(equal + 1));
        if (section == "reward") {
            if (key == "enabled" && !ParseBool(value, Settings.enabled)) { error = "reward.enabled must be true or false"; return false; }
            if (key == "target_type") {
                std::string type;
                if (!ParseQuoted(value, type)) { error = "reward.target_type must be a quoted string"; return false; }
                if (type == "superunique") Settings.targetKind = TargetKind::Superunique;
                else if (type == "boss") Settings.targetKind = TargetKind::Boss;
                else { error = "reward.target_type must be \"superunique\" or \"boss\""; return false; }
            }
            if (key == "target" && !ParseQuoted(value, Settings.target)) { error = "reward.target must be a quoted string"; return false; }
            // Version 2.0 compatibility: an existing superunique key remains
            // accepted and is translated to the new target fields.
            if (key == "superunique" && !ParseQuoted(value, legacySuperunique)) { error = "reward.superunique must be a quoted string"; return false; }
            if (key == "reward_count") {
                try {
                    const auto parsed = std::stoi(value);
                    if (parsed < 1 || parsed > 3) throw std::out_of_range("reward_count");
                    Settings.rewardCount = static_cast<std::uint8_t>(parsed);
                } catch (...) {
                    error = "reward.reward_count must be an integer from 1 to 3";
                    return false;
                }
            }
        } else if (section == "difficulties") {
            const auto index = key == "normal" ? 0 : key == "nightmare" ? 1 : key == "hell" ? 2 : -1;
            if (index >= 0 && !ParseBool(value, Settings.difficulties[static_cast<std::size_t>(index)])) {
                error = "difficulty values must be true or false";
                return false;
            }
        } else if (section == "diagnostics" && key == "enabled" && !ParseBool(value, Settings.diagnostics)) {
            error = "diagnostics.enabled must be true or false";
            return false;
        }
    }

    if (!legacySuperunique.empty()) {
        if (!Settings.target.empty()) {
            error = "use reward.target or the legacy reward.superunique key, not both";
            return false;
        }
        if (Settings.targetKind == TargetKind::Boss) {
            error = "legacy reward.superunique cannot be combined with target_type = \"boss\"";
            return false;
        }
        Settings.target = std::move(legacySuperunique);
    }
    if (Settings.enabled && Settings.target.empty()) {
        error = "reward.target must name a superunique or boss when the plugin is enabled";
        return false;
    }
    return true;
}

std::vector<std::string> SplitTabs(const std::string& line) {
    std::vector<std::string> columns;
    std::size_t start{};
    while (start <= line.size()) {
        const auto end = line.find('\t', start);
        columns.emplace_back(line.substr(start, end - start));
        if (end == std::string::npos) break;
        start = end + 1;
    }
    return columns;
}

std::optional<std::filesystem::path> LocateExcelTable(const std::filesystem::path& fileName) {
    if (!Context->modDirectory) return std::nullopt;
    const std::filesystem::path root(Context->modDirectory);
    std::vector<std::filesystem::path> candidates;
    candidates.push_back(root / L"data" / L"global" / L"excel" / fileName);
    if (Context->activeMod && *Context->activeMod) {
        candidates.push_back(root / (std::filesystem::path(Context->activeMod).wstring() + L".mpq") / L"data" / L"global" / L"excel" / fileName);
    }
    std::error_code ec;
    if (std::filesystem::is_directory(root, ec)) {
        for (const auto& entry : std::filesystem::directory_iterator(root, ec)) {
            if (!entry.is_directory(ec)) continue;
            candidates.push_back(entry.path() / L"data" / L"global" / L"excel" / fileName);
        }
    }
    for (const auto& candidate : candidates) {
        if (std::filesystem::is_regular_file(candidate, ec)) return candidate;
    }
    return std::nullopt;
}

std::optional<std::uint32_t> ResolveSuperuniqueFromActiveTable(const std::string& name, std::string& error) {
    const auto path = LocateExcelTable(L"superuniques.txt");
    if (!path) return std::nullopt;
    std::ifstream stream(*path, std::ios::binary);
    if (!stream) { error = "could not read active superuniques.txt"; return std::nullopt; }
    std::string line;
    if (!std::getline(stream, line)) { error = "active superuniques.txt is empty"; return std::nullopt; }
    if (!line.empty() && line.back() == '\r') line.pop_back();
    const auto headers = SplitTabs(line);
    const auto nameIt = std::find(headers.begin(), headers.end(), "Superunique");
    const auto indexIt = std::find(headers.begin(), headers.end(), "hcIdx");
    if (nameIt == headers.end() || indexIt == headers.end()) {
        error = "active superuniques.txt is missing Superunique or hcIdx";
        return std::nullopt;
    }
    const auto nameColumn = static_cast<std::size_t>(nameIt - headers.begin());
    const auto indexColumn = static_cast<std::size_t>(indexIt - headers.begin());
    while (std::getline(stream, line)) {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        const auto columns = SplitTabs(line);
        if (columns.size() <= std::max(nameColumn, indexColumn) || columns[nameColumn] != name) continue;
        try {
            const auto value = std::stoul(columns[indexColumn]);
            if (value > UINT32_MAX) throw std::out_of_range("hcIdx");
            return static_cast<std::uint32_t>(value);
        } catch (...) {
            error = "configured superunique has an invalid hcIdx in the active table";
            return std::nullopt;
        }
    }
    return std::nullopt;
}

std::optional<std::uint32_t> ResolveBossFromActiveTable(const std::string& name, std::string& error) {
    const auto path = LocateExcelTable(L"monstats.txt");
    if (!path) return std::nullopt;
    std::ifstream stream(*path, std::ios::binary);
    if (!stream) { error = "could not read active monstats.txt"; return std::nullopt; }
    std::string line;
    if (!std::getline(stream, line)) { error = "active monstats.txt is empty"; return std::nullopt; }
    if (!line.empty() && line.back() == '\r') line.pop_back();
    const auto headers = SplitTabs(line);
    const auto idIt = std::find(headers.begin(), headers.end(), "Id");
    const auto bossIt = std::find(headers.begin(), headers.end(), "boss");
    if (idIt == headers.end() || bossIt == headers.end()) {
        error = "active monstats.txt is missing Id or boss";
        return std::nullopt;
    }
    const auto idColumn = static_cast<std::size_t>(idIt - headers.begin());
    const auto bossColumn = static_cast<std::size_t>(bossIt - headers.begin());
    std::uint32_t rowIndex{};
    while (std::getline(stream, line)) {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        const auto columns = SplitTabs(line);
        if (columns.size() > std::max(idColumn, bossColumn) && columns[idColumn] == name) {
            if (columns[bossColumn] != "1") {
                error = "configured monstats target is not marked boss = 1: " + name;
                return std::nullopt;
            }
            return rowIndex;
        }
        if (rowIndex == UINT32_MAX) {
            error = "active monstats.txt has too many rows";
            return std::nullopt;
        }
        ++rowIndex;
    }
    error = "unknown boss Id in active monstats.txt: " + name;
    return std::nullopt;
}

bool ResolveTarget(std::string& error) {
    if (!Settings.enabled) return true;

    if (Settings.targetKind == TargetKind::Superunique) {
        if (const auto active = ResolveSuperuniqueFromActiveTable(Settings.target, error)) {
            Settings.resolvedIndex = *active;
            return true;
        }
        if (!error.empty()) return false;
        for (const auto& entry : VanillaSuperuniqueCatalog) {
            if (entry.name == Settings.target) {
                Settings.resolvedIndex = entry.index;
                return true;
            }
        }
        error = "unknown superunique key: " + Settings.target;
        return false;
    }

    if (const auto active = ResolveBossFromActiveTable(Settings.target, error)) {
        Settings.resolvedIndex = *active;
        return true;
    }
    if (!error.empty()) return false;
    for (const auto& entry : VanillaBossCatalog) {
        if (entry.name == Settings.target) {
            Settings.resolvedIndex = entry.index;
            return true;
        }
    }
    error = "unknown vanilla boss Id: " + Settings.target;
    return false;
}

void* QuestRecord(void* game, void* player) noexcept {
    if (!game || !player) return nullptr;
    const auto difficulty = *reinterpret_cast<std::uint8_t*>(static_cast<std::uint8_t*>(game) + 0x104);
    if (difficulty > 2) return nullptr;
    auto* data = static_cast<std::uint8_t*>(GetPlayerData(player));
    return data ? *reinterpret_cast<void**>(data + 0x40 + difficulty * sizeof(void*)) : nullptr;
}

bool GetFlag(void* record, std::int32_t flag) noexcept {
    return record && QuestGet(record, CharsiQuest, flag) != 0;
}

RewardState ReadState(void* record) noexcept {
    RewardState state;
    state.bonusCount = static_cast<std::uint8_t>((GetFlag(record, CountLow) ? 1 : 0) | (GetFlag(record, CountHigh) ? 2 : 0));
    state.bonusActive = GetFlag(record, BonusActive);
    state.normalOwed = GetFlag(record, NormalOwed);
    state.baselineGranted = GetFlag(record, BaselineGranted);
    state.rewardGranted = GetFlag(record, RewardGranted);
    state.rewardPending = GetFlag(record, RewardPending);
    return state;
}

void StoreFlag(void* record, std::int32_t flag, bool value) noexcept {
    if (value) OriginalQuestSet(record, CharsiQuest, flag);
    else QuestClear(record, CharsiQuest, flag);
}

void StoreState(void* record, const RewardState& state) noexcept {
    StoreFlag(record, CountLow, (state.bonusCount & 1) != 0);
    StoreFlag(record, CountHigh, (state.bonusCount & 2) != 0);
    StoreFlag(record, BonusActive, state.bonusActive);
    StoreFlag(record, NormalOwed, state.normalOwed);
    StoreFlag(record, BaselineGranted, state.baselineGranted);
    StoreFlag(record, RewardGranted, state.rewardGranted);
    StoreFlag(record, RewardPending, state.rewardPending);
}

bool DifficultyEnabled(void* game) noexcept {
    if (!game) return false;
    const auto difficulty = *reinterpret_cast<std::uint8_t*>(static_cast<std::uint8_t*>(game) + 0x104);
    return difficulty < Settings.difficulties.size() && Settings.difficulties[difficulty];
}

std::uint32_t MonsterClassId(void* monster) noexcept {
    // D2R 3.2.92777 UnitAny layout: unit type at +0x00 and monstats class ID
    // at +0x04. The entire plugin is signature/build locked to this layout.
    return *reinterpret_cast<std::uint32_t*>(static_cast<std::uint8_t*>(monster) + 0x04);
}

std::uint32_t GrantAllPlayers(void* game) noexcept {
    void** buckets{};
    std::uint32_t count{};
    EnumerateUnits(game, &buckets, &count);
    if (!buckets || count == 0 || count > 4096) return 0;
    std::uint32_t granted{};
    for (std::uint32_t index = 0; index < count; ++index) {
        for (void* unit = FirstUnit(buckets[index]); unit; unit = NextUnit(unit)) {
            if (UnitType(unit) != PlayerUnitType) continue;
            void* record = QuestRecord(game, unit);
            if (!record) continue;
            auto state = ReadState(record);
            const auto before = state;
            AddBonusRewards(state, Settings.rewardCount);
            if (state == before) continue;
            StoreState(record, state);
            UpdateQuestFlags(game, unit);
            ++granted;
        }
    }
    return granted;
}

void TryGrantFromMonster(void* game, void* monster) noexcept {
    if (!Settings.enabled || !DifficultyEnabled(game) || !monster) return;
    if (UnitType(monster) != MonsterUnitType) return;
    const auto isSuperunique = Settings.targetKind == TargetKind::Superunique
        && IsMonsterFlag(monster, SuperuniqueMonsterFlag);
    const auto superuniqueIndex = isSuperunique ? GetSuperuniqueIndex(monster) : -1;
    if (!MatchesTarget(Settings.targetKind, Settings.resolvedIndex, isSuperunique,
        superuniqueIndex, MonsterClassId(monster))) return;
    if (SeenGame != game) {
        SeenGame = game;
        RewardedMonsters.clear();
    }
    if (!RewardedMonsters.insert(monster).second) return;
    const auto players = GrantAllPlayers(game);
    if (Settings.diagnostics) {
        char message[512]{};
        std::snprintf(message, sizeof(message), "ConfigurableCharsiReward: %s death queued %u native Imbue(s) for %u player(s).",
            Settings.target.c_str(), Settings.rewardCount, players);
        Context->LogInfo(message);
    }
}

void __fastcall HookTreasureDrop(void* game, void* monster, void* dropContext, std::uint16_t tcId,
    std::uint32_t arg5, std::uint32_t arg6, std::uint32_t arg7, void* arg8, void* arg9, std::uint32_t arg10) {
    const bool outermost = TreasureDropDepth++ == 0;
    OriginalTreasureDrop(game, monster, dropContext, tcId, arg5, arg6, arg7, arg8, arg9, arg10);
    --TreasureDropDepth;
    if (outermost) TryGrantFromMonster(game, monster);
}

void __fastcall HookQuestSet(void* record, std::int32_t quest, std::int32_t flag) {
    OriginalQuestSet(record, quest, flag);
    if (quest != CharsiQuest || flag != RewardPending || !record) return;
    auto state = ReadState(record);
    const auto before = state;
    NativeRewardBecamePending(state);
    if (state.normalOwed != before.normalOwed) StoreFlag(record, NormalOwed, state.normalOwed);
}

std::int32_t __fastcall HookCharsiReward(void* game, void* player) {
    void* record = QuestRecord(game, player);
    const auto before = record ? ReadState(record) : RewardState{};
    const auto result = OriginalCharsiReward(game, player);
    if (!record) return result;
    auto after = before;
    CompleteSuccessfulImbue(after);
    StoreState(record, after);
    UpdateQuestFlags(game, player);
    if (Settings.diagnostics) {
        char message[256]{};
        std::snprintf(message, sizeof(message), "ConfigurableCharsiReward: successful Imbue; %u bonus charge(s) remain.", after.bonusCount);
        Context->LogInfo(message);
    }
    return result;
}

auto Status(D2R::Game::Client*, const D2RL::ConsoleCommandContext* command, void*) noexcept -> D2RL::ConsoleCommandResult {
    if (!command || !command->plugin) return D2RL::ConsoleCommandResult::Failed;
    char message[512]{};
    if (!Settings.enabled) {
        std::snprintf(message, sizeof(message), "ConfigurableCharsiReward 2.1: disabled; edit configurable-charsi-reward.toml and restart.");
    } else {
        std::snprintf(message, sizeof(message), "ConfigurableCharsiReward 2.1: %s %s (index=%u), +%u native Imbue(s), N=%s NM=%s H=%s.",
            TargetKindName(Settings.targetKind), Settings.target.c_str(), Settings.resolvedIndex, Settings.rewardCount,
            Settings.difficulties[0] ? "on" : "off", Settings.difficulties[1] ? "on" : "off", Settings.difficulties[2] ? "on" : "off");
    }
    command->plugin->WriteConsoleMessage(message);
    return D2RL::ConsoleCommandResult::Handled;
}

bool ValidateSignatures() noexcept {
    constexpr std::array<std::uint8_t, 8> drop{0x40, 0x53, 0x55, 0x56, 0x57, 0x41, 0x54, 0x41};
    constexpr std::array<std::uint8_t, 8> reward{0x48, 0x89, 0x5C, 0x24, 0x10, 0x48, 0x89, 0x74};
    constexpr std::array<std::uint8_t, 8> set{0x48, 0x89, 0x5C, 0x24, 0x08, 0x48, 0x89, 0x74};
    return Context->CheckExpectedBytes(TreasureDropRva, drop.data(), static_cast<std::uint32_t>(drop.size()))
        && Context->CheckExpectedBytes(CharsiRewardRva, reward.data(), static_cast<std::uint32_t>(reward.size()))
        && Context->CheckExpectedBytes(QuestSetRva, set.data(), static_cast<std::uint32_t>(set.size()));
}

bool InstallHooks() noexcept {
    constexpr std::array<std::uint8_t, 8> drop{0x40, 0x53, 0x55, 0x56, 0x57, 0x41, 0x54, 0x41};
    constexpr std::array<std::uint8_t, 8> reward{0x48, 0x89, 0x5C, 0x24, 0x10, 0x48, 0x89, 0x74};
    constexpr std::array<std::uint8_t, 8> set{0x48, 0x89, 0x5C, 0x24, 0x08, 0x48, 0x89, 0x74};
    return Context->InstallInlineHook(QuestSetRva, set.data(), static_cast<std::uint32_t>(set.size()), HookQuestSet, &OriginalQuestSet)
        && Context->InstallInlineHook(CharsiRewardRva, reward.data(), static_cast<std::uint32_t>(reward.size()), HookCharsiReward, &OriginalCharsiReward)
        && Context->InstallInlineHook(TreasureDropRva, drop.data(), static_cast<std::uint32_t>(drop.size()), HookTreasureDrop, &OriginalTreasureDrop);
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

    std::string error;
    if (!LoadConfig(error) || !ResolveTarget(error)) {
        Context->LogError(("ConfigurableCharsiReward: invalid configuration: " + error).c_str());
        return false;
    }
    if (!Settings.enabled) {
        Context->LogInfo("ConfigurableCharsiReward 2.1 loaded disabled; configure one target and restart to enable it.");
        if (!Context->RegisterConsoleCommand("configurable-charsi-reward", Status, "Show native Charsi reward status.")) {
            Context->LogWarn("ConfigurableCharsiReward: optional status command could not be registered.");
        }
        return true;
    }
    if (context->modDataVersionBuild != 0 && context->modDataVersionBuild != SupportedBuild) {
        Context->LogError("ConfigurableCharsiReward: unsupported D2R build; expected 3.2.92777.");
        return false;
    }

    QuestClear = At<QuestClearFn>(QuestClearRva);
    QuestGet = At<QuestGetFn>(QuestGetRva);
    GetPlayerData = At<PlayerDataFn>(PlayerDataRva);
    EnumerateUnits = At<EnumerateUnitsFn>(EnumerateUnitsRva);
    FirstUnit = At<UnitFn>(FirstUnitRva);
    NextUnit = At<UnitFn>(NextUnitRva);
    UnitType = At<UnitTypeFn>(UnitTypeRva);
    IsMonsterFlag = At<IsMonsterFlagFn>(IsMonsterFlagRva);
    GetSuperuniqueIndex = At<SuperuniqueIndexFn>(SuperuniqueIndexRva);
    UpdateQuestFlags = At<UpdateQuestFlagsFn>(UpdateQuestFlagsRva);

    if (!ValidateSignatures() || !InstallHooks()) {
        Context->LogError("ConfigurableCharsiReward: D2R 3.2.92777 signature mismatch or conflicting hook; plugin refused.");
        return false;
    }
    if (!Context->RegisterConsoleCommand("configurable-charsi-reward", Status, "Show native Charsi reward status.")) {
        Context->LogWarn("ConfigurableCharsiReward: optional status command could not be registered.");
    }
    char message[512]{};
    std::snprintf(message, sizeof(message), "ConfigurableCharsiReward 2.1 active: %s %s (index=%u), +%u native Imbue(s), Normal=%s Nightmare=%s Hell=%s.",
        TargetKindName(Settings.targetKind), Settings.target.c_str(), Settings.resolvedIndex, Settings.rewardCount,
        Settings.difficulties[0] ? "on" : "off", Settings.difficulties[1] ? "on" : "off", Settings.difficulties[2] ? "on" : "off");
    Context->LogInfo(message);
    return true;
}

D2RL_PLUGIN_EXPORT void D2RLoaderUnloadPlugin() noexcept {
    RewardedMonsters.clear();
    Context = nullptr;
}
