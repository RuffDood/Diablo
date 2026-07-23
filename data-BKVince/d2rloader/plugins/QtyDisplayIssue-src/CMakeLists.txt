cmake_minimum_required(VERSION 3.28)
project(QtyDisplayIssue LANGUAGES CXX RC)

include(FetchContent)
FetchContent_Declare(
    D2RLPlugin
    GIT_REPOSITORY https://github.com/D2RLoader/PluginSDK.git
    GIT_TAG efcfaaa52eeec9e379b3fc2aad1013bb3dddc970
)
FetchContent_Declare(
    nlohmann_json
    GIT_REPOSITORY https://github.com/nlohmann/json.git
    GIT_TAG v3.11.3
    GIT_SHALLOW TRUE
)
FetchContent_MakeAvailable(D2RLPlugin)
FetchContent_MakeAvailable(nlohmann_json)

add_library(QtyDisplayIssue SHARED
    plugin.cpp
    plugin.rc
    quantity_tooltip.cpp
)
target_compile_features(QtyDisplayIssue PRIVATE cxx_std_20)
target_link_libraries(QtyDisplayIssue PRIVATE
    D2RLPlugin::D2RLPlugin
    nlohmann_json::nlohmann_json
)
set_target_properties(QtyDisplayIssue PROPERTIES OUTPUT_NAME "QtyDisplayIssue")

add_executable(QtyDisplayIssueTests
    quantity_tooltip.cpp
    quantity_tooltip_tests.cpp
)
target_compile_features(QtyDisplayIssueTests PRIVATE cxx_std_20)
enable_testing()
add_test(NAME qty-display-issue-tooltip COMMAND QtyDisplayIssueTests)
