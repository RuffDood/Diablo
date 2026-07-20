#include <D2RLPlugin/api.h>
#include "router.hpp"
#include <Windows.h>
#include <algorithm>
#include <array>
#include <cctype>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <string>
#include <string_view>
#include <vector>

namespace {
using tcp::autopickup::Family;

constexpr std::uintptr_t TriggerRva=0x4B9DF0, GetGameRva=0x34B440, EnumerateRva=0x2EFDE0;
constexpr std::uintptr_t FirstUnitRva=0x2EFD90, NextUnitRva=0x34B4A0, UnitTypeRva=0x34B9D0;
constexpr std::uintptr_t UnitIdRva=0x34A330, UnitModeRva=0x34AB60, UnitDistanceRva=0x325140;
constexpr std::uintptr_t UnitCollisionRva=0x350550, PickupRva=0x471950;
constexpr std::uint32_t ItemType=4, GroundMode=3, PickupCollisionMask=0x804;

// BKVince 3.2 combined Weapons (307) + Armor (218) + Misc row indices.
struct PotionClass { std::uint32_t id; std::string_view code; Family family; std::uint8_t tier; };
constexpr std::array<PotionClass,12> PotionClasses{
    PotionClass{604,"hp1",Family::Healing,1}, PotionClass{605,"hp2",Family::Healing,2},
    PotionClass{606,"hp3",Family::Healing,3}, PotionClass{607,"hp4",Family::Healing,4}, PotionClass{608,"hp5",Family::Healing,5},
    PotionClass{609,"mp1",Family::Mana,1}, PotionClass{610,"mp2",Family::Mana,2}, PotionClass{611,"mp3",Family::Mana,3},
    PotionClass{612,"mp4",Family::Mana,4}, PotionClass{613,"mp5",Family::Mana,5},
    PotionClass{532,"rvs",Family::Rejuvenation,1}, PotionClass{533,"rvl",Family::Rejuvenation,2},
};

struct FamilyConfig { bool enabled=true; std::array<bool,6> tiers{}; bool overflow=false; };
struct Config {
    bool enabled=true, diagnostics=false;
    std::uint32_t distance=4, interval=3;
    FamilyConfig healing{}, mana{}, rejuvenation{};
};

using TriggerFn=std::int64_t(__fastcall*)(void*,void*,void*,std::int32_t);
using GetGameFn=void*(__fastcall*)(void*);
using EnumerateFn=void(__fastcall*)(void*,void***,std::uint32_t*);
using UnitFn=void*(__fastcall*)(void*);
using UnitIntFn=std::uint32_t(__fastcall*)(void*);
using UnitPairFn=std::int32_t(__fastcall*)(void*,void*);
using CollisionFn=std::int32_t(__fastcall*)(void*,void*,std::uint32_t);
using PickupFn=bool(__fastcall*)(void*,std::uint32_t,bool,std::uint32_t,bool,bool);

const D2RL::PluginContext* Context{};
std::uint8_t* Base{};
TriggerFn OriginalTrigger{};
GetGameFn GetGame{}; EnumerateFn Enumerate{}; UnitFn FirstUnit{},NextUnit{};
UnitIntFn UnitType{},UnitId{},UnitMode{}; UnitPairFn UnitDistance{}; CollisionFn UnitCollision{}; PickupFn Pickup{};
Config Settings{};
thread_local bool Inside{};
thread_local std::uint32_t TriggerCounter{};

constexpr D2RL::PluginInfo Info{
    .infoSize=D2RL::PluginInfoSize, .apiVersion=D2RL_PLUGIN_API_VERSION,
    .id="potion-auto-pickup", .name="PotionAutoPickup", .version="1.0.0",
    .author="RuffnecKk", .description="Configurable native potion autopickup for BKVince 3.2.92777.",
    .flags=D2RL::PluginFlags::ModScopedOnly | D2RL::PluginFlags::NativeHooks,
};

std::string Trim(std::string text) {
    const auto first=text.find_first_not_of(" \t\r\n"); if(first==std::string::npos) return {};
    const auto last=text.find_last_not_of(" \t\r\n"); return text.substr(first,last-first+1);
}
bool BoolValue(std::string_view value,bool fallback) { return value=="true" ? true : value=="false" ? false : fallback; }
std::uint32_t UIntValue(std::string_view value,std::uint32_t fallback) {
    try { return static_cast<std::uint32_t>(std::stoul(std::string(value))); } catch(...) { return fallback; }
}
FamilyConfig* Section(std::string_view section) {
    if(section=="healing") return &Settings.healing; if(section=="mana") return &Settings.mana;
    if(section=="rejuvenation") return &Settings.rejuvenation; return nullptr;
}
void ParseTiers(FamilyConfig& family,std::string_view value) {
    family.tiers.fill(false);
    for(const auto& potion:PotionClasses) if(value.find(potion.code)!=std::string_view::npos) family.tiers[potion.tier]=true;
}
bool LoadConfig() {
    if(!Context->pluginConfigPath) return false;
    const auto path=std::filesystem::path(Context->pluginConfigPath).parent_path()/L"PotionAutoPickup.toml";
    std::ifstream stream(path,std::ios::binary); if(!stream) return false;
    const std::string input((std::istreambuf_iterator<char>(stream)),std::istreambuf_iterator<char>());
    Settings={}; Settings.healing.tiers[4]=Settings.healing.tiers[5]=true;
    Settings.mana.tiers[4]=Settings.mana.tiers[5]=true;
    Settings.rejuvenation.tiers[1]=Settings.rejuvenation.tiers[2]=true;
    std::string section; std::size_t start=0;
    while(start<input.size()) {
        auto end=input.find('\n',start); auto line=Trim(input.substr(start,end-start)); start=end==std::string::npos?input.size():end+1;
        if(auto hash=line.find('#'); hash!=std::string::npos) line=Trim(line.substr(0,hash)); if(line.empty()) continue;
        if(line.front()=='[' && line.back()==']') { section=line.substr(1,line.size()-2); continue; }
        const auto equal=line.find('='); if(equal==std::string::npos) continue;
        const auto key=Trim(line.substr(0,equal)), value=Trim(line.substr(equal+1));
        if(section.empty()) {
            if(key=="enabled") Settings.enabled=BoolValue(value,Settings.enabled);
            else if(key=="pickup_distance") Settings.distance=std::clamp(UIntValue(value,4u),1u,4u);
            else if(key=="minimum_interval_frames") Settings.interval=std::clamp(UIntValue(value,3u),1u,25u);
        } else if(auto* family=Section(section)) {
            if(key=="enabled") family->enabled=BoolValue(value,family->enabled);
            else if(key=="tiers") ParseTiers(*family,value);
            else if(key=="overflow_to_inventory") family->overflow=BoolValue(value,family->overflow);
        } else if(section=="diagnostics" && key=="enabled") Settings.diagnostics=BoolValue(value,Settings.diagnostics);
    }
    return true;
}

const PotionClass* Classify(std::uint32_t id) { for(const auto& p:PotionClasses) if(p.id==id) return &p; return nullptr; }
const FamilyConfig& FamilySettings(Family family) {
    if(family==Family::Healing) return Settings.healing; if(family==Family::Mana) return Settings.mana; return Settings.rejuvenation;
}
bool Accepted(const PotionClass& potion) {
    const auto& f=FamilySettings(potion.family); return f.enabled && f.tiers[potion.tier];
}

void Scan(void* player) {
    if(!Settings.enabled || Inside || !player || (++TriggerCounter%Settings.interval)!=0) return;
    void* game=GetGame(player); if(!game) return;
    void** buckets=nullptr; std::uint32_t count=0; Enumerate(game,&buckets,&count); if(!buckets || !count || count>4096) return;
    void* best=nullptr; const PotionClass* bestPotion=nullptr; std::int32_t bestDistance=INT_MAX;
    for(std::uint32_t i=0;i<count;i++) for(void* unit=FirstUnit(buckets[i]);unit;unit=NextUnit(unit)) {
        if(UnitType(unit)!=ItemType || UnitMode(unit)!=GroundMode) continue;
        const auto* potion=Classify(*reinterpret_cast<std::uint32_t*>(static_cast<std::uint8_t*>(unit)+4));
        if(!potion || !Accepted(*potion) || UnitCollision(player,unit,PickupCollisionMask)!=0) continue;
        const auto distance=UnitDistance(player,unit); if(distance<0 || static_cast<std::uint32_t>(distance)>Settings.distance) continue;
        if(distance<bestDistance || (distance==bestDistance && potion->tier>(bestPotion?bestPotion->tier:0))) { best=unit; bestPotion=potion; bestDistance=distance; }
    }
    if(!best) return;
    Inside=true;
    // Same server pickup routine and flags used by vanilla automatic gold pickup.
    Pickup(player,UnitId(best),true,Settings.distance,true,false);
    Inside=false;
}

std::int64_t __fastcall HookTrigger(void* game,void* player,void* packet,std::int32_t size) {
    const auto result=OriginalTrigger(game,player,packet,size); Scan(player); return result;
}
auto Status(D2R::Game::Client*,const D2RL::ConsoleCommandContext* command,void*) noexcept -> D2RL::ConsoleCommandResult {
    if(!command || !command->plugin) return D2RL::ConsoleCommandResult::Failed;
    command->plugin->WriteConsoleMessage("PotionAutoPickup 1.0: native 3.2 hook active; vanilla pickup distance 4.");
    return D2RL::ConsoleCommandResult::Handled;
}
template<class T> T At(std::uintptr_t rva) { return reinterpret_cast<T>(Base+rva); }
}

