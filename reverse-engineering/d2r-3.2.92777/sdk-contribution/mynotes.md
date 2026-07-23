# D2RLoader SDK notes from RuffnecKk — D2R 3.2.92777

Hey Dimentio — these are the table and layout bits I ended up proving while
building and testing my plugins. I kept this intentionally
small. It is not supposed to be a complete SDK map; it is just the part I can
back up right now without handing you a pile of guesses.

The machine-readable copy is in `sdk-candidates.json`, and
`verified-layouts.hpp` contains the smallest C++ definitions that match the
evidence below.

## Build pin

- D2R build: `3.2.92777`
- Image base: `0x140000000`
- Canonical image SHA-256:
  `CC59119DC2A6C7D43D088098FC162EAFA4AE1299B2079126AEF43C1ACA914715`
- Analysis image SHA-256:
  `673E8C0B2E89563E75525B24D137098EFD07B2DB4ED42ADEC56AA1ADDF0E63AB`

I would keep every RVA below build-specific. The layouts may survive another
build, but I would still verify them before treating them as portable.

## Compiled data-table access

The clean entry point I have is:

```cpp
using GetDataTablesForContextFn = std::uint8_t* (__fastcall*)(std::uint8_t context);
// D2R.exe + 0x300A90
```

It returns the active compiled data-table container for the requested data
context. My plugins use the function instead of reading the global table array
directly.

| Table | Records pointer | Count | Record size | Provenance |
|---|---:|---:|---:|---|
| `skills.txt` | `dataTables + 0x11B0` | `+0x11B8` (`uint64_t`) | `0x2EC` | Already used by eezstreet's `plugin-skills`; included here so the registry stays consistent |
| `itemtypes.txt` | `dataTables + 0x1348` | `+0x1350` (`uint64_t`) | `0xE8` | Independently used by my `NoEtherealItemTypes` and `DurabilityResistance` plugins |
| combined `weapons.txt` / `armor.txt` / `misc.txt` (`D2ItemsTxt`) | `dataTables + 0x15A0` | `+0x15A8` (`uint64_t`) | `0x1C0` | Already used by eezstreet's `plugin-items`; the stride and fields below are also independently used by my plugins |

eezstreet's current pack also identifies the raw `sgptDataTables` array at RVA
`0x2A9A580`, indexed with a 16-byte context stride. I am listing it for
completeness, but an SDK function returning a table view would be safer than
making every plugin repeat that raw-global access.

The API shape I had in mind is roughly this, but I do not care about the exact
names:

```cpp
auto table = context->GetDataTable("itemtypes");
// table.records, table.count, table.recordSize
```

That would remove the build-specific container offsets from individual plugins.

## `itemtypes.txt` record fields I actually use

| Offset | Type | Meaning |
|---:|---|---|
| `+0x00` | `char[4]` / `uint32_t` | item type code |
| `+0x04` | `uint16_t` | first parent/equivalent type ID |
| `+0x06` | `uint16_t` | second parent/equivalent type ID |
| `+0x08` | `uint8_t` | repair flag |

The record stride is `0xE8`. `NoEtherealItemTypes` resolves configured codes
from this table and then asks the game's own item-type helper to preserve the
native inheritance rules. `DurabilityResistance` independently walks the same
parent fields and changes the repair byte for the concrete bow/crossbow types.

The strongest runtime check so far was the ranged-durability test: the plugin
reread all 42 matching runtime records after mutation, with `nodurability=0` on
the item rows and `repair=1` on their concrete item-type rows. Short Bow, Light
Crossbow and Stag Bow also returned the expected durability values (20, 30 and
48).

## Canonical layout candidates

### `D2UnitStrc +0x04` is not `unitFlags`

This one is probably the most useful cleanup item.

The shared header in eezstreet's pack currently calls the dword at `+0x04`
`unitFlags`. The native getter at RVA `0x349860` is a tiny direct read of
`dword [unit+0x04]`, and its callers use the result as the unit class/TXT record
ID. My Charsi reward plugin uses the same field for MonStats class IDs; the
configured Andariel target resolves to MonStats ID 156, and the kill hook
compares this unit field against that ID. Transmogrify uses the native getter
for item class IDs.

