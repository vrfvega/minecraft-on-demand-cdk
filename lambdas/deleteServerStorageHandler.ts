import { Logger } from "@aws-lambda-powertools/logger";
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
  S3Client,
} from "@aws-sdk/client-s3";
import middy from "@middy/core";
import httpCors from "@middy/http-cors";
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

const BUCKET_NAME = process.env.BUCKET_NAME!;
const MAX_DELETE = 1000;

const s3Client = new S3Client();
const logger = new Logger({ serviceName: "DeleteServerStorageHandler" });

export const lambdaFunction = async (
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
    const prefix = `${userId}/`;
    let continuationToken: string | undefined;
    const allKeys: { Key: string }[] = [];

    do {
      const list: ListObjectsV2CommandOutput = await s3Client.send(
        new ListObjectsV2Command({
          Bucket: BUCKET_NAME,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );

      (list.Contents ?? []).forEach((obj: any) => {
        if (!obj.Key) return;
        if (obj.Key === prefix) return;
        allKeys.push({ Key: obj.Key });
      });

      continuationToken = list.IsTruncated
        ? list.NextContinuationToken!
        : undefined;
    } while (continuationToken);

    if (allKeys.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({ message: "Nothing to delete" }),
      };
    }

    for (let i = 0; i < allKeys.length; i += MAX_DELETE) {
      const chunk = allKeys.slice(i, i + MAX_DELETE);
      await s3Client.send(
        new DeleteObjectsCommand({
          Bucket: BUCKET_NAME,
          Delete: { Objects: chunk, Quiet: false },
        }),
      );
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: `Deleted ${allKeys.length} objects under prefix ${prefix}`,
      }),
    };
  } catch (error: unknown) {
    logger.error("Error deleting S3 prefix:", { error });
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
