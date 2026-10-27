# Consumer release policy

The published alpha.8 plugin releases independently changed packages by default. A core change leaves the app source, published app versions and its existing dependency requirement unchanged.

Set `synchronizeDependents: true` in the root release configuration when dependents should receive a dependency-only release. The final acceptance alpha wave uses that explicit option; the app source remains unchanged while its published manifest follows the new core prerelease.

The existing `alpha7-live` and `stable7-live` release lanes preserve older diagnostic histories. The prerelease identifier `alpha7` names the consumer channel and is separate from the installed product version `1.0.0-alpha.8`.