`plugin-items` also takes the low 16 bits of this field as its NPC ID, which is
consistent with a TXT record ID. I would name it `classId` or `txtRecordId` in a
canonical SDK structure, not `unitFlags`.

The adjacent unit type field is confirmed separately:

| Structure | Offset | Type | Meaning | Native getter |
|---|---:|---|---|---:|
| `D2UnitStrc` | `+0x00` | `uint32_t` | unit type (`0` player, `1` monster, `4` item) | `0x34B9D0` |
| `D2UnitStrc` | `+0x04` | `uint32_t` | class/TXT record ID | `0x349860` |

### Other fields used by my plugins

| Structure | Offset | Type | Meaning | Used by |
|---|---:|---|---|---|
| `D2GameStrc` | `+0x104` | `uint8_t` | difficulty (`0..2`) | Configurable Charsi Reward |
| `D2GameStrc` | `+0x106` | `uint8_t` | expansion flag | Transmogrify |
| `D2ItemsTxt` | stride `0x1C0` | — | compiled item record size | Transmogrify, Durability Resistance |
| `D2ItemsTxt` | `+0xFC` | `uint16_t` | localized name string ID | Transmogrify |
| `D2ItemsTxt` | `+0x121` | `uint8_t` | durability | Durability Resistance |
| `D2ItemsTxt` | `+0x122` | `uint8_t` | no-durability flag | Durability Resistance |
| `D2ItemsTxt` | `+0x12E` | `uint16_t` | primary item-type ID | Durability Resistance |

I am not claiming the full `D2ItemsTxt`, `D2SkillsTxt`, `D2GameStrc` or
`D2UnitStrc` definitions as my work. eezstreet already mapped a much larger
surface in `plugin-shared`. The list above is deliberately limited to fields my
plugins exercised or that the 92777 workbench proves directly.

## Native helpers that may be better SDK wrappers than raw table access

These did not reveal new container offsets, so I kept them out of the table
list. They are still reusable SDK candidates because they prevent plugins from
reimplementing game rules.

| Helper | RVA | ABI used by the plugin | What it proved |
|---|---:|---|---|
| `SKILLS_GetRuntimeMaxLevel` | `0x214220` | `int32_t __fastcall(uint8_t context, int32_t skillId)` | Returns the active mod's effective skill cap instead of assuming vanilla level 20 |
| `SKILLTREE_CanAllocateSkill` | `0x14C3DA0` | `bool __fastcall(int32_t skillId)` | Runs the native next-rank gate, including points, custom costs, class, prerequisites, attributes, required level, runtime cap and blocking state |
| `ITEMS_GetMaxSockets` | `0x36EAD0` | `uint8_t __fastcall(void* item)` | Returns the concrete item's socket cap after applying item level, base item and item-type limits |

`BulkSkillPointAllocation` uses the first two together: it reads the real
runtime cap, then asks the native allocation gate again before every queued
rank. The policy tests cover caps of 20, 25 and 30, while the plugin itself
continues to treat the runtime result as authoritative instead of hardcoding
one of those values.

`AdvancedItemTooltips` calls `ITEMS_GetMaxSockets` directly rather than copying
the socket rules. A public SDK wrapper for this kind of stable game service is
probably safer than exposing every internal field needed to reproduce the same
answer.

## One other confirmed engine table

This is separate from the compiled TXT table container, but it may eventually
belong in an engine-table part of the SDK:

- AI special-state table: RVA `0x23981F0`
- record size: `0x20`
- resolver: `AITHINK_GetAiTableRecord`, RVA `0x4A36C0`
- revived/NecroPet state: index `7`, record RVA `0x23982D0`

The resolver multiplies the accepted state by 32 before adding the table base.
I used this path while rebuilding the Revive AI behavior.



If this format is useful, I can keep adding small verified batches as new
plugins prove more fields instead of sending one giant unreviewed map.
