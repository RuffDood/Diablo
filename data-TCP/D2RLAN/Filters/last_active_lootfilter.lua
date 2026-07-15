--- Filter Title: No Filter
--- Filter Type: (None)
--- Filter Description: This is not a filter, it applies no changes.
return {
    allowOverrides = true,
    rules = {
        { --Display item levels for weapons, armors, charms, jewels, rings, amulets and arrows/bolts, to the right of item name, (x)
            codes = "allitems",
            location = { "onground", "onplayer", "equipped", "atvendor" },
            itype = { 5, 6, 10, 12, 45, 50, 58, 82, 83, 84 },
            --Disabled by D2RLAN suffix = " ({ilvl})",
        },

    }
}
