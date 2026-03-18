# NIKKE Battle Simulator — Architecture

## Goal
A fully client-side, zero-backend battle simulator for Goddess of Victory: NIKKE.
Runs in any browser. Data is fetched from game CDN and cached locally.

---

## Tech Stack
- **Vite** — build tool & dev server
- **Vanilla JS** (ES modules) — no framework overhead
- **HTML/CSS** — UI
- **localStorage** — CDN data cache + version tracking

---

## Data Sources

All game data is loaded from `sg-tools-cdn.blablalink.com`. URLs are hash-based and
change on game updates. The manifest file (`src/data/manifest.js`) lists all known URLs
and must be updated when the game patches.

### Known Data Files

| File | Content | Key Fields |
|------|---------|------------|
| `c4619ec8...` | Character roster | id, class, element, weapon, faction, costumes |
| `78500850...` | Character details | stats per level (1-500), skill1, skill2, burst |
| `e8b9e7f7...` | Level progression | exp/gold cost per level (1-556) |
| `02d7f979...` | Equipment (modules) | A/B/C/D slots, stats, rarity T1-T10 |
| `bdeb2eac...` | Harmony Cubes | stats per enhancement level, 2 skills |
| `cb6bd83f...` | Attractive (ascension) | HP/ATK/DEF rate bonuses per tier (1-40) |
| `258f8531...` | Recycle Room | research upgrades (ATK/DEF/HP flat bonuses) |
| `b46c877b...` | Buff effects | effect IDs for ATK/CRIT/DEF/AMMO buffs |
| `7548a00f...` | Costumes | costume_index per character |
| `452950b7...` | Character resources | name → resource_id mapping |

### Auto-Update Strategy
The JS bundle at `blablalink.com/shiftyspad` uses a versioned asset loader backed by
IndexedDB (`__ss_indexdb_cache_version_configs__`). Until a proper version manifest
endpoint is discovered, updates are tracked via:

1. A `scripts/check-update.js` Node script that fetches the tool page, parses the
   JS bundle URL, and extracts any updated CDN paths.
2. `manifest.js` is the single source of truth — update it when new hashes appear.

---

## Project Structure

```
nikke-battle-simulator/
├── index.html
├── src/
│   ├── main.js                  # App entry point
│   ├── data/
│   │   ├── manifest.js          # CDN URL registry (update on patch)
│   │   ├── loader.js            # Fetch + localStorage cache
│   │   └── models.js            # Normalize raw JSON into typed objects
│   ├── engine/
│   │   ├── stats.js             # Compute final stats (base + level + equip + cube + research)
│   │   ├── damage.js            # Damage formula
│   │   ├── skills.js            # Skill effect resolver
│   │   ├── buffs.js             # Buff/debuff state machine
│   │   └── battle.js            # Main simulation loop
│   └── ui/
│       ├── squad-builder.js     # Character/equipment selection
│       ├── battle-view.js       # Real-time battle display
│       └── results.js           # Summary + charts
├── scripts/
│   └── check-update.js          # Node script to detect CDN URL changes
├── ARCHITECTURE.md
└── CLAUDE.md
```

---

## Battle Engine

### Stat Computation Pipeline
```
BaseStats(character, level)
  + EquipmentStats(module_A + B + C + D)
  + HarmonyCubeStats(cube, enhancement_level)
  + AttractiveBonus(ascension_tier)        ← % multiplier on base stats
  + RecycleRoomBonus(research_unlocked)    ← flat bonus
  + SkillPassiveBuffs(skill1, skill2)
= FinalStats { atk, hp, def, crit_rate, crit_dmg, max_ammo, ... }
```

### Damage Formula (community-verified)
```
Raw = ATK × WeaponMultiplier
Skill = Raw × SkillMultiplier
Element = Skill × (1 + ElementBonus)      ← 10% if element advantage
Crit = Element × (1 + CritDmg) × CritRate + Element × (1 - CritRate)
Final = Crit × (1 - DEF / (DEF + Constant)) × MiscModifiers
```

**Element advantage table:**
- Fire > Wind
- Water > Fire
- Electric > Water
- Wind > Electric
- Iron = neutral (no weakness/strength)

**Defense constant:** TBD from data mining (likely ~2000 based on community research)

### Battle Loop
```
1. Initialize squads (player 5 NIKKEs vs enemy)
2. Each tick (frame-based at 30 fps sim):
   a. Each NIKKE fires weapon (auto-attack with reload cycle)
   b. Burst gauge fills from hits
   c. Active buffs tick down
   d. Check skill triggers (skill1 @ condition, skill2 @ condition)
3. Burst rotation: Full Burst activates when gauge fills
4. Track: total damage, kills, time-to-kill, burst count
5. End condition: enemy HP = 0 or time limit reached
```

### Skill System
Skills have:
- **Trigger condition** (e.g., "on hit", "every N seconds", "when burst active")
- **Effect** (e.g., "ATK +X% for Y seconds", "recover Z HP", "deal N% damage")
- **Target** (self / all allies / specific class)

---

## UI Flow

```
[Squad Builder]
  → Select 5 NIKKEs
  → Configure each: level, core, equipment slots, harmony cube
  → Set skill levels (1/2/burst)

[Enemy Config]
  → HP, DEF, element, type (rapture/boss)

[Simulate]
  → Run N iterations (Monte Carlo for crit RNG)
  → Show: avg DPS, burst timing, skill proc rates

[Results]
  → Damage breakdown per NIKKE
  → Timeline chart
  → TTK (time-to-kill) distribution
```

---

## Caching Strategy

```js
// On load:
1. Check localStorage for cached data + version hash
2. If cache hit → use cached, then background-check for updates
3. If cache miss → fetch all CDN files, store with hash

// Cache keys:
"nikke_data_v{hash}_characters"
"nikke_data_v{hash}_equipment"
// etc.
```

---

## Known Gaps (to research)
- [ ] Exact defense mitigation formula constant
- [ ] Full skill effect parsing (skills are in character detail JSON)
- [ ] Boss-specific mechanics (damage caps, phases)
- [ ] Cover/shield HP mechanics
- [ ] Exact burst gauge fill rate from weapon hits
