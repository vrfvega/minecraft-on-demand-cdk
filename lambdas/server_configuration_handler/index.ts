import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { nanoid } from "nanoid";
import { ZodError } from "zod";
import {
  type ServerPayload,
  serverPayloadEntrySchema,
} from "../../lib/schema/serverPayload";

const TABLE_NAME = process.env.TABLE_NAME!;

const client = new DynamoDBClient();

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    const detail = serverPayloadEntrySchema.parse(JSON.parse(event.body!));

    const partitionKey = nanoid(10);
    const params = {
      TableName: TABLE_NAME,
      Item: marshall({
        executionId: partitionKey,
        timestamp: Date.now(),
        serverConfig: createServerConfig(detail),
      }),
      ConditionExpression: "attribute_not_exists(executionId)",
    };

    const command = new PutItemCommand(params);
    await client.send(command);

    return {
      statusCode: 202,
      body: JSON.stringify({
        ok: true,
        message: "Server parsed and event published successfully",
        receivedBody: partitionKey,
      }),
    };
  } catch (err) {
    if (err instanceof ZodError) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          ok: false,
          error: "Invalid request",
          details: err.errors,
        }),
      };
    }
    console.error("Handler error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: "Internal Server Error" }),
    };
  }
};

function createServerConfig(detail: ServerPayload) {
  return {
    serverId: nanoid(10),
    userId: detail.userId,
    version: detail.version,
    type: detail.type,
  };
}
