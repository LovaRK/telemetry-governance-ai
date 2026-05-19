/**
 * UNIFIED API CLIENT — Single Entry Point for All API Communication
 * Implements SOLID principles:
 * - Single Responsibility: Only handles HTTP communication
 * - Dependency Inversion: Depends on fetch abstraction
 * - Interface Segregation: Minimal, focused methods
 */

import { APIRequest, APIResponse, AppError, UnauthorizedError } from '../types';
import { getCorrelationId } from './correlation';

interface RequestConfig {
  timeout?: number;
  retries?: number;
  includeCredentials?: boolean;
}

/**
 * IAPIClient — Interface for API communication (Dependency Inversion)
 * Allows mock implementations for testing
 */
export interface IAPIClient {
  get<T>(endpoint: string, options?: RequestConfig): Promise<T>;
  post<T>(endpoint: string, data: any, options?: RequestConfig): Promise<T>;
  put<T>(endpoint: string, data: any, options?: RequestConfig): Promise<T>;
  delete<T>(endpoint: string, options?: RequestConfig): Promise<T>;
  patch<T>(endpoint: string, data: any, options?: RequestConfig): Promise<T>;
}

/**
 * APIClient — Production API client implementation
 */
class APIClient implements IAPIClient {
  private baseUrl: string;
  private defaultTimeout: number = 30000;
  private defaultRetries: number = 2;

  constructor(baseUrl: string = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001') {
    this.baseUrl = baseUrl;
  }

  /**
   * GET request
   */
  async get<T>(endpoint: string, options?: RequestConfig): Promise<T> {
    return this.request<T>({
      method: 'GET',
      endpoint,
      headers: this.getHeaders(),
    }, options);
  }

  /**
   * POST request
   */
  async post<T>(endpoint: string, data: any, options?: RequestConfig): Promise<T> {
    return this.request<T>({
      method: 'POST',
      endpoint,
      data,
      headers: this.getHeaders(),
    }, options);
  }

  /**
   * PUT request
   */
  async put<T>(endpoint: string, data: any, options?: RequestConfig): Promise<T> {
    return this.request<T>({
      method: 'PUT',
      endpoint,
      data,
      headers: this.getHeaders(),
    }, options);
  }

  /**
   * DELETE request
   */
  async delete<T>(endpoint: string, options?: RequestConfig): Promise<T> {
    return this.request<T>({
      method: 'DELETE',
      endpoint,
      headers: this.getHeaders(),
    }, options);
  }

  /**
   * PATCH request
   */
  async patch<T>(endpoint: string, data: any, options?: RequestConfig): Promise<T> {
    return this.request<T>({
      method: 'PATCH',
      endpoint,
      data,
      headers: this.getHeaders(),
    }, options);
  }

  /**
   * Core request method with retry logic (Strategy Pattern)
   */
  private async request<T>(
    config: APIRequest,
    options?: RequestConfig,
    retryCount: number = 0
  ): Promise<T> {
    const timeout = options?.timeout ?? this.defaultTimeout;
    const maxRetries = options?.retries ?? this.defaultRetries;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(`${this.baseUrl}${config.endpoint}`, {
        method: config.method,
        headers: config.headers,
        body: config.data ? JSON.stringify(config.data) : undefined,
        credentials: options?.includeCredentials ? 'include' : 'omit',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      return await this.handleResponse<T>(response);
    } catch (error) {
      // Retry logic (exponential backoff)
      if (retryCount < maxRetries && this.isRetryableError(error)) {
        const delay = Math.pow(2, retryCount) * 1000; // Exponential backoff
        await this.sleep(delay);
        return this.request<T>(config, options, retryCount + 1);
      }

      throw this.handleError(error);
    }
  }

  /**
   * Handle HTTP response
   */
  private async handleResponse<T>(response: Response): Promise<T> {
    const contentType = response.headers.get('content-type');
    const correlationId = response.headers.get('x-correlation-id');

    let data: any;
    if (contentType?.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    // Check for API error response format
    if (!response.ok) {
      throw new AppError(
        data?.error?.code || 'HTTP_ERROR',
        data?.error?.message || response.statusText,
        response.status,
        { ...data?.error?.details, correlationId }
      );
    }

    // Handle wrapped API response
    if (data?.success === false) {
      throw new AppError(
        data.error?.code || 'API_ERROR',
        data.error?.message || 'API request failed',
        400,
        { ...data.error?.details, correlationId }
      );
    }

    // Extract data from wrapped response or return directly
    return data?.data ?? data;
  }

  /**
   * Handle errors uniformly
   */
  private handleError(error: any): Error {
    if (error instanceof AppError) {
      return error;
    }

    if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
      return new AppError(
        'NETWORK_ERROR',
        'Network request failed. Please check your connection.',
        0
      );
    }

    if (error instanceof DOMException && error.name === 'AbortError') {
      return new AppError(
        'REQUEST_TIMEOUT',
        'Request timed out. Please try again.',
        408
      );
    }

    return new AppError(
      'UNKNOWN_ERROR',
      error?.message || 'An unknown error occurred',
      500
    );
  }

  /**
   * Determine if error is retryable
   */
  private isRetryableError(error: any): boolean {
    if (error instanceof AppError) {
      // Retry on network errors, timeouts, and 5xx errors
      return error.statusCode === 0 || error.statusCode === 408 || error.statusCode >= 500;
    }
    return true;
  }

  /**
   * Build request headers with correlation context
   */
  private getHeaders(): Record<string, string> {
    const correlationId = getCorrelationId();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    if (correlationId) {
      headers['X-Correlation-Id'] = correlationId;
    }

    const token = this.getAuthToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    return headers;
  }

  /**
   * Get auth token from storage
   */
  private getAuthToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('auth_token');
  }

  /**
   * Utility: Sleep for given milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Set base URL (useful for dynamic configuration)
   */
  setBaseUrl(baseUrl: string): void {
    this.baseUrl = baseUrl;
  }

  /**
   * Set default timeout
   */
  setDefaultTimeout(timeout: number): void {
    this.defaultTimeout = timeout;
  }

  /**
   * Set default retry count
   */
  setDefaultRetries(retries: number): void {
    this.defaultRetries = retries;
  }
}

/**
 * SINGLETON INSTANCE — Single global API client
 * This ensures one API client throughout the app
 */
export const apiClient: IAPIClient = new APIClient();

/**
 * Export types for typing API calls
 */
export type { IAPIClient };
