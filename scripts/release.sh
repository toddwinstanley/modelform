#!/usr/bin/env bash
# Stages the version in package.json on npm, unless its git tag already exists, then tags it.
# Run by .github/workflows/release.yml once no changesets are pending (that is, after a
# "Version Packages" PR merges). A maintainer then approves the staged version on npmjs.com,
# with 2FA, before it goes live.
set -euo pipefail

version=$(node -p "require('./package.json').version")
tag="v$version"

if git ls-remote --exit-code --tags origin "refs/tags/$tag" >/dev/null; then
  echo "$tag is already tagged; nothing to release."
  exit 0
fi

# pnpm packs: it builds (prepack) and swaps in the dist entry points from publishConfig.
# npm stages the tarball as is, with trusted publishing (OIDC) and provenance.
pnpm pack
npm stage publish "./modelform-react-native-$version.tgz"

git tag "$tag"
git push origin "$tag"
echo "Staged $version. Approve it under Staged Packages on npmjs.com."
