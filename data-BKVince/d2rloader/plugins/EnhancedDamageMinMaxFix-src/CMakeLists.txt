cmake_minimum_required(VERSION 3.24)
project(EnhancedDamageMinMaxFix LANGUAGES CXX RC)

include(FetchContent)
FetchContent_Declare(
    D2RLPlugin
    GIT_REPOSITORY https://github.com/D2RLoader/PluginSDK.git
    GIT_TAG efcfaaa52eeec9e379b3fc2aad1013bb3dddc970
)
FetchContent_MakeAvailable(D2RLPlugin)

add_library(EnhancedDamageMinMaxFix SHARED plugin.cpp plugin.rc)
target_compile_features(EnhancedDamageMinMaxFix PRIVATE cxx_std_20)
target_link_libraries(EnhancedDamageMinMaxFix PRIVATE D2RLPlugin::D2RLPlugin)
set_target_properties(EnhancedDamageMinMaxFix PROPERTIES OUTPUT_NAME "EnhancedDamageMinMaxFix")

add_executable(EnhancedDamageMinMaxFixTests correction_policy_tests.cpp)
target_compile_features(EnhancedDamageMinMaxFixTests PRIVATE cxx_std_20)
enable_testing()
add_test(NAME enhanced-damage-min-max-policy COMMAND EnhancedDamageMinMaxFixTests)
