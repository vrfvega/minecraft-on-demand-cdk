import { DescribeInstancesCommand, EC2Client } from "@aws-sdk/client-ec2";
import {
  DescribeContainerInstancesCommand,
  ECSClient,
  ListContainerInstancesCommand,
} from "@aws-sdk/client-ecs";
import {
  type InstanceCheckerEvent,
  InstanceCheckerEventSchema,
  type InstanceCheckerResponse,
  InstanceCheckerResponseSchema,
} from "../../lib/schemas/instanceCheckerPayload.js";

const ecsClient = new ECSClient();
const ec2Client = new EC2Client();

class InstanceNotReadyError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "InstanceNotReady";
  }
}

const getPublicIp = async (ec2InstanceId: string): Promise<string | null> => {
  const { Reservations } = await ec2Client.send(
    new DescribeInstancesCommand({ InstanceIds: [ec2InstanceId] }),
  );
  const instance = Reservations?.[0]?.Instances?.[0];
  return (
    instance?.PublicIpAddress ??
    instance?.NetworkInterfaces?.[0]?.Association?.PublicIp ??
    null
  );
};

export const handler = async (
  event: InstanceCheckerEvent,
): Promise<InstanceCheckerResponse> => {
  const { clusterName, ec2InstanceId } =
    InstanceCheckerEventSchema.parse(event);

  const listResponse = await ecsClient.send(
    new ListContainerInstancesCommand({
      cluster: clusterName,
      status: "ACTIVE",
    }),
  );

  const containerInstanceArns = listResponse.containerInstanceArns!;
  if (containerInstanceArns.length === 0) {
    throw new InstanceNotReadyError("The EC2 instance is still initializing")
  }

  const describeResponse = await ecsClient.send(
    new DescribeContainerInstancesCommand({
      cluster: clusterName,
      containerInstances: containerInstanceArns,
    }),
  );

  const containerInstances = describeResponse.containerInstances!;
  const match = containerInstances.find(
    (instance) => instance.ec2InstanceId === ec2InstanceId,
  );

  if (!match) {
    throw new InstanceNotReadyError("The EC2 instance is still initializing")
  }

  return InstanceCheckerResponseSchema.parse({
    instanceIsReady: Boolean(match),
    containerInstanceArn: match?.containerInstanceArn ?? null,
    publicIp: match ? await getPublicIp(ec2InstanceId) : null,
  });
};
