/**
 * SERVICE FACTORY — Dependency Injection Container
 * Initializes all services with proper dependencies
 * Implements the Factory Pattern and Dependency Inversion principle
 */

import { apiClient, IAPIClient } from '../api/client';
import {
  GovernanceService,
  createGovernanceService,
  IGovernanceService,
} from './governance.service';
import {
  ObservabilityService,
  createObservabilityService,
  IObservabilityService,
} from './observability.service';
import {
  EventService,
  createEventService,
  IEventService,
} from './event.service';
import {
  AuthService,
  createAuthService,
  IAuthService,
} from './auth.service';

/**
 * Services — Container holding all service instances
 * Provides a single point of access to all services
 */
export interface IServices {
  governance: IGovernanceService;
  observability: IObservabilityService;
  event: IEventService;
  auth: IAuthService;
  apiClient: IAPIClient;
}

class ServiceContainer implements IServices {
  governance: IGovernanceService;
  observability: IObservabilityService;
  event: IEventService;
  auth: IAuthService;
  apiClient: IAPIClient;

  constructor(apiClientInstance: IAPIClient = apiClient) {
    this.apiClient = apiClientInstance;

    // Initialize services with dependency injection
    this.governance = createGovernanceService(this.apiClient);
    this.observability = createObservabilityService(this.apiClient);
    this.event = createEventService(this.apiClient);
    this.auth = createAuthService(this.apiClient);
  }

  /**
   * Reconfigure API client (useful for testing)
   */
  setAPIClient(client: IAPIClient): void {
    this.apiClient = client;

    // Reinitialize services with new client
    this.governance = createGovernanceService(this.apiClient);
    this.observability = createObservabilityService(this.apiClient);
    this.event = createEventService(this.apiClient);
    this.auth = createAuthService(this.apiClient);
  }
}

/**
 * SINGLETON INSTANCE — Global services container
 * Ensures one instance throughout the application
 */
export const services: IServices = new ServiceContainer();

/**
 * FACTORY FUNCTION — Create custom service container
 * Useful for testing with mock dependencies
 */
export function createServiceContainer(apiClientInstance: IAPIClient): IServices {
  return new ServiceContainer(apiClientInstance);
}

/**
 * Export all service interfaces and types
 */
export type {
  IServices,
  IGovernanceService,
  IObservabilityService,
  IEventService,
  IAuthService,
};

// Export individual service constructors for advanced usage
export { createGovernanceService, GovernanceService };
export { createObservabilityService, ObservabilityService };
export { createEventService, EventService };
export { createAuthService, AuthService };
