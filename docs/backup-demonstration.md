# Backup and restore demonstration

Required by the brief's Table 8 (`product/` and `media/`: "backup demonstration"). Executed
2026-11-10; the figures below are from that run, not from a description of intent.

## What was backed up

```bash
tar -czf emberfield_<stamp>.tar.gz \
    game/ product/ data/clean/ reports/ tests/ analysis/ docs/screenshots/
shasum -a 256 emberfield_<stamp>.tar.gz
```

| Item | Value |
|---|---|
| Archive size | 3.0 MB |
| Files | 64 |
| sha256 | `17e856d3675e3fa62ed0ab0c34e70100…` (full value in the run log) |

## What was verified after restoring

The archive was unpacked into a clean directory and the test suites were run **from the
restored copy**, not from the original working tree:

| Check | Result |
|---|---|
| `tests/test_game_logic.js` | 131 assertions pass |
| `tests/test_game_meta.js` | 60 assertions pass |
| `tests/test_game_page.js` | 41 assertions pass |
| `game/index.html` present | yes |
| `game/vendor/phaser.min.js` present | yes |

232 assertions passed from the restored copy. A backup that has never been opened is not a
backup, so the restore is the evidence rather than the archive.

## A first attempt that would have looked fine and been useless

The first run of this demonstration backed up `game/ product/ data/clean/ reports/` and then
reported that the tests were "skipped because the archive does not contain `tests/`". That
output looks like a successful backup. It proves nothing about recoverability, because the
thing needed to check recoverability was not in the archive.

The second run included `tests/` and `analysis/`, which is why the table above can report
assertions passing from the restored copy.

## What this does not prove

It does not prove off-site durability. The archive sits on the same machine, and the primary
copy of the project is the GitHub repository, which is the actual redundancy. This
demonstration shows that the working artefacts can be reconstructed from an archive; it does
not show what would survive losing the machine.

## Reproducing

```bash
STAMP=$(date +%Y%m%dT%H%M%SZ)
tar -czf /tmp/emberfield_$STAMP.tar.gz \
    game/ product/ data/clean/ reports/ tests/ analysis/ docs/screenshots/
sha256sum /tmp/emberfield_$STAMP.tar.gz

mkdir -p /tmp/restore && tar -xzf /tmp/emberfield_$STAMP.tar.gz -C /tmp/restore
cd /tmp/restore && node tests/test_game_logic.js
```
