import {Logger} from "@aws-lambda-powertools/logger";
import {DynamoDBClient, PutItemCommand} from "@aws-sdk/client-dynamodb";
import {marshall} from "@aws-sdk/util-dynamodb";
import middy from "@middy/core";
import httpCors from "@middy/http-cors";
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  ServerConfigurationPayloadSchema
} from "../lib/schemas/serverConfigurationPayload.js";

const TABLE_NAME = process.env.TABLE_NAME!;

const ddbClient = new DynamoDBClient();
const logger = new Logger({ serviceName: "PutServerConfigurationHandler" });

export const lambdaFunction = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    const userId = event.requestContext.authorizer?.userId;
    if (!userId) {
      return { statusCode: 401, body: JSON.stringify({ message: "Unauthorized" }) };
    }

    const serverConfiguration =
      ServerConfigurationPayloadSchema.parse(JSON.parse(event.body!));

    const response = await ddbClient.send(
      new PutItemCommand({
        TableName: TABLE_NAME,
        Item: marshall({ userId, configuration: serverConfiguration, updatedAt: Date.now() })
      })
    )

    return {
      statusCode: 200,
      body: JSON.stringify(response),
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
