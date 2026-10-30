# Changelog

## [1.1.0](https://github.com/Karthik-beta/Blinkql/compare/blinkql-v1.0.0...blinkql-v1.1.0) (2026-10-30)


### Features

* **app:** export an analysis as a self-contained HTML report ([#174](https://github.com/Karthik-beta/Blinkql/issues/174)) ([6791311](https://github.com/Karthik-beta/Blinkql/commit/679131144638fcd72d18e339da45209f07be963b)), closes [#168](https://github.com/Karthik-beta/Blinkql/issues/168)
* **catalog:** import Excel (.xlsx) workbooks from their first sheet ([#173](https://github.com/Karthik-beta/Blinkql/issues/173)) ([89964cf](https://github.com/Karthik-beta/Blinkql/commit/89964cff8516b6c5de8f545c5ed776d6d26569a1)), closes [#167](https://github.com/Karthik-beta/Blinkql/issues/167)
* **catalog:** show a table's full name in its tooltip and its file name below it ([#181](https://github.com/Karthik-beta/Blinkql/issues/181)) ([c30bf0d](https://github.com/Karthik-beta/Blinkql/commit/c30bf0d4171bac112b815806847d9b6a42f7edc8))
* **catalog:** show how to read a workbook's other sheets and explain mixed cells ([#179](https://github.com/Karthik-beta/Blinkql/issues/179)) ([a5d838b](https://github.com/Karthik-beta/Blinkql/commit/a5d838b779fc97b99ed4936e8fb75509c2cc379a))
* **landing:** credit the author and link to karthik.nz ([#183](https://github.com/Karthik-beta/Blinkql/issues/183)) ([c976866](https://github.com/Karthik-beta/Blinkql/commit/c976866b105d55091e2e14087c02aa305ba96c41))
* **templates:** add a shipments sample and logistics templates for delivery and cost ([#171](https://github.com/Karthik-beta/Blinkql/issues/171)) ([eef7a1c](https://github.com/Karthik-beta/Blinkql/commit/eef7a1cbd83f9daa5b5d1cefd4eaeb6cf397d22e)), closes [#169](https://github.com/Karthik-beta/Blinkql/issues/169)


### Bug fixes

* **app:** show the report's chart in the colours of the page it's on ([#180](https://github.com/Karthik-beta/Blinkql/issues/180)) ([c5e20a4](https://github.com/Karthik-beta/Blinkql/commit/c5e20a48518f14a3cc29e75df0372e45f492a08e))


### Documentation

* list every package script in CONTRIBUTING and recommend the test-runner extensions ([#182](https://github.com/Karthik-beta/Blinkql/issues/182)) ([c643cba](https://github.com/Karthik-beta/Blinkql/commit/c643cbaf7e4cc87be61636c180b070add991c12f))

## 1.0.0 (2026-10-29)


### Features

* add the landing page and move the workbench to /app ([#87](https://github.com/Karthik-beta/Blinkql/issues/87)) ([cd5d421](https://github.com/Karthik-beta/Blinkql/commit/cd5d4214b4b80be9cea12f3226b272dfb79409e8))
* **app:** add a command palette and a keyboard shortcut reference ([#162](https://github.com/Karthik-beta/Blinkql/issues/162)) ([5cb1b7e](https://github.com/Karthik-beta/Blinkql/commit/5cb1b7edbb2732975f2cf3ba348a26a7950e38bf))
* **app:** add an onboarding tour from sample data to a chart ([#163](https://github.com/Karthik-beta/Blinkql/issues/163)) ([858f7ec](https://github.com/Karthik-beta/Blinkql/commit/858f7ec91e328b6b167ca176fe506108ae43f272))
* **app:** check core flows with axe and the keyboard, and add a skip link ([#164](https://github.com/Karthik-beta/Blinkql/issues/164)) ([ff7f18c](https://github.com/Karthik-beta/Blinkql/commit/ff7f18c25dc62c2b613741ef8af56072bf1c9c26))
* **app:** open the workbench offline with a service worker ([#153](https://github.com/Karthik-beta/Blinkql/issues/153)) ([67e1f48](https://github.com/Karthik-beta/Blinkql/commit/67e1f48014e3da500cc6478b314b67f036420ffb)), closes [#52](https://github.com/Karthik-beta/Blinkql/issues/52)
* **app:** share a query and its chart settings as a link, never its data ([#160](https://github.com/Karthik-beta/Blinkql/issues/160)) ([752d35e](https://github.com/Karthik-beta/Blinkql/commit/752d35e44bcc1eb759ef370d15e5c0ac4b79c2b7))
* **bench:** record the P-01 baseline benchmark ([#95](https://github.com/Karthik-beta/Blinkql/issues/95)) ([43f59c6](https://github.com/Karthik-beta/Blinkql/commit/43f59c649d3b24e593588f2325f5014fa2453150)), closes [#17](https://github.com/Karthik-beta/Blinkql/issues/17)
* **catalog:** browse tables and columns in a keyboard tree ([#125](https://github.com/Karthik-beta/Blinkql/issues/125)) ([8a6037f](https://github.com/Karthik-beta/Blinkql/commit/8a6037ffcd9474fc48c40c038b3438abd38c1c96))
* **catalog:** import CSV, Parquet and JSON files ([#91](https://github.com/Karthik-beta/Blinkql/issues/91)) ([60acc3d](https://github.com/Karthik-beta/Blinkql/commit/60acc3d8fff5082e0a63398ae572a41ebba2720d)), closes [#13](https://github.com/Karthik-beta/Blinkql/issues/13)
* **catalog:** keep imported datasets across reloads in OPFS ([#137](https://github.com/Karthik-beta/Blinkql/issues/137)) ([fa79daa](https://github.com/Karthik-beta/Blinkql/commit/fa79daa957fbcd8ea5e234ad135e699d902057ac))
* **catalog:** profile a table with one click ([#124](https://github.com/Karthik-beta/Blinkql/issues/124)) ([ace0165](https://github.com/Karthik-beta/Blinkql/commit/ace01656c142937fef93487b288833b40ba42b5e))
* **catalog:** query remote Parquet and CSV files by URL ([#136](https://github.com/Karthik-beta/Blinkql/issues/136)) ([42ae0ed](https://github.com/Karthik-beta/Blinkql/commit/42ae0ed756bd08ebf3dd22160b86542f63bcf8be))
* **catalog:** show a table's rows without SQL and count small distincts exactly ([#132](https://github.com/Karthik-beta/Blinkql/issues/132)) ([64e46ba](https://github.com/Karthik-beta/Blinkql/commit/64e46ba6f97f5ed766a9a48101daf308423f1f82))
* **catalog:** warn when an imported file is large for the device's memory ([#135](https://github.com/Karthik-beta/Blinkql/issues/135)) ([4ebc5cd](https://github.com/Karthik-beta/Blinkql/commit/4ebc5cdfbeb48e5101927bf7331a8d868e634a9e))
* **charts:** add a table view and a data summary to every chart ([#128](https://github.com/Karthik-beta/Blinkql/issues/128)) ([fc6fb7d](https://github.com/Karthik-beta/Blinkql/commit/fc6fb7d4833f0f9308db6ff739ce0aa7ead75957))
* **charts:** build bar, line, scatter, histogram and Pareto charts ([#127](https://github.com/Karthik-beta/Blinkql/issues/127)) ([f20efd4](https://github.com/Karthik-beta/Blinkql/commit/f20efd4e6e1ef1b60de5e1bf5c51d3e99ffd4cc3))
* **editor:** add a SQL editor with a Ctrl/Cmd+Enter run shortcut ([#92](https://github.com/Karthik-beta/Blinkql/issues/92)) ([e27a46c](https://github.com/Karthik-beta/Blinkql/commit/e27a46ceeaa15b5649a12f393eaa35451db62ec8)), closes [#14](https://github.com/Karthik-beta/Blinkql/issues/14)
* **editor:** complete tables, columns and DuckDB functions ([#126](https://github.com/Karthik-beta/Blinkql/issues/126)) ([096bb4c](https://github.com/Karthik-beta/Blinkql/commit/096bb4c7c019b5dae95e5107d9dbfe99dcc545d8))
* **engine:** load DuckDB-wasm in a Web Worker ([#90](https://github.com/Karthik-beta/Blinkql/issues/90)) ([5409973](https://github.com/Karthik-beta/Blinkql/commit/5409973f480c1de2af3de0ae7d9784804d88311d)), closes [#12](https://github.com/Karthik-beta/Blinkql/issues/12)
* **engine:** readable error messages and crash recovery ([#94](https://github.com/Karthik-beta/Blinkql/issues/94)) ([86295f7](https://github.com/Karthik-beta/Blinkql/commit/86295f7f5055b29176d33698674f5fd92c71a1f1))
* **history:** keep query history and saved queries in IndexedDB ([#129](https://github.com/Karthik-beta/Blinkql/issues/129)) ([973addb](https://github.com/Karthik-beta/Blinkql/commit/973addb2eb0434b0b7c5ca24827d59867c1d3799))
* **landing:** run the hero's sample query on the live engine ([#116](https://github.com/Karthik-beta/Blinkql/issues/116)) ([52085eb](https://github.com/Karthik-beta/Blinkql/commit/52085ebaa8da55ecca364b28e99cee9418a8e1a9))
* **landing:** show M0 and M1 as done and link to the early workbench ([#97](https://github.com/Karthik-beta/Blinkql/issues/97)) ([0f1b864](https://github.com/Karthik-beta/Blinkql/commit/0f1b864b0267223031405ef3ccdd7512ba5351ab))
* **landing:** show M2 as done and M3 as the current milestone ([#123](https://github.com/Karthik-beta/Blinkql/issues/123)) ([1e932cc](https://github.com/Karthik-beta/Blinkql/commit/1e932ccf3309ed13a2b33f649a7dd489ef7b27bc))
* **landing:** show M3 as done and M4 as the current milestone ([#134](https://github.com/Karthik-beta/Blinkql/issues/134)) ([24da230](https://github.com/Karthik-beta/Blinkql/commit/24da2309862b9e4c5748d232ec24109596074201))
* **landing:** show M4 as done and M5 as the current milestone ([#139](https://github.com/Karthik-beta/Blinkql/issues/139)) ([39523e3](https://github.com/Karthik-beta/Blinkql/commit/39523e3cc4aea15873880d1e79af4c67d89a723c))
* **landing:** show M5 as done and M6 as the current milestone ([#148](https://github.com/Karthik-beta/Blinkql/issues/148)) ([3639160](https://github.com/Karthik-beta/Blinkql/commit/3639160d75ccdd843aae286e26a98014f0b14b9d))
* **landing:** show M6 as done and M7 as the current milestone ([#159](https://github.com/Karthik-beta/Blinkql/issues/159)) ([fca88f8](https://github.com/Karthik-beta/Blinkql/commit/fca88f808f034eb4598e9050c4494e0c08115747))
* **landing:** show v1.0 as released, with all milestones done ([#166](https://github.com/Karthik-beta/Blinkql/issues/166)) ([cf7f479](https://github.com/Karthik-beta/Blinkql/commit/cf7f479deede51c8b28487e23fa146afa4962426))
* **results:** export results as CSV or Parquet and charts as PNG ([#130](https://github.com/Karthik-beta/Blinkql/issues/130)) ([1c28850](https://github.com/Karthik-beta/Blinkql/commit/1c28850cbd94bb74517127b6228756972839a748))
* **results:** resize grid columns and copy cells as tab-separated text ([#118](https://github.com/Karthik-beta/Blinkql/issues/118)) ([4082338](https://github.com/Karthik-beta/Blinkql/commit/4082338545334afa0bc4e19df5ce33bf61481537))
* **results:** show query results in a plain table (M1 baseline) ([#93](https://github.com/Karthik-beta/Blinkql/issues/93)) ([64fca94](https://github.com/Karthik-beta/Blinkql/commit/64fca94174f478c37e2e1bd90bb24f4a7d5452d4)), closes [#15](https://github.com/Karthik-beta/Blinkql/issues/15)
* **samples:** add synthetic factory sample datasets with one-click loading ([#140](https://github.com/Karthik-beta/Blinkql/issues/140)) ([6d7bf15](https://github.com/Karthik-beta/Blinkql/commit/6d7bf15fca8086d8a628986509d434a3d6eff3c1))
* **templates:** add a downtime Pareto by reason ([#147](https://github.com/Karthik-beta/Blinkql/issues/147)) ([925babe](https://github.com/Karthik-beta/Blinkql/commit/925babe1d71c5ca0e841fead13a8d8d10fc94c5c))
* **templates:** add analysis templates with column mapping and a gallery ([#141](https://github.com/Karthik-beta/Blinkql/issues/141)) ([ca7a18d](https://github.com/Karthik-beta/Blinkql/commit/ca7a18dbc096eb744421581dc80d971db639c0e2))
* **templates:** check import files for duplicate keys, missing fields and broken references ([#145](https://github.com/Karthik-beta/Blinkql/issues/145)) ([ebb6a3e](https://github.com/Karthik-beta/Blinkql/commit/ebb6a3e898fda9903263334f6806f514e7f8723f))
* **templates:** compute MTTR and MTBF per machine ([#143](https://github.com/Karthik-beta/Blinkql/issues/143)) ([8cea418](https://github.com/Karthik-beta/Blinkql/commit/8cea418911e19d71aad0aaec487eca5f4ab0200c))
* **templates:** rank machines by OEE ([#144](https://github.com/Karthik-beta/Blinkql/issues/144)) ([2c42ec3](https://github.com/Karthik-beta/Blinkql/commit/2c42ec3b5b3feb3721476592fe7d3638fdf9a319))
* **templates:** reconcile two exports by key, largest variance first ([#146](https://github.com/Karthik-beta/Blinkql/issues/146)) ([fde9017](https://github.com/Karthik-beta/Blinkql/commit/fde9017a92c625b6a239374002084b1224b5df47))
* **templates:** report output by production day and shift ([#142](https://github.com/Karthik-beta/Blinkql/issues/142)) ([b604bc4](https://github.com/Karthik-beta/Blinkql/commit/b604bc40078d74cb719ea4ecb717e60f88aaa643))


### Bug fixes

* **catalog:** show readable file import errors ([#107](https://github.com/Karthik-beta/Blinkql/issues/107)) ([5162b0d](https://github.com/Karthik-beta/Blinkql/commit/5162b0d4438b07e3f452944227617afbcec1ae42))
* **charts:** start bar and Pareto charts on a text column ([#133](https://github.com/Karthik-beta/Blinkql/issues/133)) ([6fe648a](https://github.com/Karthik-beta/Blinkql/commit/6fe648ad44e3e09fd84eea90ade8f8234477a07d))
* **results:** round durations before choosing units ([#106](https://github.com/Karthik-beta/Blinkql/issues/106)) ([efef4f4](https://github.com/Karthik-beta/Blinkql/commit/efef4f496e112db2bac852c147d39de068ef00bf))
* use blinkql.karthik.nz as the canonical address ([#161](https://github.com/Karthik-beta/Blinkql/issues/161)) ([7b6f095](https://github.com/Karthik-beta/Blinkql/commit/7b6f095cf61431e043c6b7608f2ddffe848b3da2))


### Performance

* **app-shell:** load the SQL editor and chart panel on demand (P-12) ([#150](https://github.com/Karthik-beta/Blinkql/issues/150)) ([ef90aa2](https://github.com/Karthik-beta/Blinkql/commit/ef90aa22af034d68d146e9be26bbff46a25ac3f8))
* **bench:** time a query run while another is still running (P-06) ([#122](https://github.com/Karthik-beta/Blinkql/issues/122)) ([5f1f215](https://github.com/Karthik-beta/Blinkql/commit/5f1f2154036e3102b32d34e6b7f617536022afba))
* **catalog:** convert CSV tables to Parquet for faster repeat queries (P-09) ([#138](https://github.com/Karthik-beta/Blinkql/issues/138)) ([2786708](https://github.com/Karthik-beta/Blinkql/commit/27867085b1e69a773a3ee2b305c04345f2eed921))
* **charts:** compare SQL and client-side downsampling for line charts (P-10) ([#131](https://github.com/Karthik-beta/Blinkql/issues/131)) ([a0486cf](https://github.com/Karthik-beta/Blinkql/commit/a0486cf891fa6725e8e80fa2b6b90c285c0bd454))
* **engine:** start the engine after first paint and cache it for warm starts (P-07) ([#151](https://github.com/Karthik-beta/Blinkql/issues/151)) ([dd95f4f](https://github.com/Karthik-beta/Blinkql/commit/dd95f4f181e3a8ced328597efa747f81cbd0d0ca))
* **engine:** time each start-up step and let Chromium cache the compiled engine (P-13) ([#158](https://github.com/Karthik-beta/Blinkql/issues/158)) ([8c31671](https://github.com/Karthik-beta/Blinkql/commit/8c31671b5f4ca0d4359f3d8fb88560ad23c38a91)), closes [#157](https://github.com/Karthik-beta/Blinkql/issues/157)
* **results:** cancel running queries and drop superseded results (P-06) ([#117](https://github.com/Karthik-beta/Blinkql/issues/117)) ([16364ba](https://github.com/Karthik-beta/Blinkql/commit/16364ba01dbf133faace75e447bb647c4910a2f8))
* **results:** keep results as Arrow and read cells lazily (P-02) ([#108](https://github.com/Karthik-beta/Blinkql/issues/108)) ([718c271](https://github.com/Karthik-beta/Blinkql/commit/718c2711c0d68395f32da09675265a63a83ae11f)), closes [#20](https://github.com/Karthik-beta/Blinkql/issues/20)
* **results:** move results out of React state into a result store (P-03) ([#109](https://github.com/Karthik-beta/Blinkql/issues/109)) ([13b99f9](https://github.com/Karthik-beta/Blinkql/commit/13b99f96a6eee7b0829ae625a124a4716d5a3fee)), closes [#21](https://github.com/Karthik-beta/Blinkql/issues/21)
* **results:** place grid rows by arithmetic instead of a virtualizer ([#121](https://github.com/Karthik-beta/Blinkql/issues/121)) ([6c110e9](https://github.com/Karthik-beta/Blinkql/commit/6c110e9433eb74a0a4d5a59f4d1eaf4f253dee65)), closes [#119](https://github.com/Karthik-beta/Blinkql/issues/119)
* **results:** stream record batches and show the first rows early (P-05) ([#115](https://github.com/Karthik-beta/Blinkql/issues/115)) ([79f9757](https://github.com/Karthik-beta/Blinkql/commit/79f975784792263b5a49f06c027a514eea00d24d))
* **results:** virtualize the results grid (P-04) ([#114](https://github.com/Karthik-beta/Blinkql/issues/114)) ([62221d3](https://github.com/Karthik-beta/Blinkql/commit/62221d3820749317557632fb8f56c5d834c6ec3a))


### Documentation

* add community health files and expand the README ([#80](https://github.com/Karthik-beta/Blinkql/issues/80)) ([14e6d6c](https://github.com/Karthik-beta/Blinkql/commit/14e6d6c73fd4def36baaa0723fa9ddce82b7d050)), closes [#9](https://github.com/Karthik-beta/Blinkql/issues/9)
* rewrite the README for v1.0 with screenshots and a quick start ([#165](https://github.com/Karthik-beta/Blinkql/issues/165)) ([eeae443](https://github.com/Karthik-beta/Blinkql/commit/eeae443326f33d06cc73a9233348e33ed54c13e0))
