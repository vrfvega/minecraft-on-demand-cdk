import {DescribeContainerInstancesCommand, ECSClient, ListContainerInstancesCommand} from "@aws-sdk/client-ecs";
import {
  type InstanceCheckerEvent,
  InstanceCheckerEventSchema,
  type InstanceCheckerResponse,
  InstanceCheckerResponseSchema
} from "../../lib/schema/instanceCheckerPayload";

const ecsClient = new ECSClient({});

export const handler = async (
  event: InstanceCheckerEvent
): Promise<InstanceCheckerResponse> => {
  const {clusterName, ec2InstanceId} = InstanceCheckerEventSchema.parse(event);

  const listResponse = await ecsClient.send(
    new ListContainerInstancesCommand({cluster: clusterName, status: "ACTIVE"})
  );

  const containerInstanceArns = listResponse.containerInstanceArns!;
  if (containerInstanceArns.length === 0) {
    return {
      instanceIsReady: false,
      containerInstanceArn: null
    };
  }

  const describeResponse = await ecsClient.send(
    new DescribeContainerInstancesCommand({
      cluster: clusterName,
      containerInstances: containerInstanceArns,
    })
  );

  const containerInstances = describeResponse.containerInstances!;
  const match = containerInstances.find(
    instance => instance.ec2InstanceId === ec2InstanceId
  );

  return InstanceCheckerResponseSchema.parse({
    instanceIsReady: Boolean(match),
    containerInstanceArn: match?.containerInstanceArn ?? null,
  });
};