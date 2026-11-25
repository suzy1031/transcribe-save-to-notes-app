# Lambda からの MCP 呼び出しフローとファイル連携図

Lambda 関数が MCP（Model Context Protocol）サーバーを呼び出す際の仕組みと、リポジトリ内ファイル同士のつながりをまとめる。

> [!NOTE]
> 呼び出し元 Lambda は MCP サーバー（API Gateway）へ直接 HTTP リクエストを送信するのではなく、**Anthropic Messages API のリモート MCP クライアント機能（`mcp_servers` + `anthropic-beta: mcp-client-2025-11-20`）** を経由して間接的に MCP サーバーを呼び出す。

現在、バッチ Lambda から MCP を利用しているのは週次要約バッチ（`lambda/weekly/weekly.ts`、`USE_MCP_SERVERS=true` 時）である。

---

## 1. ファイル間のつながり（依存・呼び出し構造）

```mermaid
flowchart LR
    subgraph Caller["呼び出し元 Lambda (WeeklySummarizer)"]
        W["lambda/weekly/weekly.ts<br/>handler() → runWeeklyWithMcp()"]
        ST["lambda/shared/settings.ts<br/>loadCredentials()"]
        LLM["lambda/shared/llm.ts<br/>buildMcpServerDefinitions()<br/>callClaudeMessages()"]
        CONST["lambda/shared/const.ts<br/>DEFAULT_MCP_DOMAIN_NAME<br/>ANTHROPIC_MCP_BETA_HEADER"]

        W --> ST
        W --> LLM
        LLM --> CONST
    end

    subgraph External["外部 API / AWS インフラ"]
        SM[("AWS Secrets Manager<br/>mcpAuthToken / anthropicApiKey")]
        CLAUDE["Anthropic Messages API<br/>https://api.anthropic.com/v1/messages"]
        APIGW["Route 53 + API Gateway (HttpApi)<br/>infra/app.js: mountMcpApi()<br/>https://{domain}.{rootDomain}/"]

        ST -.->|"SECRET_ID 参照"| SM
        LLM -- "1. mcp_servers +<br/>authorization_token を送信" --> CLAUDE
        CLAUDE -- "2. JSON-RPC over HTTP (POST)<br/>Authorization: Bearer {token}" --> APIGW
    end

    subgraph McpLambdas["MCP サーバー Lambda 群 (lambda/mcp/)"]
        IDX_O["obsidian: lambda/mcp/index.ts"]
        IDX_L["line: lambda/mcp/line/index.ts"]
        IDX_U["usage: lambda/mcp/usage/index.ts"]
        IDX_D["drive: lambda/mcp/drive/index.ts"]
        IDX_C["csv: lambda/mcp/csv/index.ts"]

        HTTP["lambda/mcp/http.ts<br/>createMcpFetchHandler()<br/>Bearer 認証・イベント展開"]
        RPC["lambda/mcp/jsonrpc.ts<br/>createMcpServerTransport()<br/>JSON-RPC 2.0 制御"]
        SRV["各ドメイン server.ts<br/>tools/list, tools/call 等"]
        DOM["ドメイン実装<br/>obsidian/obsidian.ts<br/>line/line.ts<br/>claude/claude-usage.ts<br/>drive/drive.ts<br/>csv/csv.ts"]

        APIGW --> IDX_O & IDX_L & IDX_U & IDX_D & IDX_C
        IDX_O & IDX_L & IDX_U & IDX_D & IDX_C --> HTTP
        HTTP -.->|"token 検証"| SM
        HTTP --> RPC
        RPC --> SRV
        SRV --> DOM
    end
```

---

## 2. 実行時リクエストシーケンス

```mermaid
sequenceDiagram
    autonumber
    participant W as lambda/weekly/weekly.ts<br/>(WeeklySummarizer)
    participant S as Secrets Manager<br/>(settings.ts)
    participant L as lambda/shared/llm.ts
    participant C as Anthropic API<br/>(/v1/messages)
    participant A as API Gateway<br/>(infra/app.js)
    participant H as lambda/mcp/http.ts<br/>(createMcpFetchHandler)
    participant R as lambda/mcp/jsonrpc.ts<br/>& 各 server.ts

    W->>S: loadWeeklyCredentials() で<br/>anthropicApiKey / mcpAuthToken を取得
    W->>L: buildMcpServerDefinitions()<br/>(domains: obsidian, line, usage)
    L-->>W: mcp_servers 配列<br/>(URL + authorization_token)

    W->>L: callClaudeMessages({ mcpServers, ... })
    L->>C: POST /v1/messages<br/>header: anthropic-beta: mcp-client-2025-11-20<br/>body: mcp_servers, tools(mcp_toolset)

    loop Claude がツール実行を必要とする間
        C->>A: POST https://{domain}.{rootDomain}/<br/>Authorization: Bearer {mcpAuthToken}<br/>JSON-RPC (initialize / tools/list / tools/call)
        A->>H: MCP Lambda (index.fetch) を起動
        H->>S: loadMcpAuthToken() で期待トークンを取得
        H->>H: verifyBearerToken() で定数時間比較
        H->>R: unwrapLambdaMcpEvent() / handleHttpRequest()
        R->>R: dispatchMethod() で各ツールを実行<br/>(S3 / LINE / DynamoDB 等)
        R-->>H: JSON-RPC レスポンス
        H-->>A: HTTP 200 (JSON)
        A-->>C: ツール実行結果を返却
    end

    C-->>L: 最終応答メッセージ
    L-->>W: { responseText }
```

---

## 3. MCP エンドポイントと実装ファイルの対応表

`infra/app.js` の `mountMcpApi()` により、各 MCP サーバー Lambda にはサブドメインと API Gateway (`POST /`) が割り当てられる。

| ドメイン (`McpDomainName`) | サーバー名 (`MCP_SERVER_NAMES`) | エンドポイント URL | CDK Lambda ID / 関数名 | エントリポイント | サーバー実装 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `obsidian` | `obsidian-s3` | `https://obsidian.<rootDomain>/` | `ObsidianMcp` (`obsidian-s3-mcp`) | `lambda/mcp/index.ts` | `lambda/mcp/obsidian/server.ts` |
| `drive` | `google-drive` | `https://drive.<rootDomain>/` | `DriveMcp` (`google-drive-mcp`) | `lambda/mcp/drive/index.ts` | `lambda/mcp/drive/server.ts` |
| `csv` | `household-csv` | `https://csv.<rootDomain>/` | `CsvMcp` (`household-csv-mcp`) | `lambda/mcp/csv/index.ts` | `lambda/mcp/csv/server.ts` |
| `line` | `line-notification` | `https://line.<rootDomain>/` | `LineMcp` (`line-notification-mcp`) | `lambda/mcp/line/index.ts` | `lambda/mcp/line/server.ts` |
| `usage` | `claude-usage` | `https://usage.<rootDomain>/` | `UsageMcp` (`claude-usage-mcp`) | `lambda/mcp/usage/index.ts` | `lambda/mcp/usage/server.ts` |

- **共通トランスポート・認証**: すべての MCP エントリポイントは `lambda/mcp/http.ts` の `createMcpFetchHandler()` と `lambda/mcp/jsonrpc.ts` の `createMcpServerTransport()` を共有している。
- **ローカル stdio 実行**: `lambda/mcp/stdio.ts` は HTTP 経由ではなく標準入出力（stdio）で Obsidian MCP サーバーを起動するための別エントリポイント。
