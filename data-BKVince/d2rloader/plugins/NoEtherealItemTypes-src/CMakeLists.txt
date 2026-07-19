cmake_minimum_required(VERSION 3.28)
project(NoEtherealItemTypes LANGUAGES CXX RC)

include(FetchContent)
FetchContent_Declare(
    D2RLPlugin
    GIT_REPOSITORY https://github.com/D2RLoader/PluginSDK.git
    GIT_TAG efcfaaa52eeec9e379b3fc2aad1013bb3dddc970
)
FetchContent_MakeAvailable(D2RLPlugin)

add_library(NoEtherealItemTypes SHARED plugin.cpp plugin.rc)
target_compile_features(NoEtherealItemTypes PRIVATE cxx_std_20)
target_link_libraries(NoEtherealItemTypes PRIVATE D2RLPlugin::D2RLPlugin)
set_target_properties(NoEtherealItemTypes PROPERTIES OUTPUT_NAME "NoEtherealItemTypes")

add_executable(NoEtherealItemTypesTests policy_tests.cpp)
target_compile_features(NoEtherealItemTypesTests PRIVATE cxx_std_20)
enable_testing()
add_test(NAME no-ethereal-item-types-policy COMMAND NoEtherealItemTypesTests)
