# Third-party notices

Training Register bundles the components listed below. Each keeps its own licence; nothing
here is covered by this project's AGPL-3.0-or-later terms.

The list is derived from the `sources` recorded in the production sourcemaps under
`dist/`, so it reflects what is actually shipped to a browser rather than what happens to
be installed for development.

---

## Leaflet 1.9.4

Interactive maps. <https://leafletjs.com/> — BSD-2-Clause.

```
BSD 2-Clause License

Copyright (c) 2010-2023, Volodymyr Agafonkin
Copyright (c) 2010-2011, CloudMade
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

---

## Fonts

None are bundled or fetched. The interface uses the reader's own system font stack, so no
font licence applies and no request leaves the page to load one.

---

## Data

Data is not a bundled component and keeps its own, separate terms:

- **National Training Register** (training.gov.au) — © Commonwealth of Australia,
  licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- **State and territory boundaries** — Australian Bureau of Statistics, Australian
  Statistical Geography Standard, licensed
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- **Basemap tiles** — © [CARTO](https://carto.com/attributions), © OpenStreetMap
  contributors.

Both data licences require attribution, which the site carries in its footer, its
methodology page and its `Dataset` JSON-LD. Relicensing this project's code never removes
those attributions.
