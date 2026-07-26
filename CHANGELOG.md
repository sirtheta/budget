# Changelog

## [0.1.4](https://github.com/sirtheta/budget/compare/budget-v0.1.3...budget-v0.1.4) (2026-07-26)


### Features

* **accounts:** show Bitcoin wallet gain/loss against cost basis ([e0b8ad7](https://github.com/sirtheta/budget/commit/e0b8ad7d41f6986a81e64bc8e02ff770612f38be))
* **import:** suggest category from prior categorised transactions ([fb7c662](https://github.com/sirtheta/budget/commit/fb7c66267f60110a3333eb32cdd293fa889dec89))


### Bug Fixes

* **layout:** mark anti-flash inline scripts as JS data blocks ([c931183](https://github.com/sirtheta/budget/commit/c931183c4f1dabe46983ce4b78791e58f78f4f4e))

## [0.1.3](https://github.com/sirtheta/budget/compare/budget-v0.1.2...budget-v0.1.3) (2026-07-26)


### Bug Fixes

* **auth:** revoke existing sessions when credentials change ([2381dc6](https://github.com/sirtheta/budget/commit/2381dc64a8dcccec136aec325b2e184f07a2be83))
* **auth:** stop deriving rate-limit keys from a spoofable header ([eb77605](https://github.com/sirtheta/budget/commit/eb77605fc83f81237cf5683a0a2bb1753ff406fe))
* **auth:** throttle the password checks on the account settings actions ([a4ec377](https://github.com/sirtheta/budget/commit/a4ec377d792117926fe5a9748ced4d28f6e61dc8))
* **auth:** warn when production runs without an https AUTH_URL ([0a8e14c](https://github.com/sirtheta/budget/commit/0a8e14c0266c9940ef1fd9aadc77f3e96f816eba))
* **email:** validate the SMTP sender fields before building the From header ([c12878f](https://github.com/sirtheta/budget/commit/c12878f3a348ac80a2aeede60e5899c7383d8702))
* **export:** neutralise spreadsheet formulas in the CSV export ([19ff819](https://github.com/sirtheta/budget/commit/19ff819eca782b69814bbc14e9c47452b93c9a93))
* **import:** re-derive row fingerprints instead of trusting the client ([2e4088a](https://github.com/sirtheta/budget/commit/2e4088a828c319e9a6facce719ac2d89fe11f88c))
* **import:** refuse regex rules that can backtrack catastrophically ([cec303d](https://github.com/sirtheta/budget/commit/cec303d82e80f3223dcc7cf686162562f70dcdf1))
* **logging:** log unexpected errors in transfer, BTC purchase, and import paths ([0df3a9a](https://github.com/sirtheta/budget/commit/0df3a9a334a73c9bab030eac8a02442c5e9354c1))
* **logging:** mask email addresses and redact secrets in log output ([9b8d9ec](https://github.com/sirtheta/budget/commit/9b8d9ece0ca1a92e7a4202af077a3a8a8a161ef9))
* **proxy:** redirect signed-in users to /dashboard, not /calendar ([c0fa748](https://github.com/sirtheta/budget/commit/c0fa7482565b2a27e268dea63f3f5a3bd6341983))
* **settings:** keep the encrypted SMTP password off the client ([201c589](https://github.com/sirtheta/budget/commit/201c5894b1af2bcc68acb09b12884ee0a97141fa))
* **users:** stop sending password hashes to the browser ([fbed3ed](https://github.com/sirtheta/budget/commit/fbed3eda3b5696ce8e689a9b4eadb65ec04ba80b))

## [0.1.2](https://github.com/sirtheta/budget/compare/budget-v0.1.1...budget-v0.1.2) (2026-07-26)


### Bug Fixes

* **docker:** remove dead COPY of nonexistent public directory ([3f3b360](https://github.com/sirtheta/budget/commit/3f3b36021fb8533c48d0536bfb495c5f3376629c))

## [0.1.1](https://github.com/sirtheta/budget/compare/budget-v0.1.0...budget-v0.1.1) (2026-07-26)


### Features

* **accounts:** add Bitcoin wallet accounts with live CHF conversion ([cd1af40](https://github.com/sirtheta/budget/commit/cd1af409d7927500c1831564cf2f7a81eaada8b9))
* **accounts:** manual entry for weekly Bitcoin purchases ([56e391c](https://github.com/sirtheta/budget/commit/56e391c3f7d3f1cf16ba9a067b4f6c89e02a346f))
* **auth:** allow users to enable two-factor authentication ([ea94368](https://github.com/sirtheta/budget/commit/ea9436818ec2f61f61b27a8b7b4b1a2976c784fa))
* household budgeting app with CAMT.053 import ([4a943f4](https://github.com/sirtheta/budget/commit/4a943f4f6d630b1d127a9b386891a4d50ec02631))
* **import:** add live search to import rules table ([532aa54](https://github.com/sirtheta/budget/commit/532aa542edf35d177b675b20631d631db10fa275))
* **import:** auto-select CSV mapping matching the chosen account ([794125b](https://github.com/sirtheta/budget/commit/794125baac40c94068eac6a5b32f7ff9cefac790))
* **import:** auto-transfer rules and manual conversion ([2298eee](https://github.com/sirtheta/budget/commit/2298eee15b621fc2149bf453b468fce42dae9dbe))
* **import:** correct rule matches and add amount-range rules ([c106b11](https://github.com/sirtheta/budget/commit/c106b110cb1a046c4c0d95e10dfcc8a07e8e7fea))
* **import:** match imported income against CustomerManagement invoices ([a57a69b](https://github.com/sirtheta/budget/commit/a57a69b927bc244d67495a0894ba8e0d10dbd9fc))
* **import:** starter rule set for common Swiss merchants ([6c76527](https://github.com/sirtheta/budget/commit/6c7652764e49129355b29f46c064d79b439fdf15))
* **import:** support inverted-sign CSV amount column and starter mappings ([6e829f8](https://github.com/sirtheta/budget/commit/6e829f80880abc9121bd9c3de2cb5ec2b77b7278))
* **seed:** add --users-only flag to skip full data seed ([fe8f37f](https://github.com/sirtheta/budget/commit/fe8f37f968818c702816e1f1a0ddf6239223af34))
* **transactions:** create import rule from manual categorisation ([995afb1](https://github.com/sirtheta/budget/commit/995afb1662b51ba716eafa9f2c712dbf592fbe5c))
* **ui:** redesign app favicon as bar chart icon ([8bcd924](https://github.com/sirtheta/budget/commit/8bcd92452540066d78db18ed28053f0bed3d15b5))
* **ui:** replace browser confirm() with in-app confirm dialog ([d7c5045](https://github.com/sirtheta/budget/commit/d7c50458f4240482b11f4118ceac512d49496524))
* **ui:** searchable combobox for category and account selects ([7302198](https://github.com/sirtheta/budget/commit/730219811d89be52da9a93a3a06594f9c175c97f))


### Bug Fixes

* **accounts:** make BTC wallet balance update atomic ([ecccd17](https://github.com/sirtheta/budget/commit/ecccd174039654f9dba449d81bd5863b8c31f8aa))
* **auth:** require 2FA to be disabled before restarting setup ([740cfea](https://github.com/sirtheta/budget/commit/740cfeacd49ef036e934cf0324fa6071e89f603f))
* **import:** clarify rejected-row reason for empty date column ([10906f0](https://github.com/sirtheta/budget/commit/10906f0dc052804e5f873b6b3aee04a12362efbd))
* **import:** keep rule fallback for rows adopted at preview time ([9fb4f15](https://github.com/sirtheta/budget/commit/9fb4f15d45658c3a780421d1af08e4f03953c6ab))
* **import:** make commitImportAction atomic ([d1b4225](https://github.com/sirtheta/budget/commit/d1b42252f238c87121316fbb2f85fd5b08385ec8))
* **import:** surface per-row rejection reason in CSV preview ([0a0ac89](https://github.com/sirtheta/budget/commit/0a0ac89143e35733d6acb0b326d3a512ee8c52c2))
* **ui:** keep dialog backdrop and scroll lock with modal={false} ([a315ad7](https://github.com/sirtheta/budget/commit/a315ad789340d7a9143073da80c3d9137350af3d))
