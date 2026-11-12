import path from "node:path";
import { fileURLToPath } from "node:url";
import { App, Duration, RemovalPolicy, Stack, TimeZone } from "aws-cdk-lib";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { OpenIdConnectProvider, PolicyStatement, Role, WebIdentityPrincipal } from "aws-cdk-lib/aws-iam";
import { Runtime, RuntimeFamily } from "aws-cdk-lib/aws-lambda";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
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
  DEFAULT_CRAFT_PROCESSED_FOLDER,
  DEFAULT_CRAFT_SUMMARY_FOLDER,
  DEFAULT_CRAFT_TRANSCRIBE_FOLDER,
  DEFAULT_KINDLE_BOOK_PREFIX,
  DEFAULT_KINDLE_DRIVE_PARENT,
  DEFAULT_KINDLE_PROCESSED_FOLDER,
  DEFAULT_KINDLE_SUMMARY_DOC_TITLE,
  DEFAULT_TRANSCRIPTION_PROVIDER,
} from "../lambda/const.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const bundling = {
  format: OutputFormat.ESM,
  target: "node26",
  mainFields: ["module", "main"],
  banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
};

const lambdaLogRetention = RetentionDays.ONE_MONTH;

class NotesPipelineStack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    const runtime = new Runtime("nodejs26.x", RuntimeFamily.NODEJS, {
      supportsInlineCode: true,
    });

    const secret = new Secret(this, "Credentials", {
      secretName: "notes-pipeline/credentials",
      description:
        "JSON with googleServiceAccount, craftApiBaseUrl, craftApiKey, lineChannelAccessToken, and lineUserId. Replace the generated value before the first run.",
      removalPolicy: RemovalPolicy.RETAIN,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          googleServiceAccount: { client_email: "", private_key: "" },
          craftApiBaseUrl: "",
          craftApiKey: "",
          lineChannelAccessToken: "",
          lineUserId: "",
        }),
        generateStringKey: "generated",
      },
    });

    const claudeUsage = new Table(this, "ClaudeUsage", {
      tableName: "notes-pipeline-claude-usage",
      partitionKey: { name: "pk", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const fn = new NodejsFunction(this, "Handler", {
      entry: path.join(__dirname, "../lambda/index.js"),
      projectRoot: path.join(__dirname, ".."),
      depsLockFilePath: path.join(__dirname, "../package-lock.json"),
      handler: "handler",
      runtime,
      memorySize: 512,
      timeout: Duration.minutes(5),
      reservedConcurrentExecutions: 1,
      environment: {
        SECRET_ID: secret.secretArn,
        BEDROCK_MODEL_ID: DEFAULT_BEDROCK_MODEL_ID,
        BEDROCK_REGION: this.region,
        CRAFT_FOLDER_NAME: DEFAULT_CRAFT_TRANSCRIBE_FOLDER,
        // "claude" or "bedrock"
        TRANSCRIPTION_PROVIDER: DEFAULT_TRANSCRIPTION_PROVIDER,
        CLAUDE_MODEL_ID: DEFAULT_CLAUDE_TRANSCRIBE_MODEL_ID,
        CLAUDE_USAGE_TABLE_NAME: claudeUsage.tableName,
      },
      bundling,
      logRetention: lambdaLogRetention,
    });

    const weekly = new NodejsFunction(this, "WeeklySummarizer", {
      functionName: "craft-weekly-summarizer",
      entry: path.join(__dirname, "../lambda/weekly.js"),
      projectRoot: path.join(__dirname, ".."),
      depsLockFilePath: path.join(__dirname, "../package-lock.json"),
      handler: "handler",
      runtime,
      memorySize: 512,
      timeout: Duration.minutes(3),
      reservedConcurrentExecutions: 1,
      environment: {
        SECRET_ID: secret.secretArn,
        BEDROCK_MODEL_ID: DEFAULT_BEDROCK_MODEL_ID,
        BEDROCK_REGION: this.region,
        TRANSCRIPTION_PROVIDER: DEFAULT_TRANSCRIPTION_PROVIDER,
        CLAUDE_MODEL_ID: DEFAULT_CLAUDE_WEEKLY_MODEL_ID,
        CRAFT_SOURCE_FOLDER_NAME: DEFAULT_CRAFT_TRANSCRIBE_FOLDER,
        CRAFT_PROCESSED_FOLDER_NAME: DEFAULT_CRAFT_PROCESSED_FOLDER,
        CRAFT_SUMMARY_FOLDER_NAME: DEFAULT_CRAFT_SUMMARY_FOLDER,
        CLAUDE_USAGE_TABLE_NAME: claudeUsage.tableName,
      },
      bundling,
      logRetention: lambdaLogRetention,
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
    fn.addToRolePolicy(bedrockAccess());
    weekly.addToRolePolicy(bedrockAccess());

    const reminder = new NodejsFunction(this, "WeeklyReminder", {
      functionName: "craft-weekly-reminder",
      entry: path.join(__dirname, "../lambda/reminder.js"),
      projectRoot: path.join(__dirname, ".."),
      depsLockFilePath: path.join(__dirname, "../package-lock.json"),
      handler: "handler",
      runtime,
      memorySize: 256,
      timeout: Duration.minutes(1),
      reservedConcurrentExecutions: 1,
      environment: {
        SECRET_ID: secret.secretArn,
        CRAFT_SUMMARY_FOLDER_NAME: DEFAULT_CRAFT_SUMMARY_FOLDER,
      },
      bundling,
      logRetention: lambdaLogRetention,
    });

    secret.grantRead(reminder);

    const csvImport = new NodejsFunction(this, "CsvImport", {
      functionName: "csv-spreadsheet-import",
      entry: path.join(__dirname, "../lambda/csv-import.js"),
      projectRoot: path.join(__dirname, ".."),
      depsLockFilePath: path.join(__dirname, "../package-lock.json"),
      handler: "handler",
      runtime,
      memorySize: 512,
      timeout: Duration.minutes(3),
      reservedConcurrentExecutions: 1,
      environment: {
        SECRET_ID: secret.secretArn,
        CSV_INBOX_FOLDER_NAME: DEFAULT_CSV_INBOX_FOLDER,
        CSV_PROCESSED_FOLDER_NAME: DEFAULT_CSV_PROCESSED_FOLDER,
        CSV_SPREADSHEET_ID: DEFAULT_CSV_SPREADSHEET_ID,
      },
      bundling,
      logRetention: lambdaLogRetention,
    });

    secret.grantRead(csvImport);

    const kindle = new NodejsFunction(this, "KindleSummarizer", {
      functionName: "craft-kindle-summarizer",
      entry: path.join(__dirname, "../lambda/kindle.js"),
      projectRoot: path.join(__dirname, ".."),
      depsLockFilePath: path.join(__dirname, "../package-lock.json"),
      handler: "handler",
      runtime,
      memorySize: 512,
      timeout: Duration.minutes(5),
      reservedConcurrentExecutions: 1,
      environment: {
        SECRET_ID: secret.secretArn,
        BEDROCK_MODEL_ID: DEFAULT_BEDROCK_MODEL_ID,
        BEDROCK_REGION: this.region,
        TRANSCRIPTION_PROVIDER: DEFAULT_TRANSCRIPTION_PROVIDER,
        CLAUDE_MODEL_ID: DEFAULT_CLAUDE_TRANSCRIBE_MODEL_ID,
        KINDLE_DRIVE_PARENT_FOLDER_NAME: DEFAULT_KINDLE_DRIVE_PARENT,
        KINDLE_BOOK_FOLDER_PREFIX: DEFAULT_KINDLE_BOOK_PREFIX,
        KINDLE_PROCESSED_FOLDER_NAME: DEFAULT_KINDLE_PROCESSED_FOLDER,
        KINDLE_SUMMARY_DOC_TITLE: DEFAULT_KINDLE_SUMMARY_DOC_TITLE,
        CLAUDE_USAGE_TABLE_NAME: claudeUsage.tableName,
      },
      bundling,
      logRetention: lambdaLogRetention,
    });

    secret.grantRead(kindle);
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
        resources: [
          "deploy",
          "file-publishing",
          "image-publishing",
          "lookup",
        ].map(
          (purpose) =>
            `arn:aws:iam::${this.account}:role/cdk-hnb659fds-${purpose}-role-${this.account}-${this.region}`,
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
