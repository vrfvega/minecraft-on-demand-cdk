import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { nanoid } from "nanoid";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { ZodError } from "zod";
import { serverPayloadEntrySchema } from "../../lib/schema/serverPayload";

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

const TABLE_NAME = process.env.PAYLOAD_TABLE!;

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    const { detail } = serverPayloadEntrySchema.parse(JSON.parse(event.body!));

    const partitionKey = nanoid(10);

    const putCmd = new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: partitionKey,
        sk: new Date().toISOString(),
        ...createServerConfig(detail),
      },
      ConditionExpression: "attribute_not_exists(pk)",
    });

    await docClient.send(putCmd);

    return {
      statusCode: 202,
      headers,
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
        headers,
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
      headers,
      body: JSON.stringify({ ok: false, error: "Internal Server Error" }),
    };
  }
};

function createServerConfig(detail: any) {
  return {
    serverId: nanoid(10),
    userId: detail.userId,
    version: detail.version,
    type: detail.type,
  };
}
