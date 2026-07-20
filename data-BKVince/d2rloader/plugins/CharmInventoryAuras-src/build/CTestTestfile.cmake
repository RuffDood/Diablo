# CMake generated Testfile for 
# Source directory: C:/Workspaces/Diablo/data-BKVince/d2rloader/plugins/CharmInventoryAuras-src
# Build directory: C:/Workspaces/Diablo/data-BKVince/d2rloader/plugins/CharmInventoryAuras-src/build
# 
# This file includes the relevant testing commands required for 
# testing this directory and lists subdirectories to be tested as well.
if(CTEST_CONFIGURATION_TYPE MATCHES "^([Dd][Ee][Bb][Uu][Gg])$")
  add_test([=[charm-inventory-auras-policy]=] "C:/Workspaces/Diablo/data-BKVince/d2rloader/plugins/CharmInventoryAuras-src/build/Debug/CharmInventoryAurasTests.exe")
  set_tests_properties([=[charm-inventory-auras-policy]=] PROPERTIES  _BACKTRACE_TRIPLES "C:/Workspaces/Diablo/data-BKVince/d2rloader/plugins/CharmInventoryAuras-src/CMakeLists.txt;20;add_test;C:/Workspaces/Diablo/data-BKVince/d2rloader/plugins/CharmInventoryAuras-src/CMakeLists.txt;0;")
elseif(CTEST_CONFIGURATION_TYPE MATCHES "^([Rr][Ee][Ll][Ee][Aa][Ss][Ee])$")
  add_test([=[charm-inventory-auras-policy]=] "C:/Workspaces/Diablo/data-BKVince/d2rloader/plugins/CharmInventoryAuras-src/build/Release/CharmInventoryAurasTests.exe")
  set_tests_properties([=[charm-inventory-auras-policy]=] PROPERTIES  _BACKTRACE_TRIPLES "C:/Workspaces/Diablo/data-BKVince/d2rloader/plugins/CharmInventoryAuras-src/CMakeLists.txt;20;add_test;C:/Workspaces/Diablo/data-BKVince/d2rloader/plugins/CharmInventoryAuras-src/CMakeLists.txt;0;")
elseif(CTEST_CONFIGURATION_TYPE MATCHES "^([Mm][Ii][Nn][Ss][Ii][Zz][Ee][Rr][Ee][Ll])$")
  add_test([=[charm-inventory-auras-policy]=] "C:/Workspaces/Diablo/data-BKVince/d2rloader/plugins/CharmInventoryAuras-src/build/MinSizeRel/CharmInventoryAurasTests.exe")
  set_tests_properties([=[charm-inventory-auras-policy]=] PROPERTIES  _BACKTRACE_TRIPLES "C:/Workspaces/Diablo/data-BKVince/d2rloader/plugins/CharmInventoryAuras-src/CMakeLists.txt;20;add_test;C:/Workspaces/Diablo/data-BKVince/d2rloader/plugins/CharmInventoryAuras-src/CMakeLists.txt;0;")
elseif(CTEST_CONFIGURATION_TYPE MATCHES "^([Rr][Ee][Ll][Ww][Ii][Tt][Hh][Dd][Ee][Bb][Ii][Nn][Ff][Oo])$")
  add_test([=[charm-inventory-auras-policy]=] "C:/Workspaces/Diablo/data-BKVince/d2rloader/plugins/CharmInventoryAuras-src/build/RelWithDebInfo/CharmInventoryAurasTests.exe")
  set_tests_properties([=[charm-inventory-auras-policy]=] PROPERTIES  _BACKTRACE_TRIPLES "C:/Workspaces/Diablo/data-BKVince/d2rloader/plugins/CharmInventoryAuras-src/CMakeLists.txt;20;add_test;C:/Workspaces/Diablo/data-BKVince/d2rloader/plugins/CharmInventoryAuras-src/CMakeLists.txt;0;")
else()
  add_test([=[charm-inventory-auras-policy]=] NOT_AVAILABLE)
endif()
subdirs("_deps/d2rlplugin-build")
