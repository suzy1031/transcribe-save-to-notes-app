import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { App, CfnOutput, Duration, RemovalPolicy, Stack, TimeZone } from "aws-cdk-lib";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { OpenIdConnectProvider, PolicyStatement, Role, User, WebIdentityPrincipal } from "aws-cdk-lib/aws-iam";
import { Architecture, Code, Function as LambdaFunction, LayerVersion, Runtime } from "aws-cdk-lib/aws-lambda";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { BlockPublicAccess, Bucket, BucketEncryption, HttpMethods } from "aws-cdk-lib/aws-s3";
import { Schedule, ScheduleExpression } from "aws-cdk-lib/aws-scheduler";
import { LambdaInvoke } from "aws-cdk-lib/aws-scheduler-targets";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import {
  DEFAULT_AWS_REGION,
  DEFAULT_BEDROCK_MODEL_ID,
  DEFAULT_CLAUDE_TRANSCRIBE_MODEL_ID,
  DEFAULT_CLAUDE_WEEKLY_MODEL_ID,
  DEFAULT_CSV_INBOX_FOLDER,
  DEFAULT_CSV_PROCESSED_FOLDER,
  DEFAULT_CSV_SPREADSHEET_ID,
  DEFAULT_KINDLE_BOOK_PREFIX,
  DEFAULT_KINDLE_DRIVE_PARENT,
  DEFAULT_KINDLE_PROCESSED_FOLDER,
  DEFAULT_OBSIDIAN_DAILY_FOLDER,
  DEFAULT_OBSIDIAN_KINDLE_FOLDER,
  DEFAULT_OBSIDIAN_SUMMARY_FOLDER,
  DEFAULT_OBSIDIAN_VAULT_NAME,
  DEFAULT_TRANSCRIPTION_PROVIDER,
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
        "JSON with googleServiceAccount, anthropicApiKey, lineChannelAccessToken, and lineUserId. Replace the generated value before the first run.",
      removalPolicy: RemovalPolicy.RETAIN,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          googleServiceAccount: { client_email: "", private_key: "" },
          lineChannelAccessToken: "",
          lineUserId: "",
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
        BEDROCK_MODEL_ID: DEFAULT_BEDROCK_MODEL_ID,
        BEDROCK_REGION: this.region,
        NOTES_BUCKET_NAME: notesBucket.bucketName,
        OBSIDIAN_VAULT_NAME: DEFAULT_OBSIDIAN_VAULT_NAME,
        OBSIDIAN_DAILY_FOLDER: DEFAULT_OBSIDIAN_DAILY_FOLDER,
        // "claude" or "bedrock"
        TRANSCRIPTION_PROVIDER: DEFAULT_TRANSCRIPTION_PROVIDER,
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
        BEDROCK_MODEL_ID: DEFAULT_BEDROCK_MODEL_ID,
        BEDROCK_REGION: this.region,
        TRANSCRIPTION_PROVIDER: DEFAULT_TRANSCRIPTION_PROVIDER,
        CLAUDE_MODEL_ID: DEFAULT_CLAUDE_WEEKLY_MODEL_ID,
        NOTES_BUCKET_NAME: notesBucket.bucketName,
        OBSIDIAN_VAULT_NAME: DEFAULT_OBSIDIAN_VAULT_NAME,
        OBSIDIAN_DAILY_FOLDER: DEFAULT_OBSIDIAN_DAILY_FOLDER,
        OBSIDIAN_SUMMARY_FOLDER: DEFAULT_OBSIDIAN_SUMMARY_FOLDER,
        CLAUDE_USAGE_TABLE_NAME: claudeUsage.tableName,
      },
    });

    const bedrockAccess = () =>
      new PolicyStatement({
        actions: ["bedrock:InvokeModel", "bedrock:Converse"],
        resources: [
          `arn:aws:bedrock:${this.region}::foundation-model/${DEFAULT_BEDROCK_MODEL_ID}`,
          `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/${DEFAULT_BEDROCK_MODEL_ID}`,
        ],
      });

    secret.grantRead(fn);
    secret.grantRead(weekly);
    notesBucket.grantReadWrite(fn);
    notesBucket.grantReadWrite(weekly);
    fn.addToRolePolicy(bedrockAccess());
    weekly.addToRolePolicy(bedrockAccess());

    const reminder = createBunFunction("WeeklyReminder", {
      functionName: "craft-weekly-reminder",
      entry: path.join(lambdaDir, "reminder/reminder.ts"),
      memorySize: 256,
      timeout: Duration.minutes(1),
      reservedConcurrentExecutions: 1,
      environment: {
        SECRET_ID: secret.secretArn,
        NOTES_BUCKET_NAME: notesBucket.bucketName,
        OBSIDIAN_VAULT_NAME: DEFAULT_OBSIDIAN_VAULT_NAME,
        OBSIDIAN_SUMMARY_FOLDER: DEFAULT_OBSIDIAN_SUMMARY_FOLDER,
      },
    });

    secret.grantRead(reminder);
    notesBucket.grantRead(reminder);

    const csvImport = createBunFunction("CsvImport", {
      functionName: "csv-spreadsheet-import",
      entry: path.join(lambdaDir, "csv/csv-import.ts"),
      memorySize: 512,
      timeout: Duration.minutes(3),
      reservedConcurrentExecutions: 1,
      environment: {
        SECRET_ID: secret.secretArn,
        CSV_INBOX_FOLDER_NAME: DEFAULT_CSV_INBOX_FOLDER,
        CSV_PROCESSED_FOLDER_NAME: DEFAULT_CSV_PROCESSED_FOLDER,
        CSV_SPREADSHEET_ID: DEFAULT_CSV_SPREADSHEET_ID,
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
        BEDROCK_MODEL_ID: DEFAULT_BEDROCK_MODEL_ID,
        BEDROCK_REGION: this.region,
        TRANSCRIPTION_PROVIDER: DEFAULT_TRANSCRIPTION_PROVIDER,
        CLAUDE_MODEL_ID: DEFAULT_CLAUDE_TRANSCRIBE_MODEL_ID,
        NOTES_BUCKET_NAME: notesBucket.bucketName,
        OBSIDIAN_VAULT_NAME: DEFAULT_OBSIDIAN_VAULT_NAME,
        OBSIDIAN_KINDLE_FOLDER: DEFAULT_OBSIDIAN_KINDLE_FOLDER,
        KINDLE_DRIVE_PARENT_FOLDER_NAME: DEFAULT_KINDLE_DRIVE_PARENT,
        KINDLE_BOOK_FOLDER_PREFIX: DEFAULT_KINDLE_BOOK_PREFIX,
        KINDLE_PROCESSED_FOLDER_NAME: DEFAULT_KINDLE_PROCESSED_FOLDER,
        CLAUDE_USAGE_TABLE_NAME: claudeUsage.tableName,
      },
    });

    secret.grantRead(kindle);
    notesBucket.grantReadWrite(kindle);
    kindle.addToRolePolicy(bedrockAccess());
    claudeUsage.grantWriteData(fn);
    claudeUsage.grantReadWriteData(weekly);
    claudeUsage.grantWriteData(kindle);

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
