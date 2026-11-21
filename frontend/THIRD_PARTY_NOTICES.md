# Third party software

The frontend reuses the following open source packages through their published npm distributions. Application pages, project-specific workflows, and styling were written for this repository; no third party business application or dashboard template was copied.

| Package | Purpose | Upstream source | License |
| --- | --- | --- | --- |
| `vite` | Development server and production build | [vitejs/vite](https://github.com/vitejs/vite) | [MIT](https://github.com/vitejs/vite/blob/main/LICENSE) |
| `react`, `react-dom` | Components and browser rendering | [react/react](https://github.com/react/react) | [MIT](https://github.com/react/react/blob/main/LICENSE) |
| `react-router-dom` | Application routes | [remix-run/react-router](https://github.com/remix-run/react-router) | [MIT](https://github.com/remix-run/react-router/blob/main/LICENSE.md) |
| `ethers` | Ethereum RPC, wallet connection, ABI calls and events | [ethers-io/ethers.js](https://github.com/ethers-io/ethers.js) | [MIT](https://github.com/ethers-io/ethers.js/blob/main/LICENSE.md) |
| `lucide-react` | Interface icons | [lucide-icons/lucide](https://github.com/lucide-icons/lucide) | [ISC, including MIT notices for icons derived from Feather](https://github.com/lucide-icons/lucide/blob/main/LICENSE) |
| `esbuild` | Bundling the repository's existing CommonJS shared modules | [evanw/esbuild](https://github.com/evanw/esbuild) | [MIT](https://github.com/evanw/esbuild/blob/main/LICENSE.md) |
| `@vitejs/plugin-react` | React integration for Vite | [vitejs/vite-plugin-react](https://github.com/vitejs/vite-plugin-react) | [MIT](https://github.com/vitejs/vite-plugin-react/blob/main/LICENSE) |
| `typescript` | Static type checking | [microsoft/TypeScript](https://github.com/microsoft/TypeScript) | [Apache 2.0](https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt) |

Copyright and license notices supplied with these packages remain in their installed distributions. When redistributing package sources or substantial copied portions, retain the applicable original copyright and license files. The lockfile records the exact installed versions and their transitive dependencies; this table describes direct frontend tools, not every transitive package.

The project uses its own frozen `shared/hash.js`, `shared/constants.js`, Solidity interfaces and generated ABI artifacts. These remain the sources of truth for project behavior; an external template does not replace their definitions.

Typography optionally loads DM Sans and Manrope from Google Fonts via CSS. Both font families are distributed under the SIL Open Font License: [DM Sans](https://github.com/google/fonts/blob/main/ofl/dmsans/OFL.txt), [Manrope](https://github.com/google/fonts/blob/main/ofl/manrope/OFL.txt). System sans-serif fonts are used when the font service is unavailable. Font files are not bundled in this source package.
