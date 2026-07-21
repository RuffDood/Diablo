cmake_minimum_required(VERSION 3.24)
project(ReviveOverhaul LANGUAGES CXX RC)

include(FetchContent)
FetchContent_Declare(
    D2RLPlugin
    GIT_REPOSITORY https://github.com/D2RLoader/PluginSDK.git
    GIT_TAG efcfaaa52eeec9e379b3fc2aad1013bb3dddc970
)
FetchContent_MakeAvailable(D2RLPlugin)

add_library(ReviveOverhaul SHARED plugin.cpp plugin.rc)
target_compile_features(ReviveOverhaul PRIVATE cxx_std_20)
target_link_libraries(ReviveOverhaul PRIVATE D2RLPlugin::D2RLPlugin)
set_target_properties(ReviveOverhaul PROPERTIES OUTPUT_NAME "ReviveOverhaul")

add_executable(ReviveOverhaulTests policy_tests.cpp)
target_compile_features(ReviveOverhaulTests PRIVATE cxx_std_20)
enable_testing()
add_test(NAME revive-ai-policy COMMAND ReviveOverhaulTests)
