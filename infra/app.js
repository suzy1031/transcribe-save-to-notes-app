import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { App, CfnOutput, Duration, RemovalPolicy, Stack, TimeZone } from "aws-cdk-lib";
import { DomainName, HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { Certificate } from "aws-cdk-lib/aws-certificatemanager";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { OpenIdConnectProvider, PolicyStatement, Role, User, WebIdentityPrincipal } from "aws-cdk-lib/aws-iam";
import { Architecture, Code, Function as LambdaFunction, LayerVersion, Runtime } from "aws-cdk-lib/aws-lambda";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { ARecord, HostedZone, RecordTarget } from "aws-cdk-lib/aws-route53";
import { ApiGatewayv2DomainProperties } from "aws-cdk-lib/aws-route53-targets";
import { BlockPublicAccess, Bucket, BucketEncryption, HttpMethods } from "aws-cdk-lib/aws-s3";
import { Schedule, ScheduleExpression } from "aws-cdk-lib/aws-scheduler";
import { LambdaInvoke } from "aws-cdk-lib/aws-scheduler-targets";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import {
  DEFAULT_AWS_REGION,
  DEFAULT_CLAUDE_TRANSCRIBE_MODEL_ID,
  DEFAULT_CLAUDE_WEEKLY_MODEL_ID,
  DEFAULT_CSV_INBOX_FOLDER,
  DEFAULT_CSV_PROCESSED_FOLDER,
  DEFAULT_KINDLE_BOOK_PREFIX,
  DEFAULT_KINDLE_DRIVE_PARENT,
  DEFAULT_KINDLE_PROCESSED_FOLDER,
  DEFAULT_OBSIDIAN_DAILY_FOLDER,
  DEFAULT_OBSIDIAN_HOUSEHOLD_BUDGET_FOLDER,
  DEFAULT_OBSIDIAN_KINDLE_FOLDER,
  DEFAULT_OBSIDIAN_SUMMARY_FOLDER,
  DEFAULT_OBSIDIAN_VAULT_NAME,
} from "../lambda/shared/const.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const lambdaDir = path.join(__dirname, "../lambda");
const lambdaLogRetention = RetentionDays.ONE_MONTH;

class NotesPipelineStack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    const bunLayerArn = process.env.BUN_LAYER_ARN || `arn:aws:lambda:${this.region}:${this.account}:layer:bun:1`;
    const bunLayer = LayerVersion.fromLayerVersionArn(this, "BunLayer", bunLayerArn);

    const createBunFunction = (fnId, { entry, ...rest }) =>
      new LambdaFunction(this, fnId, {
        runtime: Runtime.PROVIDED_AL2023,
        architecture: Architecture.ARM_64,
        handler: "index.fetch",
        layers: [bunLayer],
        code: Code.fromAsset(lambdaDir, {
          exclude: ["**/*.test.ts"],
          bundling: {
            image: Runtime.PROVIDED_AL2023.bundlingImage,
            environment: {
              ENTRY: path.relative(lambdaDir, entry),
            },
            local: {
              tryBundle(outputDir) {
                execFileSync(
                  "bun",
                  ["build", entry, "--target=bun", "--format=esm", "--outfile", path.join(outputDir, "index.js")],
                  { stdio: "inherit" },
                );
                return true;
              },
            },
          },
        }),
        logRetention: lambdaLogRetention,
        ...rest,
      });

    const secret = new Secret(this, "Credentials", {
      secretName: "notes-pipeline/credentials",
      description:
        "JSON with googleServiceAccount, anthropicApiKey, lineChannelAccessToken, lineUserId, and mcpAuthToken. Replace the generated value before the first run.",
      removalPolicy: RemovalPolicy.RETAIN,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          googleServiceAccount: { client_email: "", private_key: "" },
          lineChannelAccessToken: "",
          lineUserId: "",
          mcpAuthToken: "",
        }),
        generateStringKey: "generated",
      },
    });

    const notesBucket = new Bucket(this, "NotesVaultBucket", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.RETAIN,
      cors: [
        {
          allowedOrigins: ["app://obsidian.md", "capacitor://localhost", "http://localhost"],
          allowedMethods: [HttpMethods.GET, HttpMethods.PUT, HttpMethods.POST, HttpMethods.HEAD, HttpMethods.DELETE],
          allowedHeaders: ["*"],
          exposedHeaders: ["ETag"],
          maxAge: 3600,
        },
      ],
    });

    const obsidianSyncUser = new User(this, "ObsidianSyncUser", {
      userName: "notes-pipeline-obsidian-sync",
    });
    notesBucket.grantReadWrite(obsidianSyncUser);

    new CfnOutput(this, "NotesVaultBucketName", {
      value: notesBucket.bucketName,
      description: "S3 bucket name for Obsidian Vault (Remotely Save)",
    });

    new CfnOutput(this, "ObsidianSyncUserName", {
      value: obsidianSyncUser.userName,
      description: "IAM user name for Obsidian Remotely Save plugin",
    });

    const claudeUsage = new Table(this, "ClaudeUsage", {
      tableName: "notes-pipeline-claude-usage",
      partitionKey: { name: "pk", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const fn = createBunFunction("Handler", {
      entry: path.join(lambdaDir, "inbox/index.ts"),
      memorySize: 512,
      timeout: Duration.minutes(5),
      reservedConcurrentExecutions: 1,
      environment: {
        SECRET_ID: secret.secretArn,
        BEDROCK_REGION: this.region,
        OBSIDIAN_DAILY_FOLDER: DEFAULT_OBSIDIAN_DAILY_FOLDER,
        CLAUDE_MODEL_ID: DEFAULT_CLAUDE_TRANSCRIBE_MODEL_ID,
        CLAUDE_USAGE_TABLE_NAME: claudeUsage.tableName,
      },
    });

    const weekly = createBunFunction("WeeklySummarizer", {
      functionName: "craft-weekly-summarizer",
      entry: path.join(lambdaDir, "weekly/weekly.ts"),
      memorySize: 512,
      timeout: Duration.minutes(3),
      reservedConcurrentExecutions: 1,
      environment: {
        SECRET_ID: secret.secretArn,
        BEDROCK_REGION: this.region,
        CLAUDE_MODEL_ID: DEFAULT_CLAUDE_WEEKLY_MODEL_ID,
        OBSIDIAN_DAILY_FOLDER: DEFAULT_OBSIDIAN_DAILY_FOLDER,
        OBSIDIAN_SUMMARY_FOLDER: DEFAULT_OBSIDIAN_SUMMARY_FOLDER,
        CLAUDE_USAGE_TABLE_NAME: claudeUsage.tableName,
      },
    });

    secret.grantRead(fn);
    secret.grantRead(weekly);

    const reminder = createBunFunction("WeeklyReminder", {
      functionName: "craft-weekly-reminder",
      entry: path.join(lambdaDir, "reminder/reminder.ts"),
      memorySize: 256,
      timeout: Duration.minutes(2),
      reservedConcurrentExecutions: 1,
      environment: {
        SECRET_ID: secret.secretArn,
        BEDROCK_REGION: this.region,
        CLAUDE_MODEL_ID: DEFAULT_CLAUDE_WEEKLY_MODEL_ID,
        OBSIDIAN_SUMMARY_FOLDER: DEFAULT_OBSIDIAN_SUMMARY_FOLDER,
        CLAUDE_USAGE_TABLE_NAME: claudeUsage.tableName,
      },
    });

    secret.grantRead(reminder);

    const csvImport = createBunFunction("CsvImport", {
      functionName: "csv-spreadsheet-import",
      entry: path.join(lambdaDir, "csv/csv-import.ts"),
      memorySize: 512,
      timeout: Duration.minutes(3),
      reservedConcurrentExecutions: 1,
      environment: {
        SECRET_ID: secret.secretArn,
        BEDROCK_REGION: this.region,
        CLAUDE_MODEL_ID: DEFAULT_CLAUDE_WEEKLY_MODEL_ID,
        OBSIDIAN_HOUSEHOLD_BUDGET_FOLDER: DEFAULT_OBSIDIAN_HOUSEHOLD_BUDGET_FOLDER,
        CSV_INBOX_FOLDER_NAME: DEFAULT_CSV_INBOX_FOLDER,
        CSV_PROCESSED_FOLDER_NAME: DEFAULT_CSV_PROCESSED_FOLDER,
        CLAUDE_USAGE_TABLE_NAME: claudeUsage.tableName,
      },
    });

    secret.grantRead(csvImport);

    const kindle = createBunFunction("KindleSummarizer", {
      functionName: "craft-kindle-summarizer",
      entry: path.join(lambdaDir, "kindle/kindle.ts"),
      memorySize: 512,
      timeout: Duration.minutes(5),
      reservedConcurrentExecutions: 1,
      environment: {
        SECRET_ID: secret.secretArn,
        BEDROCK_REGION: this.region,
        CLAUDE_MODEL_ID: DEFAULT_CLAUDE_TRANSCRIBE_MODEL_ID,
        OBSIDIAN_KINDLE_FOLDER: DEFAULT_OBSIDIAN_KINDLE_FOLDER,
        KINDLE_DRIVE_PARENT_FOLDER_NAME: DEFAULT_KINDLE_DRIVE_PARENT,
        KINDLE_BOOK_FOLDER_PREFIX: DEFAULT_KINDLE_BOOK_PREFIX,
        KINDLE_PROCESSED_FOLDER_NAME: DEFAULT_KINDLE_PROCESSED_FOLDER,
        CLAUDE_USAGE_TABLE_NAME: claudeUsage.tableName,
      },
    });

    secret.grantRead(kindle);
    claudeUsage.grantWriteData(fn);
    claudeUsage.grantReadWriteData(weekly);
    claudeUsage.grantWriteData(reminder);
    claudeUsage.grantWriteData(csvImport);
    claudeUsage.grantWriteData(kindle);

    const obsidianMcp = createBunFunction("ObsidianMcp", {
      functionName: "obsidian-s3-mcp",
      entry: path.join(lambdaDir, "mcp/index.ts"),
      memorySize: 256,
      timeout: Duration.seconds(30),
      reservedConcurrentExecutions: 1,
      environment: {
        SECRET_ID: secret.secretArn,
        BEDROCK_REGION: this.region,
        NOTES_BUCKET_NAME: notesBucket.bucketName,
        OBSIDIAN_VAULT_NAME: DEFAULT_OBSIDIAN_VAULT_NAME,
      },
    });

    secret.grantRead(obsidianMcp);
    notesBucket.grantReadWrite(obsidianMcp);

    const driveMcp = createBunFunction("DriveMcp", {
      functionName: "google-drive-mcp",
      entry: path.join(lambdaDir, "mcp/drive/index.ts"),
      memorySize: 256,
      timeout: Duration.seconds(30),
      reservedConcurrentExecutions: 1,
      environment: {
        SECRET_ID: secret.secretArn,
        BEDROCK_REGION: this.region,
      },
    });

    secret.grantRead(driveMcp);

    const csvMcp = createBunFunction("CsvMcp", {
      functionName: "household-csv-mcp",
      entry: path.join(lambdaDir, "mcp/csv/index.ts"),
      memorySize: 256,
      timeout: Duration.seconds(30),
      reservedConcurrentExecutions: 1,
      environment: {
        SECRET_ID: secret.secretArn,
        BEDROCK_REGION: this.region,
      },
    });

    secret.grantRead(csvMcp);

    const lineMcp = createBunFunction("LineMcp", {
      functionName: "line-notification-mcp",
      entry: path.join(lambdaDir, "mcp/line/index.ts"),
      memorySize: 256,
      timeout: Duration.seconds(30),
      reservedConcurrentExecutions: 1,
      environment: {
        SECRET_ID: secret.secretArn,
        BEDROCK_REGION: this.region,
      },
    });

    secret.grantRead(lineMcp);

    const usageMcp = createBunFunction("UsageMcp", {
      functionName: "claude-usage-mcp",
      entry: path.join(lambdaDir, "mcp/usage/index.ts"),
      memorySize: 256,
      timeout: Duration.seconds(30),
      reservedConcurrentExecutions: 1,
      environment: {
        SECRET_ID: secret.secretArn,
        BEDROCK_REGION: this.region,
        CLAUDE_USAGE_TABLE_NAME: claudeUsage.tableName,
      },
    });

    secret.grantRead(usageMcp);
    claudeUsage.grantReadWriteData(usageMcp);

    const mcpRootDomain = process.env.MCP_DOMAIN_NAME || this.node.tryGetContext("mcpDomainName") || "";
    const mcpHostedZoneId = process.env.MCP_HOSTED_ZONE_ID || this.node.tryGetContext("mcpHostedZoneId") || "";
    const mcpCertificateArn = process.env.MCP_CERTIFICATE_ARN || this.node.tryGetContext("mcpCertificateArn") || "";

    if (mcpRootDomain && mcpHostedZoneId && mcpCertificateArn) {
      const mcpHostedZone = HostedZone.fromHostedZoneAttributes(this, "McpHostedZone", {
        hostedZoneId: mcpHostedZoneId,
        zoneName: mcpRootDomain,
      });
      const mcpCertificate = Certificate.fromCertificateArn(this, "McpCertificate", mcpCertificateArn);

      const mountMcpApi = ({ idPrefix, apiName, subdomainPrefix, fn, description }) => {
        const mcpSubdomain = `${subdomainPrefix}.${mcpRootDomain}`;

        const mcpDomain = new DomainName(this, `${idPrefix}Domain`, {
          domainName: mcpSubdomain,
          certificate: mcpCertificate,
        });

        const mcpApi = new HttpApi(this, `${idPrefix}Api`, {
          apiName,
          createDefaultStage: true,
          defaultDomainMapping: {
            domainName: mcpDomain,
          },
        });

        // デフォルトステージにレート制限を設定（ブルートフォース・過剰課金防止）
        const defaultStage = mcpApi.defaultStage?.node.defaultChild;
        if (defaultStage) {
          defaultStage.defaultRouteSettings = {
            throttlingRateLimit: 5,
            throttlingBurstLimit: 10,
          };
        }

        mcpApi.addRoutes({
          path: "/",
          methods: [HttpMethod.POST],
          integration: new HttpLambdaIntegration(`${idPrefix}Integration`, fn),
        });

        new ARecord(this, `${idPrefix}AliasRecord`, {
          zone: mcpHostedZone,
          recordName: subdomainPrefix,
          target: RecordTarget.fromAlias(
            new ApiGatewayv2DomainProperties(mcpDomain.regionalDomainName, mcpDomain.regionalHostedZoneId),
          ),
        });

        new CfnOutput(this, `${idPrefix}EndpointUrl`, {
          value: `https://${mcpSubdomain}/`,
          description,
        });
      };

      mountMcpApi({
        idPrefix: "ObsidianMcp",
        apiName: "obsidian-s3-mcp-api",
        subdomainPrefix: "obsidian",
        fn: obsidianMcp,
        description: "Remote MCP endpoint URL for Obsidian S3 Vault (requires Bearer token)",
      });

      mountMcpApi({
        idPrefix: "DriveMcp",
        apiName: "google-drive-mcp-api",
        subdomainPrefix: "drive",
        fn: driveMcp,
        description: "Remote MCP endpoint URL for Google Drive (requires Bearer token)",
      });

      mountMcpApi({
        idPrefix: "CsvMcp",
        apiName: "household-csv-mcp-api",
        subdomainPrefix: "csv",
        fn: csvMcp,
        description: "Remote MCP endpoint URL for Household CSV formatting (requires Bearer token)",
      });

      mountMcpApi({
        idPrefix: "LineMcp",
        apiName: "line-notification-mcp-api",
        subdomainPrefix: "line",
        fn: lineMcp,
        description: "Remote MCP endpoint URL for LINE notifications (requires Bearer token)",
      });

      mountMcpApi({
        idPrefix: "UsageMcp",
        apiName: "claude-usage-mcp-api",
        subdomainPrefix: "usage",
        fn: usageMcp,
        description: "Remote MCP endpoint URL for Claude weekly usage reports (requires Bearer token)",
      });
    }

    const githubOidc = new OpenIdConnectProvider(this, "GitHubOidc", {
      url: "https://token.actions.githubusercontent.com",
      clientIds: ["sts.amazonaws.com"],
    });
    const githubDeploy = new Role(this, "GitHubDeploy", {
      roleName: "notes-pipeline-github-deploy",
      assumedBy: new WebIdentityPrincipal(githubOidc.openIdConnectProviderArn, {
        StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub":
            "repo:suzy1031@51276845/transcribe-save-to-notes-app@1439053334:ref:refs/heads/main",
        },
      }),
    });
    githubDeploy.addToPolicy(
      new PolicyStatement({
        actions: ["sts:AssumeRole"],
        resources: ["deploy", "file-publishing", "image-publishing", "lookup"].map(
          (purpose) => `arn:aws:iam::${this.account}:role/cdk-hnb659fds-${purpose}-role-${this.account}-${this.region}`,
        ),
      }),
    );

    new Schedule(this, "MorningBatch", {
      schedule: ScheduleExpression.cron({
        minute: "0/10",
        hour: "8-11",
        timeZone: TimeZone.ASIA_TOKYO,
      }),
      target: new LambdaInvoke(fn, { retryAttempts: 0 }),
    });

    new Schedule(this, "WeeklySummary", {
      schedule: ScheduleExpression.cron({
        minute: "0",
        hour: "9",
        weekDay: "SUN",
        timeZone: TimeZone.ASIA_TOKYO,
      }),
      target: new LambdaInvoke(weekly, { retryAttempts: 0 }),
    });

    new Schedule(this, "WeeklyReminderSchedule", {
      schedule: ScheduleExpression.cron({
        minute: "0",
        hour: "9",
        weekDay: "SUN",
        timeZone: TimeZone.ASIA_TOKYO,
      }),
      target: new LambdaInvoke(reminder, { retryAttempts: 0 }),
    });

    new Schedule(this, "CsvImportSchedule", {
      schedule: ScheduleExpression.cron({
        minute: "0",
        hour: "10",
        weekDay: "SUN",
        timeZone: TimeZone.ASIA_TOKYO,
      }),
      target: new LambdaInvoke(csvImport, { retryAttempts: 0 }),
    });

    new Schedule(this, "KindleSummary", {
      schedule: ScheduleExpression.cron({
        minute: "0",
        hour: "6",
        weekDay: "MON",
        timeZone: TimeZone.ASIA_TOKYO,
      }),
      target: new LambdaInvoke(kindle, { retryAttempts: 0 }),
    });
  }
}

const app = new App();
new NotesPipelineStack(app, "NotesPipelineStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || DEFAULT_AWS_REGION,
  },
});
