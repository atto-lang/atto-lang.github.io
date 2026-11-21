#!/bin/sh
# Stable playground compiler verification entrypoint.
# The compiler is RUST->WASM, never a JavaScript source compiler.
# A candidate check is strictly local/read-only: no public byte publication.
set -eu
root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)"
cd "$root"
mode="${1:---verify-published}"

case "$mode" in
  --help|-h)
    cat <<'HELP'
Usage:
  npm run vendor:compiler
      Verify the currently published/pinned Rust compiler WASM and real guests.
  sh scripts/vendor-compiler.sh --stage-private /absolute/atto_compiler.wasm APPROVED_CANDIDATE.json
      Verify the separately built candidate and its reviewed receipt; no copying.
The script deliberately NEVER modifies public/atto_compiler.wasm, receipts or pins.
A new public binary requires separately approved disclosure and an exact
source/tree SHA-attested build and browser execution receipts.
HELP
    ;;
  --verify-published)
    test "$#" -le 1
    node --test tests/compiler.test.mjs tests/typed-lambda-comma-compiler-gate.test.mjs
    ;;
  --stage-private)
    if [ "$#" -ne 3 ]; then
      echo 'E_USAGE: provide candidate .wasm file and approved receipt name' >&2
      exit 2
    fi
    artifact="$2"
    candidate="$3"
    case "$artifact" in
      /*.wasm) ;;
      *) echo 'E_INPUT: candidate must be an explicitly supplied absolute .wasm file' >&2; exit 2 ;;
    esac
    case "$candidate" in
      */*|*\\*|'') echo 'E_RECEIPT: receipt must be an allowlisted basename' >&2; exit 2 ;;
    esac
    test -f "$artifact" && test ! -L "$artifact" || {
      echo 'E_INPUT: candidate file must be an existing regular non-symlink' >&2
      exit 2
    }
    node tools/verify-compiler-candidate.mjs "$artifact" "$candidate"
    echo 'Verified candidate is private/unpublished. No public asset, pin, or receipt changed.'
    ;;
  *)
    echo "E_USAGE: unknown mode $mode" >&2
    exit 2
    ;;
esac
