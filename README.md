# oxlint-tw-no-self-positioning

Oxlint rules that keep layout decisions at the call site of a React component. They check the outermost JSX element returned by a component for Tailwind utilities and inline `style` properties that set margin, positioning, floats, offsets, width, height, or flex basis.

## Install

```sh
npm install --save-dev oxlint oxlint-tw-no-self-positioning
```

In `oxlint.config.ts`, the recommended preset loads the plugin and enables every rule:

```ts
import { defineConfig } from "oxlint";
import { noSelfPositioning } from "oxlint-tw-no-self-positioning";

export default defineConfig({
  extends: [noSelfPositioning.recommended],
  rules: {
    // Disable one group if its placement is allowed in your project.
    "tw-no-self-positioning/no-float": "off",
  },
});
```

Remove the `rules` override to enable all groups. VS Code can auto-import the named `noSelfPositioning` export from the package. The preset is also available as the named export `recommended`, and the default export remains available. Both the adapter and its published declarations are generated from strictly checked TypeScript source.

| Rule | Disallowed root styles |
| --- | --- |
| `no-margin` | Margin, including directional and logical variants |
| `no-position` | `absolute`, `fixed`, `sticky`, and other values except `static` and `relative` |
| `no-offset` | `top`, `right`, `bottom`, `left`, logical offsets, and `inset` |
| `no-float` | `float` values other than `none` |
| `no-dimensions` | `width`, `height`, and Tailwind `size-*` |
| `no-flex-basis` | `flex-basis` and `flex` shorthand values |

To enable just selected groups in `.oxlintrc.json`, add the plugin under `jsPlugins` and name the desired rules:

```json
{
  "jsPlugins": ["oxlint-tw-no-self-positioning"],
  "rules": {
    "tw-no-self-positioning/no-margin": "error",
    "tw-no-self-positioning/no-dimensions": "error"
  }
}
```

```tsx
// Invalid: the component chooses its own placement and dimensions.
function Card() {
  return <article className="mt-4 absolute left-0 w-80 h-20 basis-1/2" />;
}

// Valid: the parent controls placement; max-width is allowed.
function Card() {
  return <article className="relative max-w-lg min-w-0 p-4">
    <span className="absolute inset-y-0 left-0" />
  </article>;
}
function Page() {
  return <div className="mt-4 w-80"><Card /></div>;
}
```

The rules catch `m-*`, `mx-*`, `my-*`, directional margin utilities (including logical directions and negative values), `absolute`/`fixed`/`sticky`, floating utilities such as `float-left`, `top-*`/`right-*`/`bottom-*`/`left-*`, `inset-*`/`start-*`/`end-*`, `w-*`, `h-*`, `size-*`, `basis-*`, and Tailwind `flex-*` shorthand values that set flex basis. Variants such as `md:`, `hover:`, `!`, and arbitrary properties such as `[margin-top:1rem]` are recognized. Utilities targeting pseudo-elements or children (for example, `before:absolute`, `*:w-full`, and `[&_svg]:size-3`) are ignored. Arbitrary variants that still target the root, such as `[&:hover]:w-full`, are checked. `static`, `relative` (including variants and `[position:relative]`), and `float-none` are allowed. `relative` can establish a containing block for the component's own positioned children without taking the root out of normal flow; offsets on that root, such as `top-2`, still trigger `no-offset`. `max-w-*`, `min-w-*`, `max-h-*`, and `min-h-*` are allowed.

For inline `style`, corresponding margin, offset, width, height, and flex-basis properties are flagged. `position` values other than `static` and `relative`, and `float` values other than `none`, are flagged when statically known. `maxWidth`, `minWidth`, `maxHeight`, and `minHeight` are allowed.

The [BEM CSS methodology](https://bem.info/en/methodology/css/#external-geometry-and-positioning) puts external geometry and positioning on the parent block and explicitly shows `margin` and `position: relative`. Its [FAQ](https://bem.info/en/methodology/faq/#why-is-external-geometry-and-positioning-set-via-the-parent-block) names `margin` and `position`; a [BEM team member's answer](https://github.com/bem-site/bem-forum-content-ru/issues/1170#issuecomment-255318283) also names `float`. This package permits `relative` on a component root because it can serve internal layout; BEM's example uses it for external placement. The restriction on ordinary `width`, `height`, and flex basis is this package's additional policy; BEM does not supply an exhaustive list of forbidden CSS properties. See [the source notes](docs/bem-external-geometry.md) for the boundary between documented guidance and this rule's choices.

Supported component forms include named functions, uppercase arrow/function expressions, `memo`/`forwardRef` wrappers, class `render()` methods, conditional returns, fragments, and returned arrays. Static strings in `className`, template literals, and common `clsx`/`cn`/`classNames` calls are inspected. Dynamic values, CSS-in-JS, imported styles, CSS modules, and classes defined elsewhere cannot be resolved by these rules. They deliberately report a utility even if another class may override it at runtime.

## Development and publishing

Requires Node.js 20.19+ and Rust 1.88+.

```sh
npm install
npm run build:debug
npm run typecheck
npm test
cargo test
npm pack --dry-run
```

For a full local check, run `just check`. `just install`, `just build`, `just lint`, and `just test` are also available separately.

The Rust matcher is exposed through Node-API. Oxlint's external plugin API requires a small JavaScript adapter for AST access and diagnostics. The adapter shares collected candidates and one native scan across active rules for each source file. There is no separate Rust plugin ABI in Oxlint's external plugin API ([Oxlint documentation](https://oxc.rs/docs/guide/usage/linter/js-plugins)).

The GitHub Actions workflow builds macOS, Windows, and Linux (glibc/musl) packages for x64 and arm64. On version tags it publishes the eight platform packages and then the root package through [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/). The `publish` job starts only when the repository variable `NPM_PUBLISH_ENABLED` is `true`; it waits for every build and test job to succeed. The workflow needs no npm token.

For the first release, the packages must exist before npm can authorize the workflow. Install [`just`](https://just.systems/) and the [GitHub CLI](https://cli.github.com/), log in to GitHub and npm, update `package.json`, `package-lock.json`, `Cargo.toml`, and `Cargo.lock` to the same version, and push a matching `vX.Y.Z` tag. Wait for CI to succeed, then run from that clean tagged commit:

```sh
just prepare  # Optional: download artifacts and check the assembled packages.
just publish
```

`just publish` installs dependencies, builds and tests the local native addon, runs lint and type checks, downloads the eight binaries from CI, and publishes the platform packages before the root package. npm may request 2FA. A failed publish leaves the temporary staging directory for inspection.

After all nine packages exist, authorize `ci.yml` as a trusted publisher for each one (with direct `npm publish` allowed), then enable automated publication:

```sh
for suffix in darwin-x64 darwin-arm64 win32-x64-msvc win32-arm64-msvc linux-x64-gnu linux-arm64-gnu linux-x64-musl linux-arm64-musl; do
  npm trust github "oxlint-tw-no-self-positioning-$suffix" --repo lebedev-nikita/oxlint-tw-no-self-positioning --file ci.yml --allow-publish --yes
done
npm trust github oxlint-tw-no-self-positioning --repo lebedev-nikita/oxlint-tw-no-self-positioning --file ci.yml --allow-publish --yes
gh variable set NPM_PUBLISH_ENABLED --body true
```

For subsequent releases, commit the synchronized version files and push the matching tag. CI assembles and publishes the packages. `just publish` remains available for recovery from a failed release.

## License

MIT
