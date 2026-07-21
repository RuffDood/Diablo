cmake_minimum_required(VERSION 3.24)
project(Transmogrify LANGUAGES CXX RC)

include(FetchContent)
FetchContent_Declare(D2RLPlugin
    GIT_REPOSITORY https://github.com/D2RLoader/PluginSDK.git
    GIT_TAG efcfaaa52eeec9e379b3fc2aad1013bb3dddc970)
FetchContent_MakeAvailable(D2RLPlugin)

add_library(Transmogrify SHARED plugin.cpp plugin.rc)
target_compile_features(Transmogrify PRIVATE cxx_std_20)
target_link_libraries(Transmogrify PRIVATE D2RLPlugin::D2RLPlugin)
set_target_properties(Transmogrify PROPERTIES OUTPUT_NAME "Transmogrify")
