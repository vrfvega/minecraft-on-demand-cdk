import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import middy from "@middy/core";
import httpCors from "@middy/http-cors";
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

const TABLE_NAME = process.env.TABLE_NAME!;
const USER_ID_INDEX_NAME = process.env.USER_ID_INDEX_NAME!;

const ddbClient = new DynamoDBClient();

export const lambdaFunction = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    const userId = event.queryStringParameters?.userId;
    const limit = event.queryStringParameters?.limit;
    const debugMode =
      event.queryStringParameters?.debug?.toLowerCase() === "true";

    if (!userId) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: "userId is required as query parameter",
        }),
      };
    }

    const queryResponse = await ddbClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: USER_ID_INDEX_NAME,
        KeyConditionExpression: "userId = :uid",
        ExpressionAttributeValues: {
          ":uid": {
            S: userId,
          },
        },
        Limit: limit ? Math.min(parseInt(limit), 100) : 10,
        ScanIndexForward: false,
        ConsistentRead: false,
      }),
    );

    const serverHistoryItems = (queryResponse.Items ?? []).map((item) =>
      unmarshall(item),
    );

    const endpointResponseBody = debugMode
      ? serverHistoryItems
      : serverHistoryItems.map(
          ({
            serverId,
            startedAt,
            endedAt,
            serverStatus,
            serverConfig,
            publicIp,
          }) => ({
            serverId,
            startedAt,
            endedAt,
            serverStatus,
            serverConfig,
            publicIp,
          }),
        );

    return {
      statusCode: 200,
      body: JSON.stringify(endpointResponseBody),
    };
  } catch (error: unknown) {
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Internal server error", error: error }),
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
