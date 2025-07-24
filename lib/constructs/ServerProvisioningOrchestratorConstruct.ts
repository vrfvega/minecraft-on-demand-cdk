import { Duration, type StackProps } from "aws-cdk-lib";
import type { ITableV2 } from "aws-cdk-lib/aws-dynamodb";
import type { ISecurityGroup, IVpc } from "aws-cdk-lib/aws-ec2";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import type { IBucket } from "aws-cdk-lib/aws-s3";
import {
  DefinitionBody,
  type IChainable,
  IntegrationPattern,
  JsonPath,
  LogLevel,
  Pass,
  StateMachine,
  StateMachineType,
  TaskInput,
} from "aws-cdk-lib/aws-stepfunctions";
import {
  CallAwsService,
  DynamoAttributeValue,
  DynamoUpdateItem,
  LambdaInvoke,
} from "aws-cdk-lib/aws-stepfunctions-tasks";
import { Construct } from "constructs";
import type { ComputeConstruct } from "./ComputeConstruct.js";

export interface ServerProvisioningOrchestratorProps extends StackProps {
  vpc: IVpc;
  securityGroup: ISecurityGroup;
  serverHistoryTable: ITableV2;
  minecraftWorldsBucket: IBucket;
  computeConstruct: ComputeConstruct;
}

export class ServerProvisioningOrchestratorConstruct extends Construct {
  readonly definition: IChainable;
  readonly stateMachine: StateMachine;

