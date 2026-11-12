#!/bin/sh
# Makes a release tag of the package: the commit of main, plus the built lib/.
#
#   ./release.sh 0.1.0
#   git push origin v0.1.0
#
# lib/ is never committed on main. Only the tag commit has it, on top of main,
# so the hub can depend on github:EPFL-ENAC/steel-viz#v0.1.0 with no build at
# install. Run it in the main checkout, on main, after the version bump in
# package.json is merged. It tags, it never pushes.
set -eu

v="${1:?usage: ./release.sh <version>, the version in package.json}"
fail() { echo "release: $*" >&2; exit 1; }

[ "$(git rev-parse --abbrev-ref HEAD)" = main ] || fail "run it on main"
[ -z "$(git status --porcelain --untracked-files=no)" ] || fail "commit your changes first"
git fetch -q origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || fail "main is not the same as origin/main"
[ "$(node -p 'require("./package.json").version')" = "$v" ] || fail "package.json has another version"
! git rev-parse -q --verify "refs/tags/v$v" >/dev/null || fail "tag v$v exists already"

pnpm install --frozen-lockfile
pnpm test
pnpm run type-check
pnpm run build:lib

# The commit is made in a temporary index, so the branch and the files of the
# checkout don't move. lib/ is in .gitignore, so it needs add -f.
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
export GIT_INDEX_FILE="$tmp/index"
git read-tree HEAD
git add -f lib
commit=$(git commit-tree "$(git write-tree)" -p HEAD -m "chore(release): v$v")
unset GIT_INDEX_FILE

git tag -a "v$v" -m "v$v" "$commit"
echo "Tagged v$v ($commit), with $(git ls-tree -r --name-only "v$v" -- lib | wc -l) files in lib/."
echo "Push it with: git push origin v$v"