D2RL_PLUGIN_EXPORT auto D2RLoaderGetPluginInfo() noexcept -> const D2RL::PluginInfo* { return &Info; }
D2RL_PLUGIN_EXPORT auto D2RLoaderLoadPlugin(const D2RL::PluginContext* context) noexcept -> bool {
    if(!context) return false; Context=context;
    Base=reinterpret_cast<std::uint8_t*>(GetModuleHandleW(nullptr)); if(!Base || !LoadConfig()) return false;
    GetGame=At<GetGameFn>(GetGameRva); Enumerate=At<EnumerateFn>(EnumerateRva); FirstUnit=At<UnitFn>(FirstUnitRva); NextUnit=At<UnitFn>(NextUnitRva);
    UnitType=At<UnitIntFn>(UnitTypeRva); UnitId=At<UnitIntFn>(UnitIdRva); UnitMode=At<UnitIntFn>(UnitModeRva); UnitDistance=At<UnitPairFn>(UnitDistanceRva);
    UnitCollision=At<CollisionFn>(UnitCollisionRva); Pickup=At<PickupFn>(PickupRva);
    constexpr std::array<std::uint8_t,8> expected{0x48,0x89,0x5C,0x24,0x08,0x55,0x56,0x57};
    if(!context->InstallInlineHook(TriggerRva,expected.data(),static_cast<std::uint32_t>(expected.size()),HookTrigger,&OriginalTrigger)) {
        context->LogError("PotionAutoPickup: D2R 3.2.92777 trigger signature mismatch; hook refused."); return false;
    }
    context->RegisterConsoleCommand("potion-auto-pickup",Status,"Show PotionAutoPickup native-hook status.");
    context->LogInfo("PotionAutoPickup 1.0 native hook active (D2R 3.2.92777, distance capped to vanilla gold range 4).");
    return true;
}
D2RL_PLUGIN_EXPORT void D2RLoaderUnloadPlugin() noexcept { Context=nullptr; }
