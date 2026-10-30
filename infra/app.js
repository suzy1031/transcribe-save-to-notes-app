import path from "node:path";
import { fileURLToPath } from "node:url";
import { App, Duration, RemovalPolicy, Stack, TimeZone } from "aws-cdk-lib";
import { OpenIdConnectProvider, PolicyStatement, Role, WebIdentityPrincipal } from "aws-cdk-lib/aws-iam";
import { Runtime, RuntimeFamily } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import { Schedule, ScheduleExpression } from "aws-cdk-lib/aws-scheduler";
import { LambdaInvoke } from "aws-cdk-lib/aws-scheduler-targets";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODEL_ID = "amazon.nova-lite-v1:0";

class NotesPipelineStack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    const runtime = new Runtime("nodejs26.x", RuntimeFamily.NODEJS, {
      supportsInlineCode: true,
    });

    const secret = new Secret(this, "Credentials", {
      secretName: "notes-pipeline/credentials",
      description:
        "JSON with googleServiceAccount, craftApiBaseUrl, and craftApiKey. Replace the generated value before the first run.",
      removalPolicy: RemovalPolicy.RETAIN,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          googleServiceAccount: { client_email: "", private_key: "" },
          craftApiBaseUrl: "",
          craftApiKey: "",
        }),
        generateStringKey: "generated",
      },
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
        BEDROCK_MODEL_ID: MODEL_ID,
        BEDROCK_REGION: this.region,
        CRAFT_FOLDER_NAME: "daily_note_transcribe",
        // "claude" or "bedrock"
        TRANSCRIPTION_PROVIDER: "claude",
        CLAUDE_MODEL_ID: "claude-haiku-5-5",
      },
      bundling: {
        format: OutputFormat.ESM,
        target: "node22",
        mainFields: ["module", "main"],
        banner:
          "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
    });

    secret.grantRead(fn);
    fn.addToRolePolicy(
      new PolicyStatement({
        actions: ["bedrock:InvokeModel", "bedrock:Converse"],
        resources: [
          `arn:aws:bedrock:${this.region}::foundation-model/${MODEL_ID}`,
          `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/${MODEL_ID}`,
        ],
      }),
    );

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
            "repo:suzy1031/transcribe-save-to-notes-app:ref:refs/heads/main",
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
  }
}

const app = new App();
new NotesPipelineStack(app, "NotesPipelineStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || "ap-northeast-1",
  },
});
