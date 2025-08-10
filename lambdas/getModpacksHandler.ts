import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { base32Decode, base32Encode } from "@ctrl/ts-base32";
import { Logger } from "@aws-lambda-powertools/logger";
import middy from "@middy/core";
import httpCors from "@middy/http-cors";
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { stringToUint8Array, uint8ArrayToString } from "uint8array-extras";
import { Modpack, modpackSchema, SimplifiedModpack } from "../lib/schemas/modpackPayload.js";

const TABLE_NAME = process.env.TABLE_NAME!;
const USER_ID_INDEX_NAME = process.env.USER_ID_INDEX_NAME!;

const ddbClient = new DynamoDBClient();
const logger = new Logger({ serviceName: "GetModpacksHandler" });

export const lambdaFunction = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    logger.logEventIfEnabled(event);

    const userId = event.requestContext.authorizer?.userId;
    const afterKey = event.queryStringParameters?.afterKey;
    const limit = event.queryStringParameters?.limit;

    if (!userId) {
      return {
        statusCode: 401,
        body: JSON.stringify({ message: "Unauthorized" }),
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
        ExclusiveStartKey: afterKey
          ? JSON.parse(uint8ArrayToString(base32Decode(afterKey)))
          : undefined,
        Limit: limit ? Math.min(parseInt(limit), 100) : 10,
        ScanIndexForward: false,
        ConsistentRead: false,
      }),
    );

    logger.info("DynamoDB query completed", {
      count: (queryResponse.Items ?? []).length,
      hasLastEvaluatedKey: Boolean(queryResponse.LastEvaluatedKey),
    });

    let lastEvaluatedKey: string | undefined;
    if (queryResponse.LastEvaluatedKey) {
      lastEvaluatedKey = base32Encode(
        stringToUint8Array(JSON.stringify(queryResponse.LastEvaluatedKey)),
      );
    }

    const items: Modpack[] = (queryResponse.Items ?? []).map((item) =>
      modpackSchema.parse(unmarshall(item)),
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        items: items ?? [],
        lastEvaluatedKey,
      }),
    };
  } catch (error: unknown) {
    logger.error("Unexpected error", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
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
