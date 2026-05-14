# Publishing pi-semantic-memory to pi.dev

Pi packages are npm packages with a `"pi"` key in `package.json`. Publishing to npm makes the package installable with `pi install npm:<name>`.

## Prerequisites

- npm account at [npmjs.com](https://www.npmjs.com)
- Pi CLI installed: `npm install -g @earendil-works/pi-coding-agent`
- Package builds cleanly: `npm run typecheck`

## Step-by-step

### 1. Prepare the package

Ensure `package.json` is correct:

- `"name"` is unique on npm (`pi-semantic-memory` or a scoped name like `@yourscope/pi-semantic-memory`)
- `"version"` follows semver
- `"pi": { "extensions": ["./index.ts"] }` is present
- `"keywords"` includes `"pi-package"` — this is what the [pi.dev packages](https://pi.dev/packages) index uses to discover Pi packages on npm
- `"files"` lists everything a consumer needs (`index.ts`, `src/`, `scripts/`, `README.md`, `LICENSE`)
- `"publishConfig": { "access": "public" }` for scoped packages

### 2. Log in to npm

```sh
npm login
```

### 3. Dry-run to verify what will be published

```sh
npm pack --dry-run
```

Confirm the listed files match the `"files"` array. The MCP client source (`src/`) must be included because Pi extensions are loaded as TypeScript at runtime.

### 4. Publish

```sh
npm publish
```

For a pre-release:

```sh
npm publish --tag beta
```

### 5. Verify installation

```sh
pi install npm:pi-semantic-memory
```

Or from a specific version:

```sh
pi install npm:pi-semantic-memory@1.0.0
```

Or directly from git (useful before publishing):

```sh
pi install git:github.com/jose-compu/pi-semantic-memory
```

### 6. Submit to the pi.dev package registry

Pi's package listing at [pi.dev/packages](https://pi.dev/packages) is driven by npm keyword discovery (`"pi-package"`). Once published with that keyword the package will appear automatically.

To accelerate listing or feature your package, open an issue or PR in the [Pi GitHub repository](https://github.com/earendil-works/pi) or post in the [Pi Discord](https://pi.dev) community server.

## Versioning & updates

Follow [semver](https://semver.org):

| Change | Version bump |
|---|---|
| New tool, command, or hook behavior | minor (`1.1.0`) |
| Bug fix, internal refactor | patch (`1.0.1`) |
| Breaking API or config change | major (`2.0.0`) |

Update `CHANGELOG.md` before each release.

## Useful npm commands

```sh
# Check what the published package will contain
npm pack --dry-run

# Publish with latest tag
npm publish

# Bump patch version and publish
npm version patch && npm publish

# Deprecate an old version
npm deprecate pi-semantic-memory@"<1.0.0" "Upgrade to 1.0.0+"
```
