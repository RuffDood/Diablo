Hey Dimentio — I went through the table/layout work that came out of my 92777 plugins and pulled out only the parts I can actually back up.

The most complete new table entry on my side is `itemtypes.txt`: records are at `dataTables + 0x1348`, count at `+0x1350` (`uint64_t`), and the record stride is `0xE8`. The fields I have exercised are code `+0x00`, parent/equivalent IDs `+0x04/+0x06`, and repair `+0x08`. Two separate plugins use that layout, and one of the runtime tests reread all 42 affected bow/crossbow records after changing them.

I also found one likely correction for a canonical unit structure: the dword at `D2UnitStrc +0x04` is currently named `unitFlags` in eezstreet's shared header, but the native getter at `0x349860` directly returns it as the class/TXT record ID. The configured Andariel target in my Charsi plugin resolves to MonStats ID 156, and the kill hook compares this unit field against that ID. Transmogrify also uses the native getter for item class IDs. So I think that field should be named `classId` or `txtRecordId`, not `unitFlags`.

Bulk Skill Allocation and the max-sockets tooltip also produced a few useful SDK helper candidates rather than new table offsets: `0x214220` returns the active mod's real skill cap, `0x14C3DA0` runs the native next-rank eligibility check, and `0x36EAD0` returns the concrete item's maximum sockets after applying item level/base/type rules. Wrapping those would keep plugins from duplicating the underlying table logic.

I put the exact table offsets, the small verified layout fragments, provenance, and the two real hook collisions I found in a short package. I deliberately left out raw Ghidra output, speculative mappings and unrelated patch RVAs so it should be reviewable instead of being a random dump.

If this is the kind of list you meant, I can keep sending small verified batches as more plugins prove additional tables/fields.
