cmake_minimum_required(VERSION 3.24)
project(ConfigurableCharsiReward LANGUAGES CXX RC)

include(FetchContent)
FetchContent_Declare(
    D2RLPlugin
    GIT_REPOSITORY https://github.com/D2RLoader/PluginSDK.git
    GIT_TAG efcfaaa52eeec9e379b3fc2aad1013bb3dddc970
)
FetchContent_MakeAvailable(D2RLPlugin)

add_library(ConfigurableCharsiReward SHARED plugin.cpp plugin.rc)
target_compile_features(ConfigurableCharsiReward PRIVATE cxx_std_20)
target_link_libraries(ConfigurableCharsiReward PRIVATE D2RLPlugin::D2RLPlugin)
set_target_properties(ConfigurableCharsiReward PROPERTIES OUTPUT_NAME "ConfigurableCharsiReward")

add_executable(ConfigurableCharsiRewardTests reward_tests.cpp)
target_compile_features(ConfigurableCharsiRewardTests PRIVATE cxx_std_20)
enable_testing()
add_test(NAME native-charsi-reward-state COMMAND ConfigurableCharsiRewardTests)
