# Changesets

Every change that users would notice gets a changeset: run `pnpm changeset`, pick the bump and describe the change
for the changelog. While modelform is 0.x, a breaking change (including any change to the JSON format that makes
existing dashboards or configs read differently) is a minor bump, and everything else is a patch.

Merging to `main` opens or updates a "Version Packages" PR. Merging that PR publishes to npm.
