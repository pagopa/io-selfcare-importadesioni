import { Client } from "../generated/selfcare/client";

export const selfcareClient = ({
  autoApprovalOnboardingUsingPOST: jest.fn(),
  contractOnboardingUsingPOST: jest.fn()
} as unknown) as Client<"apiKeyHeader">;
