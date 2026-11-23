export function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
