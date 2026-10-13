import Ajv, { type ValidateFunction } from 'ajv';
import {
  coreServices,
  createServiceFactory,
  createServiceRef,
  type BackstageCredentials,
  type PermissionsService,
  type LoggerService,
} from '@backstage/backend-plugin-api';
import { InputError, NotAllowedError, NotFoundError } from '@backstage/errors';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import type {
  OperationDescriptor,
  OperationRequest,
} from '@ansible/portal-extension-common';
import type { PortalContext } from './types';
import { AuditEmitter } from './auditEmitter';

export interface OperationContext extends PortalContext {
  credentials: BackstageCredentials;
}

export interface OperationRegistration {
  pluginId: string;
  descriptor: OperationDescriptor;
  handler(
    request: OperationRequest,
    context: OperationContext,
  ): Promise<unknown>;
}

/** Injected root service: registrations do not rely on shared module singletons. */
export class PortalOperations {
  private readonly ajv = new Ajv({ strict: true, allErrors: true });
  private readonly registrations = new Map<
    string,
    {
      registration: OperationRegistration;
      input?: ValidateFunction;
      output?: ValidateFunction;
    }
  >();

  constructor(private readonly logger: LoggerService) {}

  register(registration: OperationRegistration): void {
    const { descriptor, pluginId } = registration;
    if (!descriptor.id.startsWith(`${pluginId}.`) || !descriptor.permission) {
      throw new InputError(
        'An operation must have an owner-prefixed ID and a permission',
      );
    }
    if (this.registrations.has(descriptor.id)) {
      throw new InputError(`Duplicate operation: ${descriptor.id}`);
    }
    this.registrations.set(descriptor.id, {
      registration,
      input: descriptor.inputSchema
        ? this.ajv.compile(descriptor.inputSchema)
        : undefined,
      output: descriptor.outputSchema
        ? this.ajv.compile(descriptor.outputSchema)
        : undefined,
    });
  }

  async execute(
    operationId: string,
    request: OperationRequest,
    context: OperationContext,
    permissions: PermissionsService,
  ): Promise<unknown> {
    const entry = this.registrations.get(operationId);
    if (!entry || !entry.registration.descriptor.exposure?.rest) {
      throw new NotFoundError(`Operation is not available: ${operationId}`);
    }
    const { registration } = entry;
    const audit = new AuditEmitter(registration.pluginId, this.logger);
    const event = {
      operationId,
      userId: context.userId,
      organizationId: context.organizationId,
      input: { entityRef: request.subject.entityRef },
    };
    try {
      const requirement = registration.descriptor.permission!;
      const query =
        'permission' in requirement ? requirement : { permission: requirement };
      const [decision] = await permissions.authorize([query], {
        credentials: context.credentials,
      });
      if (decision?.result !== AuthorizeResult.ALLOW) {
        throw new NotAllowedError('Operation permission denied');
      }
      if (entry.input && !entry.input(request.input ?? {})) {
        throw new InputError('Operation input does not match its schema');
      }
      const result = await registration.handler(request, context);
      if (entry.output && !entry.output(result)) {
        throw new Error('Operation output does not match its schema');
      }
      audit.emit({ ...event, outcome: 'SUCCESS' });
      return result;
    } catch (error) {
      audit.emit({ ...event, outcome: 'FAILURE' });
      throw error;
    }
  }
}

export const portalOperationsServiceRef = createServiceRef<PortalOperations>({
  id: 'portal.operations',
  scope: 'root',
  defaultFactory: async service =>
    createServiceFactory({
      service,
      deps: { logger: coreServices.rootLogger },
      factory: async ({ logger }) => new PortalOperations(logger),
    }),
});
