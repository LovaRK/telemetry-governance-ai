/**
 * OPA Client
 *
 * REST API integration with Open Policy Agent.
 * Maintains trace context across OPA evaluation boundaries.
 */

import { getTraceId } from '@infra/observability/trace-context';

export interface OpaEvaluationResponse<TResult> {
  result?: TResult;
  errors?: string[];
}

export class OpaClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  /**
   * Evaluate a policy against OPA.
   * Includes trace context in request headers.
   *
   * @param packagePath Rego package path (e.g., 'governance/security_first')
   * @param input Policy input
   * @returns OPA evaluation result
   * @throws If OPA request fails or returns no result
   */
  async evaluate<TInput, TResult>(
    packagePath: string,
    input: TInput
  ): Promise<TResult> {
    const traceId = getTraceId();

    const url = new URL(`/v1/data/${packagePath}`, this.baseUrl).toString();

    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-trace-id': traceId,
      },
      body: JSON.stringify({ input }),
    });

    if (!response.ok) {
      throw new Error(
        `OPA evaluation failed: ${response.status} ${response.statusText}`
      );
    }

    const body = (await response.json()) as OpaEvaluationResponse<TResult>;

    if (!body.result) {
      throw new Error(`OPA evaluation returned no result: ${JSON.stringify(body.errors)}`);
    }

    return body.result;
  }
}
