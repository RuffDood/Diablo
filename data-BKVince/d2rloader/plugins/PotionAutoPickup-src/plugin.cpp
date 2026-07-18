#include <D2RLPlugin/api.h>
#include "router.hpp"
#include <array>
#include <cstdint>

namespace {
const D2RL::PluginContext* Context{};
constexpr D2RL::PluginInfo Info{
    .infoSize=D2RL::PluginInfoSize, .apiVersion=D2RL_PLUGIN_API_VERSION,
    .id="potion-auto-pickup", .name="PotionAutoPickup", .version="0.1.0",
    .author="TCP", .description="Configurable healing, mana and rejuvenation autopickup for BKVince.",
    .flags=D2RL::PluginFlags::ModScopedOnly | D2RL::PluginFlags::NativeHooks,
};
auto Status(D2R::Game::Client*, const D2RL::ConsoleCommandContext* command, void*) noexcept -> D2RL::ConsoleCommandResult {
    if (!command || !command->plugin) return D2RL::ConsoleCommandResult::Failed;
    command->plugin->WriteConsoleMessage("PotionAutoPickup: policy core loaded; gameplay hooks disabled until all build 92777 signatures are proven.");
    return D2RL::ConsoleCommandResult::Handled;
}
}
D2RL_PLUGIN_EXPORT auto D2RLoaderGetPluginInfo() noexcept -> const D2RL::PluginInfo* { return &Info; }
D2RL_PLUGIN_EXPORT auto D2RLoaderLoadPlugin(const D2RL::PluginContext* context) noexcept -> bool {
    if (!context || !context->EnsureConfig()) return false;
    Context=context;
    if (!context->RegisterConsoleCommand("potion-auto-pickup",Status,"Show PotionAutoPickup status.")) {
        context->LogWarn("Autopickup status command was not registered.");
    }
    context->LogWarn("Policy core loaded, but gameplay hooks are fail-closed pending complete D2R 3.2.92777 signature validation.");
    return true;
}
D2RL_PLUGIN_EXPORT void D2RLoaderUnloadPlugin() noexcept { Context=nullptr; }
