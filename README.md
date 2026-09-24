# oxlint-tw-no-self-positioning

Oxlint rules that keep layout decisions at the call site of a React component. They check the outermost JSX element returned by a component for Tailwind utilities and inline `style` properties that set margin, positioning, floats, offsets, width, or flex basis.

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
| `no-position` | `position` values other than `static` |
| `no-offset` | `top`, `right`, `bottom`, `left`, logical offsets, and `inset` |
| `no-float` | `float` values other than `none` |
| `no-width` | `width` and Tailwind `size-*` (also sets width) |
| `no-flex-basis` | `flex-basis` and `flex` shorthand values |

To enable just selected groups in `.oxlintrc.json`, add the plugin under `jsPlugins` and name the desired rules:

```json
{
  "jsPlugins": ["oxlint-tw-no-self-positioning"],
  "rules": {
    "tw-no-self-positioning/no-margin": "error",
    "tw-no-self-positioning/no-width": "error"
  }
}
```

```tsx
// Invalid: the component chooses its own placement and width.
function Card() {
  return <article className="mt-4 absolute left-0 w-80 basis-1/2" />;
}

// Valid: the parent controls placement; max-width is allowed.
function Card() {
  return <article className="max-w-lg min-w-0 p-4" />;
}
function Page() {
  return <div className="mt-4 w-80"><Card /></div>;
}
```

The rules catch `m-*`, `mx-*`, `my-*`, directional margin utilities (including logical directions and negative values), `relative`/`absolute`/`fixed`/`sticky`, floating utilities such as `float-left`, `top-*`/`right-*`/`bottom-*`/`left-*`, `inset-*`/`start-*`/`end-*`, `w-*`, `size-*`, `basis-*`, and Tailwind `flex-*` shorthand values that set flex basis. Variants such as `md:`, `hover:`, `!`, and arbitrary properties such as `[margin-top:1rem]` are recognized. Utilities targeting pseudo-elements or children (for example, `before:absolute` and `*:w-full`) are ignored. `static` and `float-none` are allowed because they reset positioning and floating. `max-w-*` and `min-w-*` are allowed.

For inline `style`, corresponding margin, offset, width, and flex-basis properties are flagged. `position` values other than `static` and `float` values other than `none` are flagged when statically known. `maxWidth` and `minWidth` are allowed.

The [BEM CSS methodology](https://bem.info/en/methodology/css/#external-geometry-and-positioning) puts external geometry and positioning on the parent block and explicitly shows `margin` and `position: relative`. Its [FAQ](https://bem.info/en/methodology/faq/#why-is-external-geometry-and-positioning-set-via-the-parent-block) names `margin` and `position`; a [BEM team member's answer](https://github.com/bem-site/bem-forum-content-ru/issues/1170#issuecomment-255318283) also names `float`. The restriction on ordinary `width` and flex basis is this package's additional policy; BEM does not supply an exhaustive list of forbidden CSS properties. See [the source notes](docs/bem-external-geometry.md) for the boundary between documented guidance and this rule's choices.

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

The Rust matcher is exposed through Node-API. Oxlint's external plugin API requires a small JavaScript adapter for AST access and diagnostics. The adapter shares collected candidates and one native scan across active rules for each source file. There is no separate Rust plugin ABI in Oxlint's external plugin API ([Oxlint documentation](https://oxc.rs/docs/guide/usage/linter/js-plugins)).

The GitHub Actions workflow builds macOS, Windows, and Linux (glibc/musl) packages for x64 and arm64, tests each native binding, assembles the optional platform packages, and publishes from a `v*` tag. For the first release, configure an `NPM_TOKEN` repository secret with publish access to the root and eight platform package names. Once these packages exist, configure `ci.yml` as a trusted publisher for all nine packages in npm and remove the token if desired. Update `package.json`, `package-lock.json`, `Cargo.toml`, and `Cargo.lock` to the same version, then push a matching `vX.Y.Z` tag. The release workflow publishes the platform packages at the root package's version.

## License

MIT
