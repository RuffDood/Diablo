option(BUILD_PLUGIN_ITEMS  "Build the Items plugin"  ON)
option(BUILD_PLUGIN_LEVELS "Build the Levels plugin" ON)
option(BUILD_PLUGIN_MISC   "Build the Misc plugin"   ON)
option(BUILD_PLUGIN_QUESTS "Build the Quests plugin" ON)
option(BUILD_PLUGIN_SKILLS "Build the Skills plugin" ON)

add_subdirectory(plugin-shared)

if(BUILD_PLUGIN_ITEMS)
	add_subdirectory(plugin-items)
endif()

if(BUILD_PLUGIN_LEVELS)
	add_subdirectory(plugin-levels)
endif()

if(BUILD_PLUGIN_MISC)
	add_subdirectory(plugin-misc)
endif()

if(BUILD_PLUGIN_QUESTS)
	add_subdirectory(plugin-quests)
endif()

if(BUILD_PLUGIN_SKILLS)
	add_subdirectory(plugin-skills)
endif()
