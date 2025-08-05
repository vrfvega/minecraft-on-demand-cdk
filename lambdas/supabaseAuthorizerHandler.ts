import { Logger } from "@aws-lambda-powertools/logger";
import type {
  APIGatewayAuthorizerResult,
  APIGatewayTokenAuthorizerEvent,
} from "aws-lambda";
import { jwtVerify } from "jose";

const SUPABASE_LEGACY_JWT_SECRET = new TextEncoder().encode(
  process.env.SUPABASE_LEGACY_JWT_SECRET!,
);

const logger = new Logger({ serviceName: "AuthorizerHandler" });

function generateIamPolicy(
  principalId: string,
  effect: "Allow" | "Deny",
  resource: string,
): APIGatewayAuthorizerResult {
  return {
    principalId,
    policyDocument: {
      Version: "2012-10-17",
      Statement: [
        {
          Action: "execute-api:Invoke",
          Effect: effect,
          Resource: resource,
        },
      ],
    },
    context: {
      source: "supabase-jwt-authorizer",
      userId: principalId
    },
  };
}

export const handler = async (
  event: APIGatewayTokenAuthorizerEvent,
): Promise<APIGatewayAuthorizerResult> => {
  logger.logEventIfEnabled(event);
  try {
    const jwt = event.authorizationToken?.split(" ")[1];
    const { payload } = await jwtVerify(jwt, SUPABASE_LEGACY_JWT_SECRET);
    const principalId = payload.sub!;

    return generateIamPolicy(principalId, "Allow", event.methodArn);
  } catch (error: unknown) {
    logger.error("JWT verification failed", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return generateIamPolicy("unauthorized", "Deny", event.methodArn);
  }
};
