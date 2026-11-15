# Test Drive 3 - LST File Format Specification

This document describes the .LST (list) files used in Test Drive III: The Passion (1990).

**Status:** Partially decoded - scene LST resource table understood, car LST structure still under investigation.

## Overview

LST files are binary resource index files that describe the contents and layout of corresponding .DAT files. They serve as a directory/manifest for locating resources within the associated DAT file.

**Important:** LST is a generic format that varies significantly based on the type of data in the corresponding DAT file. There are at least two distinct variants:

1. **Scene LST files** (SCENE01.LST, SCENE02.LST) - Index course/map data
2. **Car LST files** (C*.LST) - Index car model and configuration data

These variants share only the basic concept (name + resource offsets) but have very different internal structures.

## Known LST Files

| LST File    | Corresponding DAT | Size (bytes) | Variant | Content Type              |
|-------------|-------------------|--------------|---------|---------------------------|
| SCENE01.LST | SCENE01.DAT       | 1638         | Scene   | Pacific Coast course data |
| SCENE02.LST | SCENE02.DAT       | 1638         | Scene   | Cape Cod course data      |
| CCERV.LST   | CCERV.DAT         | 675          | Car     | Corvette CERV III         |
| CCNSX.LST   | CCNSX.DAT         | 675          | Car     | Acura NSX                 |
| CDIAB.LST   | CDIAB.DAT         | 675          | Car     | Lamborghini Diablo        |
| CMYTH.LST   | CMYTH.DAT         | 675          | Car     | Pininfarina Mythos        |
| CSTEL.LST   | CSTEL.DAT         | 675          | Car     | Stealth R/T Turbo         |

## Common Elements

All LST files share:
- **Offset 0x0000**: Null-terminated name string (up to 18 characters + null)
- **Offset 0x0013+**: Variant-specific binary data

Everything after the name differs based on the LST variant.

---

## Scene LST Files (SCENE01.LST, SCENE02.LST)

Size: 1638 bytes (0x666)

### Complete Structure

```
Offset    Size      Description
------    ----      -----------
0x0000    19        Course name (null-terminated string, 18 chars + null)
0x0013    1         Number of maps (always 5)
0x0014    59        Map configuration header (see below)
0x004F    8         Flags string "11111111" (ASCII)
0x0057    1         Unknown flag (0x00 or 0x01)
0x0058    432       Route names (36 entries × 12 chars each)
0x0208    12        Routing data (12 bytes, values 0-3)
0x0214    388       Unknown data table (NOT color mapping)
0x0398    48        Index table (24 × 16-bit values)
0x03C8    14        Unknown
0x03D6    250       Car names / UI strings (null-terminated, 0xAA delimited)
0x04D0    406       DAT archive directory (29 entries × 14 bytes)
```

### Map Configuration Header (0x0014 - 0x004E)

59 bytes containing map-related data. Structure partially understood:
- Contains 16-bit values
- Values include map identifiers ('1' through '5' as ASCII 0x31-0x35)
- Remainder is padding (zeros)

### Route Names (0x0058 - 0x0207)

36 fixed-width strings, 12 characters each:
- Entries 0-19: 5 maps × 4 route names (main route + 3 alternatives)
- Entries 20-35: 4 sections × 4 subroutes (unused/placeholders)

Example from SCENE01.LST:
```
[0]  "Scenic Coast"     [4]  "Coast Hills"      [8]  "Valley Farms"
[1]  "Highway 101"      [5]  "Highway 156"      [9]  "Highway 33"
[2]  "Highway 1"        [6]  "Highway 1"        [10] "Highway 140"
[3]  "Shortcut"         [7]  "Shortcut"         [11] "Shortcut"
```

### Routing Data (0x0208 - 0x0213)

12 bytes defining default route selections:
- Both SCENE01 and SCENE02 have: `[0, 2, 1, 3, 0, 1, 3, 1, 2, 0, 1, 3]`
- Values 0-3 reference the 4 route options per map

### Unknown Data Table (0x0214 - 0x0397)

