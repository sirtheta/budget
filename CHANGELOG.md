# Changelog

## [0.1.12](https://github.com/sirtheta/budget/compare/budget-v0.1.11...budget-v0.1.12) (2026-07-31)


### Bug Fixes

* **deps:** pin nodemailer to 8.x for next-auth peer range ([#41](https://github.com/sirtheta/budget/issues/41)) ([7808470](https://github.com/sirtheta/budget/commit/780847051460d99c3eceef732ec3a843d56b446b))

## [0.1.11](https://github.com/sirtheta/budget/compare/budget-v0.1.10...budget-v0.1.11) (2026-07-31)


### Features

* add embedded user manual with screenshot pipeline ([d8515ec](https://github.com/sirtheta/budget/commit/d8515ec76ce3b3bf33451e24111801227b0e0ca9))
* **auth:** reject passwords found in known data breaches ([dbcf222](https://github.com/sirtheta/budget/commit/dbcf222c7a0bea067b023e0db20541050a256dbf))
* **import:** split import page into tabs with paginated history ([0cfb283](https://github.com/sirtheta/budget/commit/0cfb28317b2adf24472116e1bca1816e50569cdb))
* **settings:** add SMTP connection test ([01690aa](https://github.com/sirtheta/budget/commit/01690aade2480666e40e9ebe7157e1e7fb817327))
* **transactions:** live search with 300ms debounce ([79992c4](https://github.com/sirtheta/budget/commit/79992c46fdb1c9db75e7b2ec71c54142f8eb88fd))
* **users:** let new users set their own password via email invite ([aa99aaf](https://github.com/sirtheta/budget/commit/aa99aafdd776e7d41f672ed39890d63c68588237))


### Bug Fixes

* **auth:** add global rate limit to password reset requests ([3b3cfa8](https://github.com/sirtheta/budget/commit/3b3cfa890c4b56c9e6c4ab5e9fc75eec54f2b860))
* **ci:** check PR author instead of event actor for dependabot skip ([dcf5800](https://github.com/sirtheta/budget/commit/dcf580027a42ebefa458283b76bf2eb26b2fe797))
* **import:** only mark one row as adopting a pending transfer leg ([f2c9731](https://github.com/sirtheta/budget/commit/f2c973170c9e37ec055c2f94bd8b3e447dcfd303))
* **import:** stop double-counting adopted transfer legs in balance check ([5f19387](https://github.com/sirtheta/budget/commit/5f19387cb47bf1ccbf8ad9d47b7f52807e279dc7))
* **import:** track fetched row count separately from displayed batches ([ce2dd02](https://github.com/sirtheta/budget/commit/ce2dd02aa29562991bf093191ffe492f26804c0b))

## [0.1.10](https://github.com/sirtheta/budget/compare/budget-v0.1.9...budget-v0.1.10) (2026-07-30)


### Features

* **analytics:** split net worth into liquid and illiquid assets ([#31](https://github.com/sirtheta/budget/issues/31)) ([5c415ee](https://github.com/sirtheta/budget/commit/5c415ee4780397cda4e14bc070c6dcccbc341ef4))
* **backup:** verify snapshots and add a restore path ([849df2c](https://github.com/sirtheta/budget/commit/849df2cd7830477bc9dce29f0b20e7007d4dbc9b))
* **dashboard:** add month navigation ([1a1d373](https://github.com/sirtheta/budget/commit/1a1d37382bdccb89b396fdf1cbdd8ec07ffdd40b))
* **ops:** add /api/health probe that touches the database ([cd4a0af](https://github.com/sirtheta/budget/commit/cd4a0af1d18bffe1f190f54fb6c5a62b38a54703))
* **pwa:** add a web app manifest so the app installs to a home screen ([1a5c7f6](https://github.com/sirtheta/budget/commit/1a5c7f67aa0c335ca2314d1f5893bac44f300896))
* **ui:** add error, not-found and loading boundaries ([f64fb17](https://github.com/sirtheta/budget/commit/f64fb174d3702cc6045e819816ac1e362ee29f94))


### Bug Fixes

* **a11y:** add automated checks and fix the contrast failures they found ([e63e7df](https://github.com/sirtheta/budget/commit/e63e7df127491c5edbac340629a56a590ddfa0df))
* **actions:** validate Server Action arguments at runtime ([933e859](https://github.com/sirtheta/budget/commit/933e859eece9f581e253ecf58877745a4324ba4d))
* **analytics:** stop grid cards overflowing on narrow phones ([#29](https://github.com/sirtheta/budget/issues/29)) ([bddccdd](https://github.com/sirtheta/budget/commit/bddccdd5c02994b9c069b9a06a8f90116d50a3c1))
* **transactions:** make search find umlauts regardless of case ([bdd0fa9](https://github.com/sirtheta/budget/commit/bdd0fa9deb10fff8c37ae7377041ea8d70db45fd))
* **ui:** build dialog triggers client-side, not in server components ([351c5f7](https://github.com/sirtheta/budget/commit/351c5f7ae86d169386a9e55f6c6a45de01e8e273))


### Performance Improvements

* **accounts:** stop blocking the render on the BTC rate fetch ([ab09003](https://github.com/sirtheta/budget/commit/ab09003a044e4e7a6c2732c5328694d7cf5d246b))

## [0.1.9](https://github.com/sirtheta/budget/compare/budget-v0.1.8...budget-v0.1.9) (2026-07-29)


### Bug Fixes

* **budget:** remount amount input on month change ([5454c7e](https://github.com/sirtheta/budget/commit/5454c7e4fc11671923648b01b0fe6cdc61ec0366))
* **budget:** stop flagging Income lines as warning/over ([46bcd6b](https://github.com/sirtheta/budget/commit/46bcd6b3383983156206e2ccc91666b190df912b))
* **import:** handle importHash race in commitImportAction ([69dc4ae](https://github.com/sirtheta/budget/commit/69dc4aeede717839439156e15b4b3c8e6f240383))
* **import:** stop preview freezing the tab on large statements ([1f72af3](https://github.com/sirtheta/budget/commit/1f72af3f700373e15ca2fe14d06fba2391dbc97d))
* **import:** stop treating NOTPROVIDED InstrId as a real bank reference ([16a8a22](https://github.com/sirtheta/budget/commit/16a8a224debc0be9241f7be44ee419978e4265eb))
* **transactions:** load real account IDs when editing a transfer ([080c520](https://github.com/sirtheta/budget/commit/080c520cae6a76c5785b731fd3d873fe0acfbf16))
* **transactions:** show row action buttons on mobile ([691536d](https://github.com/sirtheta/budget/commit/691536d9a5e14d474bf358b285d44c1dcc38307e))

## [0.1.8](https://github.com/sirtheta/budget/compare/budget-v0.1.7...budget-v0.1.8) (2026-07-29)


### Features

* **accounts:** link account name to its filtered transactions ([e184103](https://github.com/sirtheta/budget/commit/e18410398686232bca111fb6ab6ff7e54e4ba308))
* **import:** add "Both" field option to import rules ([defa9a0](https://github.com/sirtheta/budget/commit/defa9a0ca5f4ea92d2346a231ee9850083d048cd))
* **import:** add date range filter to import preview ([ccc36ca](https://github.com/sirtheta/budget/commit/ccc36ca4b1ec741ee2cf4add2a96f0fda1cc371a))
* **import:** create categories inline during import review ([f897185](https://github.com/sirtheta/budget/commit/f89718509eb2f0918e5ff9195529f7339ea904f0))


### Bug Fixes

* **accounts:** reject negative BTC cost basis ([f03ab8d](https://github.com/sirtheta/budget/commit/f03ab8d5e362068614c5bed3485b78c1d8a2e3c9))
* **import:** make rule dialog usable on mobile ([#26](https://github.com/sirtheta/budget/issues/26)) ([6800615](https://github.com/sirtheta/budget/commit/68006158c1c5e3ab4d6382ef14c8c7b35494fd2b))
* **test:** mutate config through a typed view in invoicing test ([88061f6](https://github.com/sirtheta/budget/commit/88061f6dfff24c6cb389569b10cd51dffd499c24))
* **transactions:** default rule-creation checkbox to unchecked ([ed7d72b](https://github.com/sirtheta/budget/commit/ed7d72b8be61488ef6e04b07ea66343b5269bd06))
* **transactions:** exclude transfers from "no category" filter ([ea825b1](https://github.com/sirtheta/budget/commit/ea825b13969a8ddef60867ac93951e8875107a75))
* **transactions:** reject negative split-part amounts ([fc1ea59](https://github.com/sirtheta/budget/commit/fc1ea59f098cab0f7aeb04a9d3107c94b5b74fc5))

## [0.1.7](https://github.com/sirtheta/budget/compare/budget-v0.1.6...budget-v0.1.7) (2026-07-27)


### Features

* **analytics:** add net worth growth forecast ([#25](https://github.com/sirtheta/budget/issues/25)) ([33c494f](https://github.com/sirtheta/budget/commit/33c494f0897530094e09a65ea2a0a517dc05dd2b))
* **transactions:** support splitting a booking across categories ([#21](https://github.com/sirtheta/budget/issues/21)) ([036425a](https://github.com/sirtheta/budget/commit/036425a7ce3ab28426a62b0c3318a9d4489d31f7))

## [0.1.6](https://github.com/sirtheta/budget/compare/budget-v0.1.5...budget-v0.1.6) (2026-07-27)


### Bug Fixes

* make data tables and page headers usable on mobile ([#19](https://github.com/sirtheta/budget/issues/19)) ([37fd62b](https://github.com/sirtheta/budget/commit/37fd62b872a89dd63f3115338f5a6b84f34fdafc))

## [0.1.5](https://github.com/sirtheta/budget/compare/budget-v0.1.4...budget-v0.1.5) (2026-07-26)


### Features

* **import:** match rules by transaction sign ([afda97e](https://github.com/sirtheta/budget/commit/afda97e0e9318a7a4edc67f9f63908982d470bbe))


### Bug Fixes

* **settings:** clarify single-currency hint text ([ae79172](https://github.com/sirtheta/budget/commit/ae7917242d65c822413dd3cb9175420852da4244))

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
