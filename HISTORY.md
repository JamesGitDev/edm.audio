# Website history

The [website release branch](https://github.com/JamesGitDev/edm.audio/tree/history/website-releases) contains 47 recovered snapshots from October 30 to November 26, 2026. It follows the original ElectronicDanceMusic.Audio site through November 8, then traces the EDM.Audio rollout, analytics, the listening layout, and mobile loading improvements.

Use `git log --reverse history/website-releases` to read the milestones in order. Each snapshot records its archive and capture time in `website-release.json`. These commits were reconstructed from preserved files. Some snapshots were staged candidates. The capture time describes the source archive.

Archived client files are under `site/` on the release branch. They can be inspected independently of the active build on `main`. Where available, the archive records the Android package version and checksum. Download binaries and precompressed copies are stored by the release system.