388 bytes of structured data with unknown purpose:
- Most values have low nibble = 0xC (e.g., 0x6C, 0x7C, 0x8C...)
- High nibble ranges 0x6-0xF (10 distinct values)
- Special marker values: 0x00, 0x01, 0x02, 0x03, 0x0B, 0x3B, 0x7B, 0xAB
- Purpose unknown - possibly terrain types, route segments, or checkpoint data

**Note:** Actual color mapping is stored in the DAT file within each map structure at offset `map_base + 0x1F27`, not in the LST file.

### Index Table (0x0398 - 0x03C7)

24 16-bit little-endian values organized as 4 rows × 6 columns:
- May reference offsets into the unknown data table
- Values appear to be packed indices

### UI Strings (0x03D6 - 0x04CF)

250 bytes containing null-terminated strings delimited by 0xAA bytes:
- 24 strings total per scene
- First ~12 entries: Car/vehicle names
- Remaining entries: UI labels (stats, actions, units)

Content differs completely between scenes:

**SCENE01 (Pacific):**
```
Mythos, CERV III, Diablo, Viper, 959, F40, Ferrari, Jaguar,
Lamborghini, Porsche, Mercedes, Maserati, RPM, Turbo, Wheelbase,
Suspension, Top Speed, Weight, Horsepower, Torque, Steering, Chassis, MPH, Test Drive
```

**SCENE02 (Cape Cod):**
```
Lotus, NSX, Vector, Corvette, 962, BMW, Countach, Stealth,
300ZX, Caspita, Alfa Romeo, Carrera, Brakes, Wipers, Fenders,
Carburetor, Lights, Tires, Rearview, Signal, Shifter, KPH, Yield, Exhaust
```

### DAT Archive Directory (0x04D0 - 0x0665)

The final `0x196` bytes of a scene LST are 29 fixed-width archive-directory
entries. The game loads this region into its archive lookup table; each entry
maps a filename hash to a resource stored either in a DAT archive or another
archive file.

```c
struct ArchiveEntry {
    uint16_t hash_h2;
    uint16_t hash_h1;
    uint8_t  archive;       // 'e' selects the current SCENEnn.DAT
    uint8_t  reserved;
    uint32_t offset;        // byte offset in the selected archive
    uint32_t stored_size;   // file_load_far reads low_word(stored_size) - 1
};
```

Entries begin at `0x04D0`; there is no special header entry. `archive_open()`
hashes the requested name and selects the matching record. For archive marker
`'e'`, it opens the scene DAT and seeks to the stored offset. The loader reads
one less than the low-word size recorded in the LST.

This explains why a loose `SCENE02P.BIN` is not required: the archived filename
`SCENE02P.BIN` is entry 9 in `SCENE02.LST`, pointing to offset `0x1D11A` in
`SCENE02.DAT`. Its stored size is `0x1E6F`, so the game reads `0x1E6E` bytes.
`SCENE01.LST` selects the shared lane bank instead and does not need
`SCENE01P.BIN`.

---

## Car LST Files (C*.LST)

Size: 675 bytes

Car LST files index resources in the corresponding C*.DAT files, which contain car 3D models and related data.

### Structure

```
Offset    Size      Description
------    ----      -----------
0x0000    19        Car name (null-terminated, e.g., "Chevrolet CERV III")
0x0013    656       Binary data (offsets, sizes, configuration)
```

### Binary Data (0x0013 onwards)

The structure after the name is **not fully understood**. It contains 16-bit values that likely include:
- Offsets into the corresponding C*.DAT file
- Resource sizes
- Possibly car configuration/physics parameters

Example values from CCERV.LST:
```
Offset  Value   Notes
------  -----   -----
0x0013  5697    (0x1641)
0x0015   927    (0x039F)
0x0017  1104    (0x0450)
0x0019  5054    (0x13BE)
0x001B  7752    (0x1E48)
...
```

### Key Differences from Scene LST

- Car LST files are shorter (675 bytes) and have a smaller archive directory.
- They do not contain the scene route names, leg configuration, or scene
  archive table.
- Their remaining fields include car configuration and physics values.

---

---

## References

- LST viewer tool: `src/tools/lstviewer/lstviewer.ts` (run: `npm run lstview -- <file>`)
- Implementation: `src/shared/extract.js`
- Forum discussion: http://www.accursedfarms.com/forums/viewtopic.php?f=63&t=5960
