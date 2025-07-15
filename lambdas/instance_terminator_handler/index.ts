import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { EC2Client, TerminateInstancesCommand } from "@aws-sdk/client-ec2";
import {
  DescribeContainerInstancesCommand,
  DescribeTasksCommand,
  ECSClient,
} from "@aws-sdk/client-ecs";

const TABLE_NAME = process.env.TABLE_NAME!;

const ecsClient = new ECSClient();
const ec2Client = new EC2Client();
const ddbClient = new DynamoDBClient();

export const handler = async (event: any) => {
  const { clusterArn, containerInstanceArn, taskArn } = event.detail;

  const describeResponse = await ecsClient.send(
    new DescribeContainerInstancesCommand({
      cluster: clusterArn,
      containerInstances: [containerInstanceArn],
    }),
  );

  const ec2InstanceId = describeResponse.containerInstances?.[0]?.ec2InstanceId;
  if (ec2InstanceId) {
    await ec2Client.send(
      new TerminateInstancesCommand({ InstanceIds: [ec2InstanceId] }),
    );
  }

  const tagsResponse = await ecsClient.send(
    new DescribeTasksCommand({
      cluster: clusterArn,
      tasks: [taskArn],
      include: ["TAGS"],
    }),
  );

  const tags = tagsResponse.tasks?.[0]?.tags ?? [];
  const serverId = tags.find((tag) => tag.key === "serverId")?.value;
  const startedAt = tags.find((tag) => tag.key === "startedAt")?.value;
  if (serverId && startedAt) {
    await ddbClient.send(
      new UpdateItemCommand({
        TableName: TABLE_NAME,
        Key: {
          serverId: { S: serverId },
          startedAt: { N: startedAt },
        },
        UpdateExpression: "SET serverStatus = :s, endedAt = :ea",
        ExpressionAttributeValues: {
          ":s": { S: "STOPPED" },
          ":ea": { N: Date.now().toString() },
        },
      }),
    );
  }
};
