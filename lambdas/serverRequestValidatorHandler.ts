import { Logger } from "@aws-lambda-powertools/logger";
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import middy from "@middy/core";
import httpCors from "@middy/http-cors";
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { customAlphabet } from "nanoid";
import { ZodError } from "zod";

const SERVER_HISTORY_TABLE_NAME = process.env.SERVER_HISTORY_TABLE_NAME!;
const SERVER_CONFIGURATIONS_TABLE_NAME = process.env.SERVER_CONFIGURATIONS_TABLE_NAME!;

const ddbClient = new DynamoDBClient();
const logger = new Logger({ serviceName: "ServerRequestValidator" });

interface ServerConfigurationItem {
  userId: string;
  configuration: Record<string, string>;
  updatedAt: number;
}

async function getServerConfiguration(userId: string) {
  const { Item } = await ddbClient.send(
    new GetItemCommand({
      TableName: SERVER_CONFIGURATIONS_TABLE_NAME,
      Key: marshall({ userId }),
      ConsistentRead: true,
    }),
  );
  if (!Item) return undefined;

  const serverConfigurationItem = unmarshall(Item) as ServerConfigurationItem;
  return serverConfigurationItem.configuration;
}

export const lambdaHandler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    const userId = event.requestContext.authorizer?.userId;
    if (!userId) {
      return {
        statusCode: 401,
        body: JSON.stringify({ message: "Unauthorized" }),
      };
    }

    const nanoidGenerator = customAlphabet(
      "0123456789abcdefghijklmnopqrstuvwxyz",
      12,
    );
    const partitionKey = nanoidGenerator();

    const serverConfiguration = await getServerConfiguration(userId);
    if (!serverConfiguration) {
      return {
        statusCode: 404,
        body: JSON.stringify({ message: "Not Found" }),
      };
    }

    await ddbClient.send(
      new PutItemCommand({
        TableName: SERVER_HISTORY_TABLE_NAME,
        Item: marshall({
          serverId: partitionKey,
          startedAt: Date.now(),
          endedAt: null,
          publicIp: null,
          serverConfig: serverConfiguration,
          serverStatus: "PENDING",
          userId: userId,
          taskArn: null,
          instanceId: null,
          containerInstanceArn: null,
        }),
        ConditionExpression: "attribute_not_exists(serverId)",
      }),
    );

    return {
      statusCode: 202,
      body: JSON.stringify({
        serverId: partitionKey,
        serverStatus: "PENDING",
        location: `/servers/${partitionKey}`,
      }),
    };
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "Invalid request",
          details: error.errors,
        }),
      };
    }
    logger.error("Handler error:", { error });
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
