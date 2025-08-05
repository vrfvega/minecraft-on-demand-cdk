import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import middy from "@middy/core";
import httpCors from "@middy/http-cors";
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

const TABLE_NAME = process.env.TABLE_NAME!;

const ddbClient = new DynamoDBClient();

export const lambdaHandler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    const serverId = event.pathParameters?.serverId;

    if (!serverId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: "serverId is required" }),
      };
    }

    const queryResponse = await ddbClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "serverId = :pk",
        ExpressionAttributeValues: {
          ":pk": {
            S: serverId,
          },
        },
        Limit: 1,
        ConsistentRead: true,
      }),
    );

    if (!queryResponse.Items || queryResponse.Items.length === 0) {
      return {
        statusCode: 404,
        body: JSON.stringify({
          message: `Server with serverId ${serverId} not found`,
        }),
      };
    }

    const item = unmarshall(queryResponse.Items[0]);
    const endpointResponseBody = {
      serverId: item.serverId,
      startedAt: item.startedAt,
      endedAt: item.endedAt,
      serverStatus: item.serverStatus,
      serverConfig: item.serverConfig,
      publicIp: item.publicIp,
    };

    return {
      statusCode: 200,
      body: JSON.stringify(endpointResponseBody),
    };
  } catch (_error: unknown) {
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
