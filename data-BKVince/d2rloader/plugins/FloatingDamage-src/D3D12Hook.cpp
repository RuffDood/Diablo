#include "D3D12Hook.h"

#include "FloatingDamage.h"
#include "resource.h"

#include <MinHook.h>
#include <d3d12.h>
#include <dxgi1_4.h>
#include <imgui.h>
#include <imgui_impl_dx12.h>
#include <imgui_impl_win32.h>
#include <wrl/client.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <cstring>
#include <mutex>
#include <string>
#include <vector>

namespace D3D12 {
namespace {
using Microsoft::WRL::ComPtr;

struct FrameContext {
    ComPtr<ID3D12CommandAllocator> allocator;
    ComPtr<ID3D12Resource> renderTarget;
    D3D12_CPU_DESCRIPTOR_HANDLE descriptor{};
};

using PresentFn = HRESULT(STDMETHODCALLTYPE*)(IDXGISwapChain3*, UINT, UINT);
using ExecuteCommandListsFn = void(STDMETHODCALLTYPE*)(ID3D12CommandQueue*, UINT, ID3D12CommandList* const*);
using ResizeBuffersFn = HRESULT(STDMETHODCALLTYPE*)(IDXGISwapChain3*, UINT, UINT, UINT, DXGI_FORMAT, UINT);

HMODULE Module{};
std::array<void*, 150> Methods{};
PresentFn OriginalPresent{};
ExecuteCommandListsFn OriginalExecuteCommandLists{};
ResizeBuffersFn OriginalResizeBuffers{};

std::mutex RenderMutex;
bool HooksInstalled{};
bool RendererInitialized{};
HWND Window{};
DXGI_FORMAT BackBufferFormat{DXGI_FORMAT_R8G8B8A8_UNORM};

// D2RLoader terminates the process without always invoking the plugin unload
// callback. Keep GPU references in intentionally process-lifetime storage so
// C++ static destruction cannot release them after D3D12Core has shut down.
// Explicit plugin unload and swap-chain resize still release them through
// ResetRenderer().
struct RendererStorage {
    ComPtr<ID3D12CommandQueue> commandQueue;
    ComPtr<ID3D12GraphicsCommandList> commandList;
    ComPtr<ID3D12DescriptorHeap> rtvHeap;
    ComPtr<ID3D12DescriptorHeap> srvHeap;
    std::vector<FrameContext> frames;
};

RendererStorage* const ProcessRendererStorage = new RendererStorage{};
auto& CommandQueue = ProcessRendererStorage->commandQueue;
auto& CommandList = ProcessRendererStorage->commandList;
auto& RtvHeap = ProcessRendererStorage->rtvHeap;
auto& SrvHeap = ProcessRendererStorage->srvHeap;
auto& Frames = ProcessRendererStorage->frames;
std::chrono::steady_clock::time_point LastFrameTime{};
std::atomic<float> DisplayWidth{1920.0f};
std::atomic<float> DisplayHeight{1080.0f};

std::vector<std::vector<unsigned char>> EmbeddedFontData;
std::array<ImFont*, kFloatingDamageFontCount> FloatingFonts{};
constexpr std::array<int, kFloatingDamageFontCount> FontResourceIds{
    IDR_FD_FONT_0, IDR_FD_FONT_1, IDR_FD_FONT_2, IDR_FD_FONT_3,
    IDR_FD_FONT_4, IDR_FD_FONT_5, IDR_FD_FONT_6, IDR_FD_FONT_7,
    IDR_FD_FONT_8, IDR_FD_FONT_9, IDR_FD_FONT_10, IDR_FD_FONT_11
};

void ResetRenderer() noexcept {
    std::scoped_lock lock(RenderMutex);
    if (RendererInitialized) {
        ImGui_ImplDX12_Shutdown();
        ImGui_ImplWin32_Shutdown();
        ImGui::DestroyContext();
    }
    RendererInitialized = false;
    Window = nullptr;
    Frames.clear();
    CommandList.Reset();
    RtvHeap.Reset();
    SrvHeap.Reset();
    CommandQueue.Reset();
    FloatingFonts.fill(nullptr);
    EmbeddedFontData.clear();
    LastFrameTime = {};
}

bool LoadFonts() noexcept {
    EmbeddedFontData.clear();
    EmbeddedFontData.reserve(kFloatingDamageFontCount);
    ImGuiIO& io = ImGui::GetIO();

    for (int index = 0; index < kFloatingDamageFontCount; ++index) {
        const HRSRC resource = FindResourceW(Module, MAKEINTRESOURCEW(FontResourceIds[index]), MAKEINTRESOURCEW(10));
        if (!resource) return false;
        const HGLOBAL loaded = LoadResource(Module, resource);
        const void* data = loaded ? LockResource(loaded) : nullptr;
        const DWORD size = SizeofResource(Module, resource);
        if (!data || size == 0) return false;

        const auto* begin = static_cast<const unsigned char*>(data);
        EmbeddedFontData.emplace_back(begin, begin + size);
        auto& bytes = EmbeddedFontData.back();

        ImFontConfig config{};
        config.OversampleH = 1;
        config.OversampleV = 1;
        config.PixelSnapH = true;
        config.FontDataOwnedByAtlas = false;
        const std::string label = "FloatingDamageFont" + std::to_string(index);
        strncpy_s(config.Name, label.c_str(), _TRUNCATE);
        const float rasterSize = index == 0 ? 24.0f : 32.0f;
        FloatingFonts[index] = io.Fonts->AddFontFromMemoryTTF(
            bytes.data(), static_cast<int>(bytes.size()), rasterSize, &config, io.Fonts->GetGlyphRangesDefault());
        if (!FloatingFonts[index]) return false;
    }
    return true;
}

bool InitializeRenderer(IDXGISwapChain3* swapChain) noexcept {
    ComPtr<ID3D12Device> device;
    if (FAILED(swapChain->GetDevice(IID_PPV_ARGS(&device)))) return false;

    DXGI_SWAP_CHAIN_DESC swapDesc{};
    if (FAILED(swapChain->GetDesc(&swapDesc)) || swapDesc.BufferCount == 0 || !swapDesc.OutputWindow) return false;
    Window = swapDesc.OutputWindow;
    BackBufferFormat = swapDesc.BufferDesc.Format == DXGI_FORMAT_UNKNOWN
        ? DXGI_FORMAT_R8G8B8A8_UNORM
        : swapDesc.BufferDesc.Format;

    D3D12_DESCRIPTOR_HEAP_DESC srvDesc{};
    srvDesc.Type = D3D12_DESCRIPTOR_HEAP_TYPE_CBV_SRV_UAV;
    srvDesc.NumDescriptors = 1;
    srvDesc.Flags = D3D12_DESCRIPTOR_HEAP_FLAG_SHADER_VISIBLE;
    if (FAILED(device->CreateDescriptorHeap(&srvDesc, IID_PPV_ARGS(&SrvHeap)))) return false;

    D3D12_DESCRIPTOR_HEAP_DESC rtvDesc{};
    rtvDesc.Type = D3D12_DESCRIPTOR_HEAP_TYPE_RTV;
    rtvDesc.NumDescriptors = swapDesc.BufferCount;
    if (FAILED(device->CreateDescriptorHeap(&rtvDesc, IID_PPV_ARGS(&RtvHeap)))) return false;

    Frames.clear();
    Frames.resize(swapDesc.BufferCount);
    auto descriptor = RtvHeap->GetCPUDescriptorHandleForHeapStart();
    const UINT descriptorSize = device->GetDescriptorHandleIncrementSize(D3D12_DESCRIPTOR_HEAP_TYPE_RTV);
    for (UINT index = 0; index < swapDesc.BufferCount; ++index) {
        auto& frame = Frames[index];
        if (FAILED(device->CreateCommandAllocator(D3D12_COMMAND_LIST_TYPE_DIRECT, IID_PPV_ARGS(&frame.allocator)))) return false;
        if (FAILED(swapChain->GetBuffer(index, IID_PPV_ARGS(&frame.renderTarget)))) return false;
        frame.descriptor = descriptor;
        device->CreateRenderTargetView(frame.renderTarget.Get(), nullptr, descriptor);
        descriptor.ptr += descriptorSize;
    }

    if (FAILED(device->CreateCommandList(
            0, D3D12_COMMAND_LIST_TYPE_DIRECT, Frames[0].allocator.Get(), nullptr, IID_PPV_ARGS(&CommandList)))) return false;
    if (FAILED(CommandList->Close())) return false;

    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGuiIO& io = ImGui::GetIO();
    io.IniFilename = nullptr;
    ImGui::StyleColorsDark();
    if (!ImGui_ImplWin32_Init(Window)) return false;
    if (!ImGui_ImplDX12_Init(
            device.Get(), swapDesc.BufferCount, BackBufferFormat, SrvHeap.Get(),
            SrvHeap->GetCPUDescriptorHandleForHeapStart(), SrvHeap->GetGPUDescriptorHandleForHeapStart())) return false;
    if (!LoadFonts()) return false;
    if (!ImGui_ImplDX12_CreateDeviceObjects()) return false;

    LastFrameTime = std::chrono::steady_clock::now();
    RendererInitialized = true;
    return true;
}

HRESULT STDMETHODCALLTYPE HookPresent(IDXGISwapChain3* swapChain, UINT syncInterval, UINT flags) noexcept {
    std::scoped_lock lock(RenderMutex);
    if (!CommandQueue) return OriginalPresent(swapChain, syncInterval, flags);
    if (!RendererInitialized && !InitializeRenderer(swapChain)) {
        return OriginalPresent(swapChain, syncInterval, flags);
    }

    const UINT frameIndex = swapChain->GetCurrentBackBufferIndex();
    if (frameIndex >= Frames.size()) return OriginalPresent(swapChain, syncInterval, flags);
    FrameContext& frame = Frames[frameIndex];

    const auto now = std::chrono::steady_clock::now();
    const float delta = std::clamp(std::chrono::duration<float>(now - LastFrameTime).count(), 0.0f, 0.1f);
    LastFrameTime = now;

    ImGui_ImplDX12_NewFrame();
    ImGui_ImplWin32_NewFrame();
    ImGui::NewFrame();
    FloatingDamage::Update(delta);
    const ImGuiIO& io = ImGui::GetIO();
    DisplayWidth.store(io.DisplaySize.x, std::memory_order_relaxed);
    DisplayHeight.store(io.DisplaySize.y, std::memory_order_relaxed);
    FloatingDamage::Render(ImGui::GetBackgroundDrawList(), io.DisplaySize);
    ImGui::Render();

    if (FAILED(frame.allocator->Reset())) return OriginalPresent(swapChain, syncInterval, flags);
    if (FAILED(CommandList->Reset(frame.allocator.Get(), nullptr))) return OriginalPresent(swapChain, syncInterval, flags);

    D3D12_RESOURCE_BARRIER barrier{};
    barrier.Type = D3D12_RESOURCE_BARRIER_TYPE_TRANSITION;
    barrier.Transition.pResource = frame.renderTarget.Get();
    barrier.Transition.Subresource = D3D12_RESOURCE_BARRIER_ALL_SUBRESOURCES;
    barrier.Transition.StateBefore = D3D12_RESOURCE_STATE_PRESENT;
    barrier.Transition.StateAfter = D3D12_RESOURCE_STATE_RENDER_TARGET;
    CommandList->ResourceBarrier(1, &barrier);
    CommandList->OMSetRenderTargets(1, &frame.descriptor, FALSE, nullptr);
    ID3D12DescriptorHeap* heaps[]{SrvHeap.Get()};
    CommandList->SetDescriptorHeaps(1, heaps);
    ImGui_ImplDX12_RenderDrawData(ImGui::GetDrawData(), CommandList.Get());
    std::swap(barrier.Transition.StateBefore, barrier.Transition.StateAfter);
    CommandList->ResourceBarrier(1, &barrier);
    if (FAILED(CommandList->Close())) return OriginalPresent(swapChain, syncInterval, flags);
    ID3D12CommandList* lists[]{CommandList.Get()};
    CommandQueue->ExecuteCommandLists(1, lists);
    return OriginalPresent(swapChain, syncInterval, flags);
}

void STDMETHODCALLTYPE HookExecuteCommandLists(
    ID3D12CommandQueue* queue,
    UINT count,
    ID3D12CommandList* const* lists
) noexcept {
    if (!CommandQueue && queue && queue->GetDesc().Type == D3D12_COMMAND_LIST_TYPE_DIRECT) CommandQueue = queue;
    OriginalExecuteCommandLists(queue, count, lists);
}

HRESULT STDMETHODCALLTYPE HookResizeBuffers(
    IDXGISwapChain3* swapChain,
    UINT bufferCount,
    UINT width,
    UINT height,
    DXGI_FORMAT format,
    UINT flags
) noexcept {
    ResetRenderer();
    return OriginalResizeBuffers(swapChain, bufferCount, width, height, format, flags);
}

bool BuildMethodTable() noexcept {
    const wchar_t* className = L"TCPFloatingDamageProbe";
    WNDCLASSEXW windowClass{};
    windowClass.cbSize = sizeof(windowClass);
    windowClass.lpfnWndProc = DefWindowProcW;
    windowClass.hInstance = Module;
    windowClass.lpszClassName = className;
    if (!RegisterClassExW(&windowClass) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS) return false;

    HWND probeWindow = CreateWindowExW(
        0, className, L"TCP Floating Damage Probe", WS_OVERLAPPEDWINDOW,
        0, 0, 100, 100, nullptr, nullptr, Module, nullptr);
    if (!probeWindow) return false;

    using D3D12CreateDeviceFn = HRESULT(WINAPI*)(IUnknown*, D3D_FEATURE_LEVEL, REFIID, void**);
    HMODULE d3d12Module = GetModuleHandleW(L"d3d12.dll");
    if (!d3d12Module) d3d12Module = LoadLibraryW(L"d3d12.dll");
    const auto createDevice = d3d12Module
        ? reinterpret_cast<D3D12CreateDeviceFn>(GetProcAddress(d3d12Module, "D3D12CreateDevice"))
        : nullptr;
    if (!createDevice) {
        DestroyWindow(probeWindow);
        UnregisterClassW(className, Module);
        return false;
    }

    ComPtr<IDXGIFactory4> factory;
    ComPtr<ID3D12Device> device;
    ComPtr<ID3D12CommandQueue> queue;
    ComPtr<ID3D12CommandAllocator> allocator;
    ComPtr<ID3D12GraphicsCommandList> commandList;
    ComPtr<IDXGISwapChain> swapChain;
    bool success = false;

    do {
        if (FAILED(CreateDXGIFactory1(IID_PPV_ARGS(&factory)))) break;
        if (FAILED(createDevice(nullptr, D3D_FEATURE_LEVEL_11_0, IID_PPV_ARGS(&device)))) break;
        D3D12_COMMAND_QUEUE_DESC queueDesc{};
        queueDesc.Type = D3D12_COMMAND_LIST_TYPE_DIRECT;
        if (FAILED(device->CreateCommandQueue(&queueDesc, IID_PPV_ARGS(&queue)))) break;
        if (FAILED(device->CreateCommandAllocator(D3D12_COMMAND_LIST_TYPE_DIRECT, IID_PPV_ARGS(&allocator)))) break;
        if (FAILED(device->CreateCommandList(
                0, D3D12_COMMAND_LIST_TYPE_DIRECT, allocator.Get(), nullptr, IID_PPV_ARGS(&commandList)))) break;

        DXGI_SWAP_CHAIN_DESC swapDesc{};
        swapDesc.BufferDesc.Width = 100;
        swapDesc.BufferDesc.Height = 100;
        swapDesc.BufferDesc.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
        swapDesc.SampleDesc.Count = 1;
        swapDesc.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
        swapDesc.BufferCount = 2;
        swapDesc.OutputWindow = probeWindow;
        swapDesc.Windowed = TRUE;
        swapDesc.SwapEffect = DXGI_SWAP_EFFECT_FLIP_DISCARD;
        if (FAILED(factory->CreateSwapChain(queue.Get(), &swapDesc, &swapChain))) break;

        std::memcpy(Methods.data(), *reinterpret_cast<void***>(device.Get()), 44 * sizeof(void*));
        std::memcpy(Methods.data() + 44, *reinterpret_cast<void***>(queue.Get()), 19 * sizeof(void*));
        std::memcpy(Methods.data() + 63, *reinterpret_cast<void***>(allocator.Get()), 9 * sizeof(void*));
        std::memcpy(Methods.data() + 72, *reinterpret_cast<void***>(commandList.Get()), 60 * sizeof(void*));
        std::memcpy(Methods.data() + 132, *reinterpret_cast<void***>(swapChain.Get()), 18 * sizeof(void*));
        success = true;
    } while (false);

    DestroyWindow(probeWindow);
    UnregisterClassW(className, Module);
    return success;
}

bool CreateHook(std::size_t methodIndex, void* target, void** original) noexcept {
    void* address = Methods[methodIndex];
    if (!address) return false;
    const MH_STATUS created = MH_CreateHook(address, target, original);
    if (created != MH_OK && created != MH_ERROR_ALREADY_CREATED) return false;
    const MH_STATUS enabled = MH_EnableHook(address);
    return enabled == MH_OK || enabled == MH_ERROR_ENABLED;
}
} // namespace

void SetDllModule(HMODULE module) noexcept {
    Module = module;
}

bool InstallHooks() noexcept {
    if (HooksInstalled) return true;
    if (!Module || !BuildMethodTable()) return false;
    const MH_STATUS initialized = MH_Initialize();
    if (initialized != MH_OK && initialized != MH_ERROR_ALREADY_INITIALIZED) return false;
    if (!CreateHook(54, reinterpret_cast<void*>(HookExecuteCommandLists), reinterpret_cast<void**>(&OriginalExecuteCommandLists))) return false;
    if (!CreateHook(140, reinterpret_cast<void*>(HookPresent), reinterpret_cast<void**>(&OriginalPresent))) {
        MH_DisableHook(Methods[54]);
        return false;
    }
    if (!CreateHook(145, reinterpret_cast<void*>(HookResizeBuffers), reinterpret_cast<void**>(&OriginalResizeBuffers))) {
        MH_DisableHook(Methods[140]);
        MH_DisableHook(Methods[54]);
        return false;
    }
    HooksInstalled = true;
    return true;
}

void RemoveHooks() noexcept {
    if (!HooksInstalled) return;
    MH_DisableHook(Methods[145]);
    MH_DisableHook(Methods[140]);
    MH_DisableHook(Methods[54]);
    ResetRenderer();
    HooksInstalled = false;
}

ImFont* GetFloatingDamageFont(int index) noexcept {
    if (index < 0 || index >= kFloatingDamageFontCount) return nullptr;
    return FloatingFonts[static_cast<std::size_t>(index)];
}

void GetDisplaySize(float& width, float& height) noexcept {
    width = DisplayWidth.load(std::memory_order_relaxed);
    height = DisplayHeight.load(std::memory_order_relaxed);
}

} // namespace D3D12
