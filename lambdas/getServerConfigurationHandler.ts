import {Logger} from "@aws-lambda-powertools/logger";
import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import {marshall, unmarshall} from "@aws-sdk/util-dynamodb";
import middy from "@middy/core";
import httpCors from "@middy/http-cors";
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

const TABLE_NAME = process.env.TABLE_NAME!;

const ddbClient = new DynamoDBClient();
const logger = new Logger({ serviceName: "GetServerConfigurationHandler" });

interface ServerConfigurationItem {
  userId: string;
  configuration: Record<string, string>;
  updatedAt: number;
}

export const lambdaFunction = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    const userId = event.requestContext.authorizer?.userId;
    if (!userId) {
      return { statusCode: 401, body: JSON.stringify({ message: "Unauthorized" }) };
    }
    logger.info("Fetching server configuration", { userId });

    const { Item } = await ddbClient.send(
      new GetItemCommand({
        TableName: TABLE_NAME,
        Key: marshall({ userId }),
        ConsistentRead: true,
      }),
    );
    if (!Item) {
      return { statusCode: 404, body: JSON.stringify({ message: "Not Found" }) };
    }

    const serverConfigurationItem = unmarshall(Item) as ServerConfigurationItem;

    return {
      statusCode: 200,
      body: JSON.stringify(serverConfigurationItem.configuration),
    };
  } catch (error: unknown) {
    logger.error("Handler error", { error });
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Internal server error"}),
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
