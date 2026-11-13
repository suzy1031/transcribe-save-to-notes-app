import type { GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

export interface SecretsClientLike {
  send(command: GetSecretValueCommand): Promise<{ SecretString?: string }>;
}

export interface LambdaContextLike {
  getRemainingTimeInMillis(): number;
}

export interface LoggerLike {
  info(...args: unknown[]): void;
  error(...args: unknown[]): void;
}
