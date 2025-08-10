import { Logger } from "@aws-lambda-powertools/logger";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import middy from "@middy/core";
import httpCors from "@middy/http-cors";
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { Modpack, modpackSchema, PostModpackPayload, postModpackPayloadSchema } from "../lib/schemas/modpackPayload.js";
import { customAlphabet } from "nanoid";

const TABLE_NAME = process.env.TABLE_NAME!;

const ddbClient = new DynamoDBClient();

const logger = new Logger({ serviceName: "PutServerConfigurationHandler" });
const nanoidGenerator = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);

export const lambdaFunction = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  logger.logEventIfEnabled(event);
  try {
    const userId = event.requestContext.authorizer?.userId;
    if (!userId) {
      return {
        statusCode: 401,
        body: JSON.stringify({ message: "Unauthorized" }),
      };
    }

    const payload: PostModpackPayload = postModpackPayloadSchema.parse(
      JSON.parse(event.body!),
    );

    const partitionKey = nanoidGenerator();
    const currentTime = Date.now();
    const modpack: Modpack = modpackSchema.parse({
      ...payload,
      modpackId: partitionKey,
      createdAt: currentTime,
      updatedAt: currentTime,
      userId,
    });

    await ddbClient.send(
      new PutItemCommand({
        TableName: TABLE_NAME,
        Item: marshall(modpack),
      }),
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        modpackId: modpack.modpackId,
        createdAt: modpack.createdAt,
        location: `/modpacks/${modpack.modpackId}`,
      }),
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
