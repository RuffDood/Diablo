#pragma once

#include <Windows.h>

struct ImFont;

namespace D3D12 {

constexpr int kFloatingDamageFontCount = 12;

void SetDllModule(HMODULE module) noexcept;
bool InstallHooks() noexcept;
void RemoveHooks() noexcept;
ImFont* GetFloatingDamageFont(int index) noexcept;
void GetDisplaySize(float& width, float& height) noexcept;

} // namespace D3D12
