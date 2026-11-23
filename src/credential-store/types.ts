export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  input?: string;
  timeout?: number;
}

export type Run = (command: string, args: string[], options?: RunOptions) => Promise<RunResult>;

export interface ReadPolicy {
  promptOnRead: boolean;
}

export interface CredentialStore {
  readonly id: string;
  readonly label: string;
  silentRead(policy: ReadPolicy): boolean;
  read(account: string): Promise<string>;
  has(account: string): Promise<boolean>;
  store(account: string, token: string, options?: Partial<ReadPolicy>): Promise<void>;
  delete(account: string): Promise<boolean>;
}

export interface CredentialStores {
  byId(id: string): CredentialStore;
  candidates(): CredentialStore[];
}

export interface StoreDeps {
  run: Run;
  dir: string;
  env: NodeJS.ProcessEnv;
}
