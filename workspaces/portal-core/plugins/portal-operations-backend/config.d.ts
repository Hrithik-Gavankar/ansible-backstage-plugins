export interface Config {
  portal?: {
    /** Trusted single-organization deployment context; never inferred from identity. */
    organization?: {
      /** @visibility backend */
      id?: string;
      /**
       * Explicit legacy catalog partition mapping; first namespace is used for creation.
       * @visibility backend
       */
      catalogMappings?: Array<{
        organizationId: string;
        namespaces: string[];
      }>;
    };
    entitlements?: {
      /** Host availability policy. An absent grant denies; RBAC must also allow. */
      grants?: Array<{
        /** Registered entitlement ID, such as apme.scanning. */
        id: string;
        /** Organization IDs, or '*' for all organizations. Global scope requires '*'. */
        organizations: string[];
      }>;
    };
  };
}
