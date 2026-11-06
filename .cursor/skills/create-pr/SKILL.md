---
name: create-pr
description: >-
  Creates a GitHub draft pull request after feature work is complete. Runs git
  inspection, pushes the branch if needed, and opens a draft PR with a Japanese
  body via gh. Use when the user asks to create a PR, open a draft PR, 作業完了後
  with PR, or mentions /create-pr.
---

# Draft PR 作成

作業が完了したら **draft PR** を1本作成する。説明文（body）は **日本語**。`gh` のみ使う（Web UI での手作業 PR は避ける）。

## 前提

- リモートは `origin`、ベースブランチは **`main`**（ユーザーが別指定した場合のみ従う）
- **git config は変更しない**
- **force push しない**（ユーザー明示時以外）
- コミットはユーザーが依頼済み、または作業内容がすでにコミット済みであること

## 手順

### 1. 状態把握（並列で実行）

```bash
git status
git diff
git diff --staged
git branch -vv
git log main..HEAD --oneline
git diff main...HEAD
```

- 追跡ブランチが無い / 未 push なら後で push する
- PR に載るのは **`main..HEAD` の全コミット**（最新1件だけ見ない）

### 2. PR 文案（日本語）

- **Title**: 変更の要点を1行（日本語可。例: `feat: Claude 利用量を DynamoDB に記録`）
- **Body** テンプレ:

```markdown
## 概要
（1〜3文。なぜ・何を）

## 変更内容
- （箇条書き）

## テスト
- [ ] （実行したコマンドや確認内容）
```

- 秘密情報（`.env`、鍵、トークン）を body に書かない
- 空 PR（変更ゼロ）なら PR を作らず理由を伝える

### 3. push → draft PR

```bash
git push -u origin HEAD
```

```bash
gh pr create --draft --title "タイトル" --body "$(cat <<'EOF'
## 概要
...

## 変更内容
- ...

## テスト
- [ ] ...

EOF
)"
```

- **`--draft` は必須**
- HEREDOC は **`'EOF'`** でクォート（改行・バッククォートをそのまま渡す）
- 作成後 **PR の URL をユーザーに返す**

### 4. 既に PR がある場合

```bash
gh pr view --json url,state,isDraft
```

- 同ブランチに open PR があれば新規作成せず、URL と draft 状態を報告する

## やらないこと

- `main` への直接 push（ユーザー明示時以外）
- `--no-verify` 等で hook をスキップ
- ユーザー未依頼の **git commit**

## リポジトリ固有メモ

- CI: PR で `npm test`、main merge で `cdk deploy`（`.github/workflows/ci.yml`）
- `.cursor/**` の変更だけの PR は CI paths-ignore で test が走らない場合あり — インフラ/アプリ変更がある PR ではテスト実行を body に書く
