#!/usr/bin/env bash
set -euo pipefail
# Runs public upstream code in a disposable directory. No browser profile or API keys.
study_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
python3 - "$study_dir" <<'PY'
import hashlib, json, pathlib, sys
root=pathlib.Path(sys.argv[1]); manifest=json.loads((root/'manifest.json').read_text())
for name, expected in manifest['files'].items():
    assert hashlib.sha256((root/name).read_bytes()).hexdigest() == expected, name
print('Patch and license checksums verified')
PY
repro_dir="$(mktemp -d)"
trap 'rm -rf -- "$repro_dir"' EXIT
upstream_sha=ad47282a17ecdfb894745af093e0f7332fc1f71a
git -C "$repro_dir" init --quiet
git -C "$repro_dir" fetch --depth 1 https://github.com/nanobrowser/nanobrowser.git "$upstream_sha"
git -C "$repro_dir" checkout --quiet --detach FETCH_HEAD
test "$(git -C "$repro_dir" rev-parse HEAD)" = "$upstream_sha"
cd "$repro_dir"
test "$(corepack pnpm --version)" = '10.34.6'
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm type-check
corepack pnpm test
# Tests are inside each patch; no copied extension is included in Hub runtime.
git apply --check "$study_dir/patches/0001-canonical-url-policy.patch" "$study_dir/patches/0002-delete-replay-history.patch"
git apply "$study_dir/patches/0001-canonical-url-policy.patch" "$study_dir/patches/0002-delete-replay-history.patch"
corepack pnpm type-check
corepack pnpm test
corepack pnpm build
corepack pnpm exec eslint src/background/browser/util.ts src/background/browser/__tests__/urlPolicy.test.ts src/storage/lib/chat/history.ts src/storage/lib/chat/__tests__/deletion.test.ts
