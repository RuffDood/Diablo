cmake_minimum_required(VERSION 3.24)
project(PotionAutoPickup LANGUAGES CXX RC)

include(FetchContent)
FetchContent_Declare(D2RLPlugin GIT_REPOSITORY https://github.com/D2RLoader/PluginSDK.git GIT_TAG efcfaaa52eeec9e379b3fc2aad1013bb3dddc970)
FetchContent_MakeAvailable(D2RLPlugin)

add_library(PotionAutoPickup SHARED plugin.cpp plugin.rc)
target_compile_features(PotionAutoPickup PRIVATE cxx_std_20)
target_link_libraries(PotionAutoPickup PRIVATE D2RLPlugin::D2RLPlugin)
set_target_properties(PotionAutoPickup PROPERTIES OUTPUT_NAME "PotionAutoPickup")

add_executable(PotionAutoPickupTests router_tests.cpp)
target_compile_features(PotionAutoPickupTests PRIVATE cxx_std_20)
enable_testing()
add_test(NAME router-policy COMMAND PotionAutoPickupTests)
