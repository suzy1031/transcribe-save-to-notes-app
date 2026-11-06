---
name: create-pr
description: >-
  実装・修正・リファクタ完了後に GitHub の draft PR を gh で作成する。git 確認、push、
  日本語 body。main 以外でコミット済み・open PR なしならユーザーが PR と言わなくても
  タスク末尾で必ず実行。プルリク、draft PR、作業完了、/create-pr でも適用。
---

# Draft PR 作成

## いつ実行する（自動）

次を **すべて** 満たすとき、ユーザーが PR と言わなくても **返答を終える前に** 本手順を実行する:

- 依頼された **作業が完了** した
- 変更が **コミット済み**（未コミットのみ残る場合は commit 依頼済みなら commit してから PR）
- ブランチが **`main` ではない**（`main` への push はユーザーが **明示したときだけ**）
- 同ブランチに **open な PR が無い**

## 手順

### 1. 状態把握（並列で実行）

```bash
git status
git diff
git diff --staged
git branch -vv
git log main..HEAD --oneline
git diff main...HEAD
gh pr view --json url,state,isDraft 2>/dev/null || true
```

- PR に載るのは **`main..HEAD` の全コミット**
- 既に open PR があれば URL を返して終了

### 2. PR 文案（日本語）

- **Title**: 変更の要点を1行
- **Body** テンプレ:

```markdown
## 概要

## 変更内容
-

## テスト
- [ ]
```

### 3. push → draft PR

```bash
git push -u origin HEAD
```

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

- **`--draft` 必須**、HEREDOC は **`'EOF'`**
- **PR URL をユーザーに返す**

## やらないこと

- ユーザー未依頼の **`main` への push**
- **force push**（明示時以外）
- ユーザー未依頼の **commit**
- `--no-verify`

## リポジトリメモ

- PR: `npm test` / main merge: `cdk deploy`（`.github/workflows/ci.yml`）
