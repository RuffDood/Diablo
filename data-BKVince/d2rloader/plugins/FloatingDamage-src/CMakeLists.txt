cmake_minimum_required(VERSION 3.28)
project(FloatingDamage LANGUAGES CXX RC)

include(FetchContent)

FetchContent_Declare(
    D2RLPlugin
    GIT_REPOSITORY https://github.com/D2RLoader/PluginSDK.git
    GIT_TAG efcfaaa52eeec9e379b3fc2aad1013bb3dddc970
)
FetchContent_Declare(
    imgui
    GIT_REPOSITORY https://github.com/ocornut/imgui.git
    GIT_TAG v1.91.5
)
FetchContent_Declare(
    minhook
    GIT_REPOSITORY https://github.com/TsudaKageyu/minhook.git
    GIT_TAG v1.3.4
)
FetchContent_Declare(
    nlohmann_json
    GIT_REPOSITORY https://github.com/nlohmann/json.git
    GIT_TAG v3.11.3
)
FetchContent_MakeAvailable(D2RLPlugin imgui minhook nlohmann_json)

add_library(FloatingDamageImGui STATIC
    ${imgui_SOURCE_DIR}/imgui.cpp
    ${imgui_SOURCE_DIR}/imgui_draw.cpp
    ${imgui_SOURCE_DIR}/imgui_tables.cpp
    ${imgui_SOURCE_DIR}/imgui_widgets.cpp
    ${imgui_SOURCE_DIR}/backends/imgui_impl_win32.cpp
    ${imgui_SOURCE_DIR}/backends/imgui_impl_dx12.cpp
)
target_include_directories(FloatingDamageImGui PUBLIC
    ${imgui_SOURCE_DIR}
    ${imgui_SOURCE_DIR}/backends
)
target_compile_features(FloatingDamageImGui PUBLIC cxx_std_20)
target_compile_definitions(FloatingDamageImGui PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX)
target_link_libraries(FloatingDamageImGui PUBLIC dxgi)

add_library(FloatingDamage SHARED
    plugin.cpp
    FloatingDamage.cpp
    D3D12Hook.cpp
    plugin.rc
)
target_compile_features(FloatingDamage PRIVATE cxx_std_20)
target_compile_definitions(FloatingDamage PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX)
target_link_libraries(FloatingDamage PRIVATE
    D2RLPlugin::D2RLPlugin
    FloatingDamageImGui
    minhook
    nlohmann_json::nlohmann_json
    dxgi
)
set_target_properties(FloatingDamage PROPERTIES OUTPUT_NAME "FloatingDamage")

if(MSVC)
    target_compile_options(FloatingDamage PRIVATE /W4 /permissive- /EHsc)
endif()
