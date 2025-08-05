import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { base32Decode, base32Encode } from '@ctrl/ts-base32';
import middy from "@middy/core";
import httpCors from "@middy/http-cors";
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {stringToUint8Array, uint8ArrayToString} from "uint8array-extras";

const TABLE_NAME = process.env.TABLE_NAME!;
const USER_ID_INDEX_NAME = process.env.USER_ID_INDEX_NAME!;

const ddbClient = new DynamoDBClient();

export const lambdaFunction = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    const userId = event.requestContext.authorizer?.userId;
    const afterKey = event.queryStringParameters?.afterKey;
    const limit = event.queryStringParameters?.limit;

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
        ExclusiveStartKey: afterKey ? JSON.parse(uint8ArrayToString(base32Decode(afterKey))) : undefined,
        Limit: limit ? Math.min(parseInt(limit), 100) : 10,
        ScanIndexForward: false,
        ConsistentRead: false,
      }),
    );

    let lastEvaluatedKey: string | undefined;
    if (queryResponse.LastEvaluatedKey) {
      lastEvaluatedKey = base32Encode(stringToUint8Array(JSON.stringify(queryResponse.LastEvaluatedKey)));
    }

    const serverHistoryItems = (queryResponse.Items ?? []).map((item) =>
      unmarshall(item),
    );

    const items = serverHistoryItems.map(
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
      body: JSON.stringify({
        items, lastEvaluatedKey
      }),
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
