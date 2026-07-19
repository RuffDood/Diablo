cmake_minimum_required(VERSION 3.24)
project(DurabilityResistance LANGUAGES CXX RC)

include(FetchContent)
FetchContent_Declare(
    D2RLPlugin
    GIT_REPOSITORY https://github.com/D2RLoader/PluginSDK.git
    GIT_TAG efcfaaa52eeec9e379b3fc2aad1013bb3dddc970
)
FetchContent_MakeAvailable(D2RLPlugin)

add_library(DurabilityResistance SHARED plugin.cpp plugin.rc)
target_compile_features(DurabilityResistance PRIVATE cxx_std_20)
target_link_libraries(DurabilityResistance PRIVATE D2RLPlugin::D2RLPlugin)
set_target_properties(DurabilityResistance PROPERTIES OUTPUT_NAME "DurabilityResistance")

add_executable(DurabilityResistanceTests policy_tests.cpp)
target_compile_features(DurabilityResistanceTests PRIVATE cxx_std_20)
enable_testing()
add_test(NAME durability-policy COMMAND DurabilityResistanceTests)
