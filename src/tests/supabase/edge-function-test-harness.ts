import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface EdgeFunctionContract {
  functionPath: string;
  requiredPatterns: RegExp[];
  optionalPatterns?: RegExp[];
}

function resolveFunctionPath(relativePath: string): string {
  return path.resolve(__dirname, '../../../supabase/functions', relativePath);
}

export async function loadEdgeFunctionSource(relativePath: string): Promise<string> {
  const absolutePath = resolveFunctionPath(relativePath);
  return readFile(absolutePath, 'utf-8');
}

export async function assertEdgeFunctionContract(contract: EdgeFunctionContract): Promise<void> {
  const source = await loadEdgeFunctionSource(contract.functionPath);
  for (const pattern of contract.requiredPatterns) {
    if (!pattern.test(source)) {
      throw new Error(
        `Missing required pattern ${pattern.toString()} in ${contract.functionPath}`
      );
    }
  }
}
