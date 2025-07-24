import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import middy from "@middy/core";
import httpCors from "@middy/http-cors";
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { customAlphabet } from "nanoid";
import { ZodError } from "zod";
import {
  type ServerPayload,
  serverPayloadEntrySchema,
} from "../lib/schemas/serverPayload.js";

const TABLE_NAME = process.env.TABLE_NAME!;

const client = new DynamoDBClient();

function createServerConfig(detail: ServerPayload) {
  return {
    version: detail.version,
    type: detail.type,
  };
}

export const lambdaHandler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    const detail = serverPayloadEntrySchema.parse(JSON.parse(event.body!));
    const nanoidGenerator = customAlphabet(
      "0123456789abcdefghijklmnopqrstuvwxyz",
      12,
    );
    const partitionKey = nanoidGenerator();

    const params = {
      TableName: TABLE_NAME,
      Item: marshall({
        serverId: partitionKey,
        startedAt: Date.now(),
        endedAt: null,
        publicIp: null,
        serverConfig: createServerConfig(detail),
        serverStatus: "PENDING",
        userId: detail.userId,
        taskArn: null,
        instanceId: null,
        containerInstanceArn: null,
      }),
      ConditionExpression: "attribute_not_exists(serverId)",
    };

    const command = new PutItemCommand(params);
    await client.send(command);

    return {
      statusCode: 202,
      body: JSON.stringify({
        serverId: partitionKey,
        serverStatus: "PENDING",
        location: `/servers/${partitionKey}`,
      }),
    };
  } catch (err) {
    if (err instanceof ZodError) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "Invalid request",
          details: err.errors,
        }),
      };
    }
    console.error("Handler error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal Server Error" }),
    };
  }
};

export const handler = middy(lambdaHandler).use(
  httpCors({
    origin: "*",
    headers: "*",
    methods: "*",
  }),
);
