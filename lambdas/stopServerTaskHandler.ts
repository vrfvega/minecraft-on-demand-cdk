import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import {ECSClient, StopTaskCommand} from "@aws-sdk/client-ecs";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import middy from "@middy/core";
import httpCors from "@middy/http-cors";
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

const TABLE_NAME = process.env.TABLE_NAME!;
const CLUSTER_ARN = process.env.CLUSTER_ARN!;

const ddbClient = new DynamoDBClient();
const ecsClient = new ECSClient();

export const lambdaFunction = async (
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
        ScanIndexForward: false,
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

    const serverHistoryItem = (queryResponse.Items ?? []).map((item) =>
      unmarshall(item),
    )[0];

    if (!serverHistoryItem.endedAt) {
      await ecsClient.send(
        new StopTaskCommand({
          cluster: CLUSTER_ARN,
          task: serverHistoryItem.taskArn,
          reason: "Requested by user"
        })
      )
    }

    return {
      statusCode: 202,
      body: JSON.stringify({
        location: `/servers/${serverHistoryItem.serverId}`,
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
