---
name: commit-and-draft-pr
description: >-
  実装・修正・リファクタ完了後に、変更を意味のある単位へ分割してコミットし、
  リポジトリの様式に合わせたメッセージを付け、push し、open な PR が無ければ
  GitHub の draft PR を gh で作成する。main 以外では、ユーザーが commit や PR と
  言わなくてもタスク末尾で必ず実行する。コミット分割、コミットメッセージ、push、
  プルリク、draft PR、作業完了、/commit-and-draft-pr、/create-pr でも適用。
---

# 分割コミット、push、draft PR

依頼した実装が終わったら、返答を終える前にここまで行う。質問だけ、またはユーザーがコミット不要・PR 不要と明示したタスクでは実行しない。

## いつ実行する

次をすべて満たすとき、別途「コミットして」「PR を作って」と言われていなくても実行する。

- 依頼された実装・修正・テスト追加・リファクタが **完了** している
- ブランチが **`main` ではない**（`main` への push はユーザーが明示したときだけ）
- ユーザーが **コミット不要・PR 不要** と言っていない

open な PR が既にあるときも、未コミットの完了分はコミットして push する。`gh pr create` は作らず、既存 PR の URL を返す。

## 1. 状態を見る

並列で実行する。

```bash
git status
git diff
git diff --staged
git log -15 --oneline
git branch -vv
git diff main...HEAD
gh pr view --json url,state,isDraft 2>/dev/null || true
```

PR に載るのは **`main..HEAD` の全コミット** と、このあと作るコミット。

## 2. 意味のある単位に分ける

差分を読み、コミットの区切りを決めてから stage する。

- 目的が一つなら **1 コミット**。ファイル数では割らない。
- 分ける基準は「一つの理由でレビューできるか」。機能追加、バグ修正、リファクタ、無関係なドキュメントや設定は別コミット。
- その変更を検証するテストは **同じコミット** に含める。
- 各コミットは、その時点で意図が通る木にする。
- このタスクと無関係な既存の変更は含めない。
- `.env` や認証情報はコミットしない。含まれていたら除外してユーザーに知らせる。
- `git add -i` と `git add -p` は使わない。ファイル単位で分ける。1 ファイルに複数の目的が混ざるときは、主目的のコミットに入れ、メッセージにその範囲を書く。

先にリファクタ、次にそのリファクタに乗る機能、という順序にする。

## 3. コミットする

`git log` の型に合わせる。件名は `feat:` / `fix:` / `refactor:` / `test:` / `docs:` / `chore:` のいずれかと、**なぜ** 変えるかを 1〜2 文で書く。

コミットごとに対象ファイルだけを足す。

```bash
git add path/to/file
git commit -m "$(cat <<'EOF'
feat: なぜこの変更が必要かを書く

EOF
)"
```

- 空コミットは作らない。
- `--no-verify` は付けない。
- `git config` は変えない。force push、hard reset はユーザーが明示したときだけ。
- フックがファイルを書き換えたら、それを含めて **新しいコミット** を作る。`--amend` は、ユーザーが明示したか、この会話で自分が作った未 push の HEAD をフックが書き換えたときだけ。

全コミットのあと `git status` で、タスク分が残っていないことを確認する。

## 4. push する

```bash
git push -u origin HEAD
```

## 5. draft PR を作る

同ブランチに open な PR があるときは URL を返して終わる。

無ければ日本語で作る。Title は変更の要点を 1 行。Body はこの形。

```bash
gh pr create --draft --title "タイトル" --body "$(cat <<'EOF'
## 概要

## 変更内容
-

## テスト
- [ ]

EOF
)"
```

- **`--draft` 必須**。HEREDOC は **`'EOF'`**。
- 概要は目的、変更内容はコミット単位の要点、テストは実行した確認と未確認を書く。
- **PR URL をユーザーに返す。**

## やらないこと

- ユーザーが明示していない **`main` への push**
- **force push**
- 質問のみのタスクでの commit と PR
- 秘密情報の commit

## リポジトリメモ

- PR の CI は `npx biome ci .` と `npm test`。`main` への push で `cdk deploy`（`.github/workflows/ci.yml`）。
- `.cursor/**` と `.agents/**` だけの差分は CI の `paths-ignore` に入る。
