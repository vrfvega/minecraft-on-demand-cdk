import { promises as fs } from "node:fs";
import path from "node:path";
import { Logger } from "@aws-lambda-powertools/logger";
import middy from "@middy/core";
import httpCors from "@middy/http-cors";
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

const MOUNT_PATH = process.env.MOUNT_PATH ?? "/mnt/efs";
const logger = new Logger({ serviceName: "DeleteServerStorageHandler" });

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function deleteDirContents(targetDir: string): Promise<number> {
  const entries = await fs.readdir(targetDir, { withFileTypes: true });
  let deletedCount = 0;

  // Concurrency limiter
  const concurrency = 16;
  for (let i = 0; i < entries.length; i += concurrency) {
    const batch = entries.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map(async (entry) => {
        const entryPath = path.join(targetDir, entry.name);
        try {
          if (entry.isDirectory()) {
            // Remove directory recursively
            await fs.rm(entryPath, { recursive: true, force: true });
          } else {
            await fs.rm(entryPath, { force: true });
          }
          return 1;
        } catch (err) {
          logger.warn("Failed to delete entry", { entryPath, err });
          return 0;
        }
      }),
    );
    for (const r of results) {
      if (r.status === "fulfilled") deletedCount += r.value;
    }
  }

  return deletedCount;
}

export const lambdaFunction = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    logger.logEventIfEnabled(event);
    const userId = event.requestContext.authorizer?.userId;
    if (!userId) {
      return {
        statusCode: 401,
        body: JSON.stringify({ message: "Unauthorized" }),
      };
    }
    const userDir = path.join(MOUNT_PATH, userId);
    
    const exists = await pathExists(userDir);
    if (!exists) {
      return {
        statusCode: 204,
        body: "",
      };
    }

    await deleteDirContents(userDir);
    return {
      statusCode: 204,
      body: "",
    };
  } catch (error: unknown) {
    logger.error("Error deleting EFS path:", { error });
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
