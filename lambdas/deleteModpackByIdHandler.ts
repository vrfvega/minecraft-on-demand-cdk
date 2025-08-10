import { Logger } from "@aws-lambda-powertools/logger";
import { DeleteItemCommand, DynamoDBClient, PutItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import middy from "@middy/core";
import httpCors from "@middy/http-cors";
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { Modpack, modpackSchema, PutModpackPayload, putModpackPayloadSchema } from "../lib/schemas/modpackPayload.js";
import { customAlphabet } from "nanoid";

const TABLE_NAME = process.env.TABLE_NAME!;

const ddbClient = new DynamoDBClient();
const logger = new Logger({ serviceName: "DeleteModpackByIdHandler" });

export const lambdaFunction = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  logger.logEventIfEnabled(event);
  try {
    const modpackId = event.pathParameters?.modpackId;
    if (!modpackId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: "modpackId is required" }),
      };
    }

    const userId = event.requestContext.authorizer?.userId;
    if (!userId) {
      return {
        statusCode: 401,
        body: JSON.stringify({ message: "Unauthorized" }),
      };
    }

    const { Items } = await ddbClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "modpackId = :pk",
        ExpressionAttributeValues: {
          ":pk": {
            S: modpackId,
          },
        },
        ScanIndexForward: false,
        Limit: 1,
        ConsistentRead: true,
      }),
    );

    if (!Items || Items.length === 0) {
      return {
        statusCode: 404,
        body: JSON.stringify({ message: "Not found" }),
      };
    }

    const modpack = unmarshall(Items[0]) as Modpack;
    if (modpack.userId !== userId) {
      return {
        statusCode: 403,
        body: JSON.stringify({
          message: "Forbidden",
        }),
      };
    }

    await ddbClient.send(
      new DeleteItemCommand({
        TableName: TABLE_NAME,
        Key: {
          modpackId: { S: modpackId },
          createdAt: { N: modpack.createdAt.toString() },
        },
        ConditionExpression: "userId = :uid",
        ExpressionAttributeValues: {
          ":uid": { S: userId },
        },
        ReturnValues: "ALL_OLD",
      }),
    );

    return {
      statusCode: 204,
      body: "",
    };
  } catch (error: unknown) {
    logger.error("Unexpected error", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Internal server error" }),
    };
  }
};

export const handler = middy(lambdaFunction).use(
  httpCors({
    origin: "*",
    headers: "*",
    methods: "*",
  }),
);
