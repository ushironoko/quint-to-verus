# quint-to-verus

Quintを仕様の正本とし、**実際のQuint CLIが出力する型情報付き・展開済みIRからVerus仕様を生成**します。実行可能なRustの口座処理がその仕様に従うことをVerusで検証し、意図的なバグを拒否します。

## 結果

macOS / Apple Siliconで実行済みです。

| ケース | Verusの結果 | 判定 |
| --- | --- | --- |
| 正しい実装 | 4 verified, 0 errors | 成功 |
| 引き出しても残高を減らさない実装 | 3 verified, 1 errors | 生成仕様の事後条件で拒否 |
| 引き出し時に取引回数を増やさない実装 | 3 verified, 1 errors | 生成仕様の事後条件で拒否 |
| Quintの引き出し仕様だけを「取引回数+2」へ変更 | 2 verified, 2 errors | 元のRust実装と呼び出し例を拒否 |

正常実装は検証後にコンパイルし、実行ファイルの終了コード0も確認します。`new → deposit(100) → withdraw(30)`の結果が`balance=70, transactions=2`であることは`main`内で静的に検証します。証明用の`assert`はコンパイル時に消去されるため、これは実行時の表示・アサーションによる確認ではありません。

失敗ケースは終了コードだけでは判定しません。Verusの検証エラー数と、`model_withdraw`の`postcondition not satisfied`を確認します。構文エラー、実行ファイル未検出、タイムアウトは期待した失敗として扱いません。

詳細な証跡は`results/summary.json`と`results/*.log`です。変換器の回帰検証は11ケースあります。

## 構成

```text
model/bank.qnt                          ← 仕様の正本
    │ Quint 0.33.0 compile --target=json --flatten=true
    ▼
generated/bank.ir.json                  ← CLIの実出力。手作りIRではない
    │ src/compiler.mjs + bindings.json
    ▼
generated/bank.spec.rs                  ← 自動生成。手編集しない
    ▲ 実装の契約から参照
src/account.rs                         ← 実際に検証・コンパイルするRust
    │ Verus --no-cheating --compile
    ▼
results/account-demo
```

`bindings.json`は初期化・操作・不変条件の**名前の選択**です。残高計算、取引回数の更新、上限値などの仕様を複製していません。操作の金額引数はIRの型と名前解決情報から取得します。

`Account::view`による表現の対応と、Rust関数の`requires` / `ensures`は手書きです。これらが生成した述語を参照します。Rustコードを別の実装モデルへ書き直して検査する構成ではありません。

## 再実行

必要なもの:

- Node.js 18以上とBun。今回の実行環境はNode.js 24.6.0 / Bun 1.4.2。
- Rust toolchain **1.95.0**。Verusの固定リリースが要求します。
- 初回ツール取得には`curl`と`unzip`。

```sh
bun install --frozen-lockfile
bun run setup:verus
bun run poc
```

`setup:verus`は固定リリースをこのフォルダの`.tools/`に取得し、SHA-256を確認して展開します。Rustのインストールやグローバル設定の変更はしません。Rustが不足している場合は、先に次を実行してください。

```sh
rustup toolchain install 1.95.0 --profile minimal
```

別の場所に用意した同じバージョンのVerusを使う場合は、絶対パスを指定します。

```sh
VERUS_BIN=/absolute/path/to/verus bun run poc
```

Verusのバージョンと要求Rustバージョンが一致しなければ停止します。対応する取得設定はmacOS arm64 / macOS x86_64 / Linux x86_64です。今回実行したプラットフォームはmacOS arm64のみです。

個別の実行:

```sh
bun run generate  # Quint IRとVerus仕様を再生成
bun run test     # 変換器の回帰検証（生成済みIRを使用）
bun run verify   # 再生成後、正常系と3つの拒否ケースを確認
```

## モデルと保証する内容

状態は`balance`と`transactions`の二つです。どちらもQuintでは数学的整数、Rustでは`u64`です。モデルは残高・取引回数の上限をそれぞれ1000にし、ゼロ以下の金額、残高不足、容量上限に達した操作をガードで禁止します。

Verusは、以下を**契約を満たす任意の入力・状態に対して**確認します。

- 初期化が生成された初期条件と状態不変条件を満たす。
- 入金・出金が生成された各操作の遷移関係を満たす。
- 操作後も生成された状態不変条件を満たす。
- 実装内で`u64`のオーバーフロー・アンダーフローを起こさない。

実装独自の数値制限を契約へ追加せず、Quint由来のガードと不変条件から機械整数の安全性を示します。操作の契約が成立しない引数を、未検証の外部コードから渡した場合の振る舞いは保証の対象外です。入力拒否を行う公開APIラッパーは実装していません。

`step`は金額1〜1000から選択するシミュレーション用の組み立てです。変換対象は`bindings.json`で選んだパラメーター付き操作であり、`step`・公平性・スケジューラー・実行列全体の詳細化は証明しません。除外した定義は`generated/manifest.json`に明示します。

Quintの100サンプル・最大20ステップのシミュレーションも実行します。これは補助確認であり、TLCによる網羅探索やモデル全体の証明ではありません。TLA+・Apalache・TLC・`verus-tla`・直接のZ3呼び出しは、このPoCでは使いません。

## 変換器の対応範囲

- 一つの展開済みモジュール。状態と操作の引数は`int` / `bool`。
- 整数・真偽値リテラル、名前解決済みの状態・引数参照。
- 引数なしの`pure val` / `val`の参照を展開（循環参照は拒否）。
- `+` / `-`、整数比較、スカラーの等値・不等値、`and` / `or` / `not`、整数の単項マイナス、純粋式の`if`。
- アクション本体は`all`、ガード、明示的な各状態変数への代入。
- `json-bigint`でIDと整数を損失なく読み込み、JavaScriptの浮動小数点へ変換しない。

選択した操作の依存先に、非決定的選択、`any`、操作の呼び出し、時間演算、逐次合成、集合・Map・List、未対応算術などがあれば停止します。各状態変数への代入がない操作も拒否し、「変更しない」と勝手に補完しません。`x' = x`を明示する必要があります。モデルの`assume`と未束縛`const`も拒否します。

`step`のような**明示的に選択しなかった定義**は変換対象外です。モデル全体を変換できたという意味ではありません。

## 信頼する境界

このPoCは変換器そのものの意味保存を形式証明していません。Quintの解析、変換器、Verus、Z3、Rustコンパイラと実行環境を信頼します。回帰検証と変異テストは、この境界を小さな題材で確認するための証拠です。

生成仕様と検証対象コードでは、`assume` / `admit` / `external_body`などによる証明の省略を使いません。検証には`--no-cheating`を付けます。これも変換器の正しさ自体の証明にはなりません。

## 固定した依存関係

| ツール | バージョン |
| --- | --- |
| Quint | 0.33.0 |
| json-bigint | 1.0.0 |
| Verus | 0.2026.04.19.6f7d4de |
| Rust | 1.95.0 |

直接依存は完全一致指定、推移依存は`bun.lock`で固定しています。Verus配布物のURLとハッシュは`tool-versions.json`、入力・生成物のハッシュは`results/summary.json`に記録します。

参照:

- [Quint compile処理](https://github.com/quint-co/quint/blob/main/quint/src/cliCommands.ts)
- [Verusの契約と実行コード](https://verus-lang.github.io/verus/guide/requires_ensures.html)
- [使用したVerusリリース](https://github.com/verus-lang/verus/releases/tag/release/0.2026.04.19.6f7d4de)
