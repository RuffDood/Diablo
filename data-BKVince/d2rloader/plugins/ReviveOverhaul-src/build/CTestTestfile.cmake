# CMake generated Testfile for 
# Source directory: C:/Workspaces/Diablo/data-BKVince/d2rloader/plugins/ReviveOverhaul-src
# Build directory: C:/Workspaces/Diablo/data-BKVince/d2rloader/plugins/ReviveOverhaul-src/build
# 
# This file includes the relevant testing commands required for 
# testing this directory and lists subdirectories to be tested as well.
if(CTEST_CONFIGURATION_TYPE MATCHES "^([Dd][Ee][Bb][Uu][Gg])$")
  add_test([=[revive-ai-policy]=] "C:/Workspaces/Diablo/data-BKVince/d2rloader/plugins/ReviveOverhaul-src/build/Debug/ReviveOverhaulTests.exe")
  set_tests_properties([=[revive-ai-policy]=] PROPERTIES  _BACKTRACE_TRIPLES "C:/Workspaces/Diablo/data-BKVince/d2rloader/plugins/ReviveOverhaul-src/CMakeLists.txt;20;add_test;C:/Workspaces/Diablo/data-BKVince/d2rloader/plugins/ReviveOverhaul-src/CMakeLists.txt;0;")
elseif(CTEST_CONFIGURATION_TYPE MATCHES "^([Rr][Ee][Ll][Ee][Aa][Ss][Ee])$")
  add_test([=[revive-ai-policy]=] "C:/Workspaces/Diablo/data-BKVince/d2rloader/plugins/ReviveOverhaul-src/build/Release/ReviveOverhaulTests.exe")
  set_tests_properties([=[revive-ai-policy]=] PROPERTIES  _BACKTRACE_TRIPLES "C:/Workspaces/Diablo/data-BKVince/d2rloader/plugins/ReviveOverhaul-src/CMakeLists.txt;20;add_test;C:/Workspaces/Diablo/data-BKVince/d2rloader/plugins/ReviveOverhaul-src/CMakeLists.txt;0;")
elseif(CTEST_CONFIGURATION_TYPE MATCHES "^([Mm][Ii][Nn][Ss][Ii][Zz][Ee][Rr][Ee][Ll])$")
  add_test([=[revive-ai-policy]=] "C:/Workspaces/Diablo/data-BKVince/d2rloader/plugins/ReviveOverhaul-src/build/MinSizeRel/ReviveOverhaulTests.exe")
  set_tests_properties([=[revive-ai-policy]=] PROPERTIES  _BACKTRACE_TRIPLES "C:/Workspaces/Diablo/data-BKVince/d2rloader/plugins/ReviveOverhaul-src/CMakeLists.txt;20;add_test;C:/Workspaces/Diablo/data-BKVince/d2rloader/plugins/ReviveOverhaul-src/CMakeLists.txt;0;")
elseif(CTEST_CONFIGURATION_TYPE MATCHES "^([Rr][Ee][Ll][Ww][Ii][Tt][Hh][Dd][Ee][Bb][Ii][Nn][Ff][Oo])$")
  add_test([=[revive-ai-policy]=] "C:/Workspaces/Diablo/data-BKVince/d2rloader/plugins/ReviveOverhaul-src/build/RelWithDebInfo/ReviveOverhaulTests.exe")
  set_tests_properties([=[revive-ai-policy]=] PROPERTIES  _BACKTRACE_TRIPLES "C:/Workspaces/Diablo/data-BKVince/d2rloader/plugins/ReviveOverhaul-src/CMakeLists.txt;20;add_test;C:/Workspaces/Diablo/data-BKVince/d2rloader/plugins/ReviveOverhaul-src/CMakeLists.txt;0;")
else()
  add_test([=[revive-ai-policy]=] NOT_AVAILABLE)
endif()
subdirs("_deps/d2rlplugin-build")
