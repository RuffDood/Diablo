cmake_minimum_required(VERSION 3.28)
project(CharmInventoryAuras LANGUAGES CXX RC)

include(FetchContent)
FetchContent_Declare(
    D2RLPlugin
    GIT_REPOSITORY https://github.com/D2RLoader/PluginSDK.git
    GIT_TAG efcfaaa52eeec9e379b3fc2aad1013bb3dddc970
)
FetchContent_MakeAvailable(D2RLPlugin)

add_library(CharmInventoryAuras SHARED plugin.cpp plugin.rc)
target_compile_features(CharmInventoryAuras PRIVATE cxx_std_20)
target_link_libraries(CharmInventoryAuras PRIVATE D2RLPlugin::D2RLPlugin)
set_target_properties(CharmInventoryAuras PROPERTIES OUTPUT_NAME "CharmInventoryAuras")

add_executable(CharmInventoryAurasTests policy_tests.cpp)
target_compile_features(CharmInventoryAurasTests PRIVATE cxx_std_20)
enable_testing()
add_test(NAME charm-inventory-auras-policy COMMAND CharmInventoryAurasTests)
