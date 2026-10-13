/** Host authorization result, shared by backend transport and frontend client. */
export interface EntitlementDecision {
  allowed: boolean;
  organizationId?: string;
}
