/**
 * Simple logging utility for MCP server
 */
export const log = (message: string): void => {
  console.error(`[EXA-MCP-DEBUG] ${message}`);
};

export const createRequestLogger = (toolName: string) => {
  const requestId = `${toolName}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    log: (message: string): void => {
      log(`[${requestId}] [${toolName}] ${message}`);
    },
    start: (_query: string): void => {
      log(`[${requestId}] [${toolName}] Starting request`);
    },
    error: (_error: unknown): void => {
      log(`[${requestId}] [${toolName}] Request failed`);
    },
    complete: (): void => {
      log(`[${requestId}] [${toolName}] Successfully completed request`);
    },
  };
};
