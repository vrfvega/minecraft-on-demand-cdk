import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import middy from "@middy/core";
import httpCors from "@middy/http-cors";
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { Mod, Modpack } from "../lib/schemas/modpackPayload.js";
import { Logger } from "@aws-lambda-powertools/logger";

const TABLE_NAME = process.env.TABLE_NAME!;

const ddbClient = new DynamoDBClient();
const logger = new Logger({ serviceName: "GetModpackByIdHandler" });

export const lambdaHandler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  logger.logEventIfEnabled(event);
  try {
    const modpackId = event.pathParameters?.modpackId;
    if (!modpackId) {
      logger.warn("Missing required path parameter: modpackId");
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
        Limit: 1,
        ConsistentRead: true,
      }),
    );

    if (!Items || Items.length === 0) {
      return {
        statusCode: 404,
        body: JSON.stringify({
          message: `Not found`,
        }),
      };
    }

    const modpack = unmarshall(Items[0]) as Modpack;

    logger.info("Returning modpack", { modpack });
    return {
      statusCode: 200,
      body: JSON.stringify(modpack),
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

export const handler = middy(lambdaHandler).use(
  httpCors({
    origin: "*",
    headers: "*",
    methods: "*",
  }),
);
