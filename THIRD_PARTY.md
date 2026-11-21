# Third-party software

This project derives its initial recognition/editor implementation from
[Sheetscan](https://github.com/dsalex1/sheetscan), commit
`e6c82d8819f8ce475f7efdd5211fc44e9e58b6bc`, by dsalex1, under AGPL-3.0.
The original copyright and AGPL license are retained in LICENSE and the source.

The recognition engine and weights are homr (AGPL-3.0). See
https://github.com/liebharc/homr and its license FAQ for training-data restrictions
(including noncommercial Camera-PrIMuS data). Commercial use requires review of
these restrictions. This prototype does not grant additional rights to weights.

PDF.js (Apache-2.0), Pyodide (MPL-2.0), ONNX Runtime (MIT), Verovio (LGPL-3.0),
and coi-serviceworker (MIT) provide PDF rendering, Python, inference, notation,
and static-host cross-origin isolation. Dependencies retain their own licenses.

Recognition assets are initially obtained from the upstream Sheetscan deployment;
tools/fetch-assets.mjs records their SHA-256 hashes. No private score is distributed.