  constructor(
    scope: Construct,
    id: string,
    props: ServerProvisioningOrchestratorProps,
  ) {
    super(scope, id);

    const unwrapInput = new Pass(this, "UnwrapInput", {
      inputPath: "$[0]",
      resultPath: "$",
    });

    const runInstance = new CallAwsService(this, "Run EC2 instance", {
      service: "ec2",
      action: "runInstances",
      iamResources: ["*"],
      parameters: {
        ImageId: props.computeConstruct.ecsOptimizedAmiArm64,
        InstanceType: "t4g.small",
        MinCount: 1,
        MaxCount: 1,
        SubnetId: props.vpc.publicSubnets.at(0)!.subnetId,
        SecurityGroupIds: [props.securityGroup.securityGroupId],
        IamInstanceProfile: {
          Name: props.computeConstruct.instanceProfile.instanceProfileName,
        },
        UserData: JsonPath.base64Encode(
          props.computeConstruct.userData.render(),
        ),
        TagSpecifications: [
          {
            ResourceType: "instance",
            Tags: [{ Key: "userId", Value: JsonPath.stringAt("$.userId") }],
          },
        ],
        MetadataOptions: {
          HttpTokens: "required",
          HttpEndpoint: "enabled",
          InstanceMetadataTags: "enabled",
        },
      },
      integrationPattern: IntegrationPattern.REQUEST_RESPONSE,
      resultSelector: {
        "InstanceId.$": "$.Instances[0].InstanceId",
      },
      resultPath: "$.runInstanceResult",
    });

    const instanceReadinessValidator = new NodejsFunction(
      this,
      "InstanceReadinessValidatorHandler",
      {
        runtime: Runtime.NODEJS_22_X,
        architecture: Architecture.ARM_64,
        memorySize: 1024,
        timeout: Duration.minutes(1),
        entry: new URL(
          "../../lambdas/instanceReadinessValidatorHandler.ts",
          import.meta.url,
        ).pathname,
        bundling: {
          minify: true,
          nodeModules: ["zod"],
          externalModules: ["@aws-sdk/*"],
        },
      },
    );
    instanceReadinessValidator.addToRolePolicy(
      new PolicyStatement({
        actions: [
          "ecs:ListContainerInstances",
          "ecs:DescribeContainerInstances",
          "ec2:DescribeInstances",
        ],
        resources: ["*"],
      }),
    );

    const checkInstanceStatus = new LambdaInvoke(
      this,
      "Check instance status",
      {
        lambdaFunction: instanceReadinessValidator,
        payloadResponseOnly: true,
        payload: TaskInput.fromObject({
          clusterName: props.computeConstruct.cluster.clusterName,
          ec2InstanceId: JsonPath.stringAt("$.runInstanceResult.InstanceId"),
        }),
        resultPath: "$.checkerResult",
      },
    );

    const runServerTask = new CallAwsService(this, "Run server task", {
      service: "ecs",
      action: "runTask",
      iamResources: ["*"],
      parameters: {
        Cluster: props.computeConstruct.cluster.clusterName,
        TaskDefinition: props.computeConstruct.taskDefinition.taskDefinitionArn,
        LaunchType: "EC2",
        Group: "minecraft-on-demand",
        PlacementConstraints: [
          {
            Type: "memberOf",
            Expression: JsonPath.format(
              "ec2InstanceId == {}",
              JsonPath.stringAt("$.runInstanceResult.InstanceId"),
            ),
          },
        ],
        Overrides: {
          ContainerOverrides: [
            {
              Name: props.computeConstruct.containerDefinition.containerName,
              Environment: [
                {
                  Name: "TYPE",
                  Value: JsonPath.stringAt("$.serverConfig.type"),
                },
                {
                  Name: "VERSION",
                  Value: JsonPath.stringAt("$.serverConfig.version"),
                },
              ],
            },
          ],
        },
        Tags: [
          { Key: "serverId", Value: JsonPath.stringAt("$.serverId") },
          { Key: "startedAt", Value: JsonPath.numberAt("$.startedAt") },
        ],
      },
      integrationPattern: IntegrationPattern.REQUEST_RESPONSE,
      resultPath: "$.runServerTaskResult",
    });

    const updateDdbItem = new DynamoUpdateItem(this, "Update DDB item", {
      table: props.serverHistoryTable,
      key: {
        serverId: DynamoAttributeValue.fromString(
          JsonPath.stringAt("$.serverId"),
        ),
        startedAt: DynamoAttributeValue.fromNumber(
          JsonPath.numberAt("$.startedAt"),
        ),
      },
      updateExpression:
        "SET serverStatus = :ss, publicIp = :ip, containerInstanceArn = :cia, taskArn = :ta, instanceId = :ii",
      expressionAttributeValues: {
        ":ss": DynamoAttributeValue.fromString(
          JsonPath.stringAt("$.runServerTaskResult.Tasks[0].DesiredStatus"),
        ),
        ":ip": DynamoAttributeValue.fromString(
          JsonPath.stringAt("$.checkerResult.publicIp"),
        ),
        ":cia": DynamoAttributeValue.fromString(
          JsonPath.stringAt("$.checkerResult.containerInstanceArn"),
        ),
        ":ta": DynamoAttributeValue.fromString(
          JsonPath.stringAt("$.runServerTaskResult.Tasks[0].TaskArn"),
        ),
        ":ii": DynamoAttributeValue.fromString(
          JsonPath.stringAt("$.runInstanceResult.InstanceId"),
        ),
      },
      resultPath: JsonPath.DISCARD,
    });

    this.definition = unwrapInput
      .next(runInstance)
      .next(
        checkInstanceStatus.addRetry({
          errors: ["InstanceNotReady"],
          interval: Duration.seconds(5),
          maxAttempts: 10,
          maxDelay: Duration.seconds(10),
          backoffRate: 2,
        }),
      )
      .next(runServerTask)
      .next(updateDdbItem);

    this.stateMachine = new StateMachine(this, `${id}-StateMachine`, {
      stateMachineName: `${id}`,
      stateMachineType: StateMachineType.EXPRESS,
      definitionBody: DefinitionBody.fromChainable(this.definition),
      logs: {
        destination: new LogGroup(this, `${id}-id`, {
          logGroupName: `/aws/states/${id}`,
        }),
        level: LogLevel.ALL,
        includeExecutionData: true,
      },
      tracingEnabled: true,
    });
    this.stateMachine.role.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ["ecs:TagResource", "ec2:CreateTags"],
        resources: ["*"],
      }),
    );
    this.stateMachine.role.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ["iam:PassRole"],
        resources: [
          props.computeConstruct.instanceRole.roleArn,
          props.computeConstruct.taskDefinition.executionRole!.roleArn,
          props.computeConstruct.taskDefinition.taskRole.roleArn,
        ],
      }),
    );
    props.serverHistoryTable.grantWriteData(this.stateMachine);
  }
}
