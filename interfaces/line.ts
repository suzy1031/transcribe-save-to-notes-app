export interface LineClient {
  push(text: string): Promise<void>;
}
