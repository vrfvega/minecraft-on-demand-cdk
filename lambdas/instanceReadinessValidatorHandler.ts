import {
  DescribeNetworkInterfacesCommand,
  EC2Client,
} from "@aws-sdk/client-ec2";
import {
  DescribeTasksCommand,
  ECSClient,
  type Task,
} from "@aws-sdk/client-ecs";
import {
  type ServerCheckerEvent,
  ServerCheckerEventSchema,
  type ServerCheckerResponse,
  ServerCheckerResponseSchema,
} from "../lib/schemas/instanceCheckerPayload.js";

const ecsClient = new ECSClient();
const ec2Client = new EC2Client();

function getNetworkInterfaceId(task: Task | null): string | null {
  if (!task) return null;

  const eniAtt = task.attachments?.find(
    (a) => a.type === "ElasticNetworkInterface",
  );
  return (
    eniAtt?.details?.find((d) => d.name === "networkInterfaceId")?.value ?? null
  );
}

async function getPublicIp(
  networkInterfaceId: string | null,
): Promise<string | null> {
  if (!networkInterfaceId) return null;

  const { NetworkInterfaces } = await ec2Client.send(
    new DescribeNetworkInterfacesCommand({
      NetworkInterfaceIds: [networkInterfaceId],
    }),
  );

  return NetworkInterfaces?.[0]?.Association?.PublicIp ?? null;
}

export const handler = async (
  event: ServerCheckerEvent,
): Promise<ServerCheckerResponse> => {
  const { clusterName, taskArn } = ServerCheckerEventSchema.parse(event);

  const { tasks } = await ecsClient.send(
    new DescribeTasksCommand({
      cluster: clusterName,
      tasks: [taskArn],
    }),
  );

  if (!tasks || tasks.length === 0) {
    return ServerCheckerResponseSchema.parse({
      isServerReady: false,
      publicIp: null,
    });
  }

  return ServerCheckerResponseSchema.parse({
    isServerReady: tasks?.[0]?.lastStatus === "RUNNING",
    publicIp: await getPublicIp(
      getNetworkInterfaceId(tasks?.[0] ?? null) ?? null,
    ),
  });
};
