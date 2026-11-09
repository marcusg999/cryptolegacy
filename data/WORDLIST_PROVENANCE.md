# EFF Large Wordlist — provenance

File: `eff_large_wordlist.txt`
SHA-256: `addd35536511597a02fa0a9ff1e5284677b8883b83e986e43f15a3db996b903e`
Lines: 7776 (`6^5`), format `<5-digit dice roll>\t<word>`, tab-separated, sorted by roll.

## Source

EFF's "long" wordlist for random passphrases, published July 2016 alongside
*Deep Dive: EFF's New Wordlists for Random Passphrases*
(<https://www.eff.org/deeplinks/2016/07/new-wordlists-random-passphrases>).
Canonical URL: <https://www.eff.org/files/2016/07/18/eff_large_wordlist.txt>

## How this copy was obtained and verified

`eff.org` is not reachable from the build environment used to vendor this file, so it was
retrieved from two mutually independent redistributors and byte-compared:

1. npm package `eff-diceware-passphrase@3.0.0` → `eff_large_wordlist.txt`
2. GitHub `ulif/diceware` → `diceware/wordlists/wordlist_en_eff.txt`

Both produce SHA-256 `addd3553…b903e`. Structural checks that also passed:

- exactly 7776 rows; all 7776 dice-roll keys distinct and matching `^[1-6]{5}$`
- words sorted ascending, lengths 3–9
- the four hyphenated EFF entries (`drop-down`, `felt-tip`, `t-shirt`, `yo-yo`) are present,
  which distinguishes the authentic list from the curated KeePassXC derivative
  (`share/wordlists/eff_large.wordlist`, 7772 words, 26 substitutions) — do not use that one,
  it is not the EFF list and has different indices.

## Open verification item

The digest above has **not** been checked against `eff.org` itself. A maintainer with
unrestricted egress must run `scripts/verify-wordlist.mjs --against-upstream` once and record
the result here. Until then the pinned digest attests only that the vendored bytes match the two
redistributors named above.

## Licence

EFF's wordlists are released under CC-BY 3.0 US. Attribution: Electronic Frontier Foundation.
